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
  const enabled = Boolean(body?.enabled)
  assertCanvasAssessmentScope(scope)
  const existingMastersCourseIds = new Set([201, 328, 385, 421, 427, 432, 434, 443, 447, 548])
  if (scope === 'canvas_bachelor' && existingMastersCourseIds.has(courseId)) {
    throw createError({ statusCode: 409, statusMessage: 'This existing Canvas Masters course is reserved for the Masters assessment scope.' })
  }
  if (!Number.isSafeInteger(courseId) || courseId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'A valid canvasCourseId is required.' })
  }

  const service = await serverSupabaseServiceRole(event)
  const { data: course, error: courseError } = await service
    .from('canvas_courses').select('canvas_course_id').eq('canvas_course_id', courseId).maybeSingle()
  if (courseError) throw createError({ statusCode: 500, statusMessage: courseError.message })
  if (!course) throw createError({ statusCode: 404, statusMessage: 'Discover/sync this Canvas course before selecting it.' })

  const { data: previous } = await service.from('canvas_assessment_courses')
    .select('is_enabled').eq('scope', scope).eq('canvas_course_id', courseId).maybeSingle()

  const { error } = await service.from('canvas_assessment_courses').upsert({
    scope, canvas_course_id: courseId, is_enabled: enabled,
    selected_by: user.email, selected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'scope,canvas_course_id' })
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  await service.from('canvas_assessment_config_audit').insert({
    scope, canvas_course_id: courseId, actor_email: user.email,
    action: enabled ? 'course_enabled' : 'course_disabled',
    old_value: previous ? { is_enabled: previous.is_enabled } : null,
    new_value: { is_enabled: enabled },
  })

  return { data: { scope, canvasCourseId: courseId, enabled } }
})
