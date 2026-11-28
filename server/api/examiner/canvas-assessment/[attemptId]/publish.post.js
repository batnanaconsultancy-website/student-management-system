import { createError, readBody } from 'h3'
import { serverSupabaseClient, serverSupabaseServiceRole, serverSupabaseUser } from '#supabase/server'
import { requireCanvasAssessmentAttempt } from '~/server/utils/canvasAssessmentAccess'
import { publishCanvasGrade } from '~/server/utils/canvasApi'
import { writeAuditLog } from '~/server/utils/auditLog'

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const attemptId = getRouterParam(event, 'attemptId')
  const { attempt, examiner } = await requireCanvasAssessmentAttempt(event, supabase, attemptId)
  const user = await serverSupabaseUser(event)
  const body = await readBody(event)
  const reviewId = String(body?.reviewId || '')
  if (!reviewId) throw createError({ statusCode: 400, statusMessage: 'reviewId is required.' })

  const service = await serverSupabaseServiceRole(event)
  const { data: review, error: reviewError } = await service
    .from('canvas_examiner_reviews')
    .select('id, status, approved_score, approved_grade, examiner_feedback')
    .eq('id', reviewId)
    .eq('submission_attempt_id', attempt.id)
    .eq('examiner_id', examiner.id)
    .maybeSingle()
  if (reviewError) throw createError({ statusCode: 500, statusMessage: reviewError.message })
  if (!review || review.status !== 'approved') {
    throw createError({ statusCode: 409, statusMessage: 'Only an Examiner-approved grade can be published.' })
  }

  const postedGrade = review.approved_score ?? review.approved_grade
  if (postedGrade === null || postedGrade === undefined || postedGrade === '') {
    throw createError({ statusCode: 409, statusMessage: 'The approved review has no publishable score or grade.' })
  }

  const { data: previous, error: previousError } = await service
    .from('canvas_grade_publish_jobs')
    .select('id, status, canvas_grade_response')
    .eq('review_id', review.id)
    .in('status', ['queued', 'processing', 'published'])
    .maybeSingle()
  if (previousError) throw createError({ statusCode: 500, statusMessage: previousError.message })
  if (previous?.status === 'published') {
    return { data: previous, alreadyPublished: true }
  }
  if (previous) {
    throw createError({ statusCode: 409, statusMessage: 'A publish operation for this approved review is already in progress.' })
  }

  const { data: student, error: studentError } = await service
    .from('canvas_students').select('canvas_user_id')
    .eq('id', attempt.canvas_student_id).maybeSingle()
  if (studentError) throw createError({ statusCode: 500, statusMessage: studentError.message })
  if (!student?.canvas_user_id) throw createError({ statusCode: 404, statusMessage: 'Canvas student ID is missing.' })

  const { data: job, error: jobError } = await service.from('canvas_grade_publish_jobs').insert({
    review_id: review.id,
    status: 'processing',
    requested_by: user.email,
    attempts: 1,
    locked_at: new Date().toISOString(),
    locked_by: 'examiner-explicit-publish',
  }).select('id').single()
  if (jobError) throw createError({ statusCode: 500, statusMessage: jobError.message })

  try {
    const canvasResponse = await publishCanvasGrade(
      attempt.canvas_course_id,
      attempt.canvas_assignment_id,
      student.canvas_user_id,
      postedGrade,
      review.examiner_feedback,
    )
    const { data: completed, error: completeError } = await service
      .from('canvas_grade_publish_jobs')
      .update({
        status: 'published',
        canvas_grade_response: canvasResponse,
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .select('id, status, created_at')
      .single()
    if (completeError) throw completeError

    await writeAuditLog(
      service,
      user.email,
      'publish_canvas_examiner_approved_grade',
      'canvas_submission_attempt',
      attempt.id,
      { review_id: review.id, publish_job_id: job.id, posted_grade: postedGrade },
      event,
    )

    return { data: completed, canvasResponse }
  } catch (error) {
    await service.from('canvas_grade_publish_jobs').update({
      status: 'failed',
      last_error: String(error.message || 'Canvas grade publish failed').slice(0, 4000),
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    }).eq('id', job.id)
    throw createError({
      statusCode: error.statusCode || 502,
      statusMessage: error.message || 'Canvas grade publish failed.',
    })
  }
})
