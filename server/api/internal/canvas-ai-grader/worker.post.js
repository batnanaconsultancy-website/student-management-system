import { createError, getHeader } from 'h3'
import { randomUUID } from 'node:crypto'
import { serverSupabaseServiceRole } from '#supabase/server'
import { requestOpenAiCanvasGrade } from '~/server/utils/canvasAiGrader'

const STALE_LOCK_MINUTES = 15

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const workerSecret = config.canvasAiWorkerSecret
  if (!workerSecret) {
    throw createError({ statusCode: 503, statusMessage: 'Canvas AI worker is not configured. Set CANVAS_AI_WORKER_SECRET.' })
  }
  const suppliedSecret = getHeader(event, 'x-canvas-ai-worker-secret')
  if (!suppliedSecret || suppliedSecret !== workerSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid or missing worker secret.' })
  }

  const service = await serverSupabaseServiceRole(event)
  const workerId = `canvas-ai-${randomUUID()}`
  const { data: jobs, error: claimError } = await service.rpc('claim_canvas_ai_grading_job', {
    p_worker_id: workerId,
    p_stale_before: new Date(Date.now() - STALE_LOCK_MINUTES * 60 * 1000).toISOString(),
  })
  if (claimError) throw createError({ statusCode: 500, statusMessage: `Could not claim a grading job: ${claimError.message}` })

  const job = Array.isArray(jobs) ? jobs[0] : jobs
  if (!job) return { data: { processed: false, message: 'No eligible Canvas AI grading jobs are queued.' } }

  const now = () => new Date().toISOString()
  try {
    const rubricResult = job.rubric_version_id
      ? await service.from('canvas_assignment_rubric_versions')
        .select('id, rubric, rubric_settings, version_hash')
        .eq('id', job.rubric_version_id).single()
      : { data: null, error: new Error('No rubric version was attached to this grading job.') }
    if (rubricResult.error) { rubricResult.error.retryable = false; throw rubricResult.error }

    const { data: attempt, error: attemptError } = await service.from('canvas_submission_attempts')
      .select('id, canvas_course_id, canvas_assignment_id, canvas_student_id, attempt, submitted_at, body, url, attachments, content_sha256')
      .eq('id', job.submission_attempt_id).single()
    if (attemptError) throw attemptError

    const { data: assignment, error: assignmentError } = await service.from('canvas_assignments')
      .select('name, points_possible')
      .eq('canvas_course_id', attempt.canvas_course_id)
      .eq('canvas_assignment_id', attempt.canvas_assignment_id).maybeSingle()
    if (assignmentError) throw assignmentError

    const { assessment, rawResponse, model } = await requestOpenAiCanvasGrade({
      apiKey: config.openaiApiKey,
      model: config.openaiModel || 'gpt-6.2-sol',
      attempt,
      assignment,
      rubric: rubricResult.data.rubric,
    })

    const { data: resultId, error: completeError } = await service.rpc('complete_canvas_ai_grading_job', {
      p_job_id: job.id,
      p_worker_id: workerId,
      p_result: {
        provider: 'openai',
        model,
        suggested_score: assessment.suggested_score,
        suggested_grade: assessment.suggested_grade,
        criterion_feedback: assessment.criterion_feedback,
        overall_feedback: assessment.overall_feedback,
        rationale: assessment.rationale,
        raw_response: rawResponse,
      },
    })
    if (completeError) throw completeError

    return { data: { processed: true, jobId: job.id, resultId, suggestedScore: assessment.suggested_score, model } }
  } catch (error) {
    const attempts = Number(job.attempts || 1)
    const maxAttempts = Number(job.max_attempts || 3)
    const canRetry = error.retryable !== false && attempts < maxAttempts
    const delaySeconds = Math.min(60 * (2 ** Math.max(0, attempts - 1)), 60 * 60)
    const { data: updatedJob, error: updateError } = await service.from('canvas_ai_grading_jobs').update({
      status: canRetry ? 'queued' : 'failed',
      available_at: canRetry ? new Date(Date.now() + delaySeconds * 1000).toISOString() : now(),
      locked_at: null,
      locked_by: null,
      last_error: String(error.message || 'Canvas AI grading failed').slice(0, 4000),
      updated_at: now(),
    }).eq('id', job.id).eq('status', 'processing').eq('locked_by', workerId)
      .select('id').maybeSingle()
    if (updateError) {
      console.error('canvas-ai-grader: failed to update job after processing error', updateError)
    }
    if (!updateError && !updatedJob) {
      return { data: { processed: true, jobId: job.id, status: 'lease_lost', attempts } }
    }
    return {
      data: {
        processed: true,
        jobId: job.id,
        status: canRetry ? 'queued' : 'failed',
        attempts,
        retryAt: canRetry ? new Date(Date.now() + delaySeconds * 1000).toISOString() : null,
        error: String(error.message || 'Canvas AI grading failed').slice(0, 1000),
      },
    }
  }
})
