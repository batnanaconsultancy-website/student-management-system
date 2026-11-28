import { createError, readBody } from 'h3'
import { serverSupabaseClient, serverSupabaseServiceRole, serverSupabaseUser } from '#supabase/server'
import { requireCanvasAssessmentAdmin, assertCanvasAssessmentScope } from '~/server/utils/canvasAssessmentAuth'

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  await requireCanvasAssessmentAdmin(event, supabase)
  const user = await serverSupabaseUser(event)
  const body = await readBody(event)
  const scope = body?.scope
  const courseId = Number(body?.canvasCourseId)
  const assignmentId = Number(body?.canvasAssignmentId)
  const selected = Boolean(body?.isAssessment)
  assertCanvasAssessmentScope(scope)
  if (![courseId, assignmentId].every(Number.isSafeInteger) || courseId <= 0 || assignmentId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Valid course and assignment IDs are required.' })
  }

  const service = await serverSupabaseServiceRole(event)
  const { data: course, error: courseError } = await service.from('canvas_assessment_courses')
    .select('is_enabled').eq('scope', scope).eq('canvas_course_id', courseId).maybeSingle()
  if (courseError) throw createError({ statusCode: 500, statusMessage: courseError.message })
  if (!course?.is_enabled) throw createError({ statusCode: 409, statusMessage: 'Enable the course in this assessment scope first.' })

  const { data: assignment, error: assignmentError } = await service.from('canvas_assignments')
    .select('canvas_assignment_id').eq('canvas_course_id', courseId)
    .eq('canvas_assignment_id', assignmentId).maybeSingle()
  if (assignmentError) throw createError({ statusCode: 500, statusMessage: assignmentError.message })
  if (!assignment) throw createError({ statusCode: 404, statusMessage: 'Sync the course assignments before configuring assessment selection.' })

  const { data: previous } = await service.from('canvas_assessment_assignments')
    .select('is_assessment').eq('scope', scope).eq('canvas_course_id', courseId)
    .eq('canvas_assignment_id', assignmentId).maybeSingle()

  const { error } = await service.from('canvas_assessment_assignments').upsert({
    scope, canvas_course_id: courseId, canvas_assignment_id: assignmentId,
    is_assessment: selected, selected_by: user.email,
    selected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: 'scope,canvas_course_id,canvas_assignment_id' })
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  await service.from('canvas_assessment_config_audit').insert({
    scope, canvas_course_id: courseId, canvas_assignment_id: assignmentId,
    actor_email: user.email,
    action: selected ? 'assignment_enabled' : 'assignment_disabled',
    old_value: previous ? { is_assessment: previous.is_assessment } : null,
    new_value: { is_assessment: selected },
  })

  return { data: { scope, canvasCourseId: courseId, canvasAssignmentId: assignmentId, isAssessment: selected } }
})
