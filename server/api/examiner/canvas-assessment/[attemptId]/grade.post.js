import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseServiceRole, serverSupabaseUser } from '#supabase/server'
import { requireCanvasAssessmentAttempt } from '~/server/utils/canvasAssessmentAccess'

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const attemptId = getRouterParam(event, 'attemptId')
  const { attempt, scope } = await requireCanvasAssessmentAttempt(event, supabase, attemptId)
  const user = await serverSupabaseUser(event)
  const service = await serverSupabaseServiceRole(event)

  const { data: rubric, error: rubricError } = await service
    .from('canvas_assignment_rubric_versions')
    .select('id')
    .eq('canvas_course_id', attempt.canvas_course_id)
    .eq('canvas_assignment_id', attempt.canvas_assignment_id)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (rubricError) throw createError({ statusCode: 500, statusMessage: rubricError.message })
  if (!rubric) {
    throw createError({ statusCode: 409, statusMessage: 'This assignment has no captured Canvas rubric. Add a rubric and sync the assignment before requesting AI grading.' })
  }

  const idempotencyKey = `${attempt.id}:${attempt.content_sha256 || 'no-hash'}:${rubric?.id || 'no-rubric'}`
  const { data: existing, error: existingError } = await service
    .from('canvas_ai_grading_jobs')
    .select('id, status, attempts, created_at')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  if (existingError) throw createError({ statusCode: 500, statusMessage: existingError.message })

  if (existing && ['queued', 'processing', 'completed'].includes(existing.status)) {
    return { data: { ...existing, alreadyRequested: true } }
  }

  const { data: job, error } = await service
    .from('canvas_ai_grading_jobs')
    .upsert({
      scope,
      submission_attempt_id: attempt.id,
      rubric_version_id: rubric?.id || null,
      status: 'queued',
      requested_by: user.email,
      idempotency_key: idempotencyKey,
      attempts: 0,
      available_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'idempotency_key' })
    .select('id, status, attempts, created_at')
    .single()
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return {
    data: {
      ...job,
      queued: true,
      message: 'The grading request is queued for OpenAI. The scheduled worker will process it when the next run starts.',
    },
  }
})
