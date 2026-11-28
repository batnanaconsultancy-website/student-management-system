import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseServiceRole } from '#supabase/server'
import { requireCanvasAssessmentAttempt } from '~/server/utils/canvasAssessmentAccess'

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const attemptId = getRouterParam(event, 'attemptId')
  const { attempt, scope } = await requireCanvasAssessmentAttempt(event, supabase, attemptId)
  const service = await serverSupabaseServiceRole(event)

  const [courseResult, assignmentResult, rubricResult, jobsResult, reviewResult] = await Promise.all([
    supabase.from('canvas_courses').select('name, course_code')
      .eq('canvas_course_id', attempt.canvas_course_id).maybeSingle(),
    supabase.from('canvas_assignments').select('name, points_possible, due_at')
      .eq('canvas_course_id', attempt.canvas_course_id)
      .eq('canvas_assignment_id', attempt.canvas_assignment_id).maybeSingle(),
    supabase.from('canvas_assignment_rubric_versions').select('id, version_hash, rubric, rubric_settings, captured_at')
      .eq('canvas_course_id', attempt.canvas_course_id)
      .eq('canvas_assignment_id', attempt.canvas_assignment_id)
      .order('captured_at', { ascending: false }).limit(1).maybeSingle(),
    service.from('canvas_ai_grading_jobs').select('id, status, attempts, last_error, created_at')
      .eq('submission_attempt_id', attempt.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    service.from('canvas_examiner_reviews').select('id, status, review_score, review_grade, approved_score, approved_grade, examiner_feedback, approved_at, created_at')
      .eq('submission_attempt_id', attempt.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  for (const result of [courseResult, assignmentResult, rubricResult, jobsResult, reviewResult]) {
    if (result.error) throw createError({ statusCode: 500, statusMessage: result.error.message })
  }

  let latestPublishJob = null
  if (reviewResult.data?.id) {
    const { data, error } = await service.from('canvas_grade_publish_jobs')
      .select('id, status, last_error, created_at')
      .eq('review_id', reviewResult.data.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    latestPublishJob = data
  }

  let latestResult = null
  if (jobsResult.data?.id) {
    const { data, error } = await service.from('canvas_ai_grading_results')
      .select('id, provider, model, rubric_version_id, suggested_score, suggested_grade, criterion_feedback, overall_feedback, rationale, created_at')
      .eq('job_id', jobsResult.data.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    latestResult = data
  }

  const attachments = []
  for (const file of attempt.attachments || []) {
    let downloadUrl = null
    if (file.storage_path && file.download_status === 'archived') {
      const { data, error } = await service.storage.from('canvas-submission-evidence')
        .createSignedUrl(file.storage_path, 300)
      if (!error) downloadUrl = data?.signedUrl || null
    }
    attachments.push({ ...file, downloadUrl })
  }

  return {
    data: {
      scope,
      attempt: { ...attempt, attachments },
      student: attempt.canvas_students || null,
      course: courseResult.data || null,
      assignment: assignmentResult.data || null,
      rubric: rubricResult.data || null,
      latestJob: jobsResult.data || null,
      latestResult,
      latestReview: reviewResult.data || null,
      latestPublishJob,
    },
  }
})
