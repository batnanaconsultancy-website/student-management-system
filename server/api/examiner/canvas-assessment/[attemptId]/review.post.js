import { createError, readBody } from 'h3'
import { serverSupabaseClient, serverSupabaseServiceRole } from '#supabase/server'
import { requireCanvasAssessmentAttempt } from '~/server/utils/canvasAssessmentAccess'

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const attemptId = getRouterParam(event, 'attemptId')
  const { examiner, attempt } = await requireCanvasAssessmentAttempt(event, supabase, attemptId)
  const body = await readBody(event)
  const resultId = String(body?.gradingResultId || '')
  const status = body?.status === 'approved' ? 'approved' : 'draft'
  const score = body?.score === null || body?.score === '' || body?.score === undefined
    ? null
    : Number(body.score)
  const grade = body?.grade == null ? null : String(body.grade).trim()
  const feedback = body?.feedback == null ? null : String(body.feedback)

  if (!resultId) throw createError({ statusCode: 400, statusMessage: 'gradingResultId is required.' })
  if (score !== null && (!Number.isFinite(score) || score < 0)) {
    throw createError({ statusCode: 400, statusMessage: 'Score must be a non-negative number.' })
  }
  if (status === 'approved' && score === null && !grade) {
    throw createError({ statusCode: 400, statusMessage: 'Enter an approved score or grade before approving.' })
  }

  const service = await serverSupabaseServiceRole(event)
  const { data: result, error: resultError } = await service
    .from('canvas_ai_grading_results')
    .select('id, submission_attempt_id')
    .eq('id', resultId)
    .maybeSingle()
  if (resultError) throw createError({ statusCode: 500, statusMessage: resultError.message })
  if (!result || result.submission_attempt_id !== attempt.id) {
    throw createError({ statusCode: 404, statusMessage: 'AI grading result not found for this attempt.' })
  }

  if (score !== null) {
    const { data: assignment, error: assignmentError } = await service
      .from('canvas_assignments').select('points_possible')
      .eq('canvas_course_id', attempt.canvas_course_id)
      .eq('canvas_assignment_id', attempt.canvas_assignment_id).maybeSingle()
    if (assignmentError) throw createError({ statusCode: 500, statusMessage: assignmentError.message })
    if (assignment?.points_possible != null && score > Number(assignment.points_possible)) {
      throw createError({ statusCode: 400, statusMessage: `Score cannot exceed ${assignment.points_possible} points.` })
    }
  }

  const { data: review, error } = await service.from('canvas_examiner_reviews').insert({
    grading_result_id: resultId,
    submission_attempt_id: attempt.id,
    examiner_id: examiner.id,
    status,
    review_score: score,
    review_grade: grade,
    approved_score: status === 'approved' ? score : null,
    approved_grade: status === 'approved' ? grade : null,
    examiner_feedback: feedback,
    approved_at: status === 'approved' ? new Date().toISOString() : null,
  }).select('id, status, approved_score, approved_grade, approved_at, created_at').single()
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return {
    data: review,
    message: status === 'approved'
      ? `Approved by ${user.email}. This grade has not yet been published to Canvas.`
      : 'Examiner review saved as a draft.',
  }
})
