import { createError } from 'h3'
import { requireCanvasAssessmentExaminer } from '~/server/utils/canvasAssessmentAuth'

export async function requireCanvasAssessmentAttempt(event, supabase, attemptId) {
  const identity = await requireCanvasAssessmentExaminer(event, supabase)
  if (!identity.scopes.length) {
    throw createError({ statusCode: 403, statusMessage: 'You have not been assigned to a Canvas assessment scope.' })
  }

  const { data: attempt, error: attemptError } = await supabase
    .from('canvas_submission_attempts')
    .select('id, canvas_course_id, canvas_assignment_id, canvas_student_id, attempt, is_latest, submission_type, submitted_at, body, url, attachments, rubric_assessment, content_sha256, captured_at, canvas_students(name, email)')
    .eq('id', attemptId)
    .maybeSingle()
  if (attemptError) throw createError({ statusCode: 500, statusMessage: attemptError.message })
  if (!attempt) throw createError({ statusCode: 404, statusMessage: 'Canvas submission attempt not found.' })

  const { data: assignmentConfig, error: configError } = await supabase
    .from('canvas_assessment_assignments')
    .select('scope')
    .eq('canvas_course_id', attempt.canvas_course_id)
    .eq('canvas_assignment_id', attempt.canvas_assignment_id)
    .eq('is_assessment', true)
    .in('scope', identity.scopes)
  if (configError) throw createError({ statusCode: 500, statusMessage: configError.message })
  const config = assignmentConfig?.[0]
  if (!config) throw createError({ statusCode: 403, statusMessage: 'You are not assigned to this Canvas assessment.' })

  return { ...identity, attempt, scope: config.scope }
}
