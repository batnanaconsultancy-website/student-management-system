import { createError, readBody } from 'h3'
import { serverSupabaseClient, serverSupabaseServiceRole, serverSupabaseUser } from '#supabase/server'
import { requireCanvasAssessmentAdmin, assertCanvasAssessmentScope } from '~/server/utils/canvasAssessmentAuth'

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  await requireCanvasAssessmentAdmin(event, supabase)
  const user = await serverSupabaseUser(event)
  const body = await readBody(event)
  const scope = body?.scope
  const examinerId = body?.examinerId
  const assigned = Boolean(body?.assigned)
  assertCanvasAssessmentScope(scope)
  if (typeof examinerId !== 'string' || !examinerId) {
    throw createError({ statusCode: 400, statusMessage: 'examinerId is required.' })
  }

  const service = await serverSupabaseServiceRole(event)
  const { data: examiner, error: examinerError } = await service.from('examiners')
    .select('id, email, is_active').eq('id', examinerId).maybeSingle()
  if (examinerError) throw createError({ statusCode: 500, statusMessage: examinerError.message })
  if (!examiner?.is_active) throw createError({ statusCode: 404, statusMessage: 'Active Examiner not found.' })

  const { data: faculty, error: facultyError } = await service.from('faculty')
    .select('id, staff_type, is_active').ilike('email', examiner.email).maybeSingle()
  if (facultyError) throw createError({ statusCode: 500, statusMessage: facultyError.message })
  if (!faculty?.is_active || faculty.staff_type !== 'teaching') {
    throw createError({ statusCode: 409, statusMessage: 'Canvas Examiners must also be active teaching Faculty.' })
  }

  const result = assigned
    ? await service.from('canvas_assessment_examiners').upsert({
        examiner_id: examinerId, scope, assigned_by: user.email,
      }, { onConflict: 'examiner_id,scope' })
    : await service.from('canvas_assessment_examiners').delete()
        .eq('examiner_id', examinerId).eq('scope', scope)
  if (result.error) throw createError({ statusCode: 500, statusMessage: result.error.message })

  return { data: { examinerId, scope, assigned } }
})
