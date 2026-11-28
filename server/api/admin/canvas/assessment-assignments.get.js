import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseServiceRole } from '#supabase/server'
import { requireCanvasAssessmentAdmin, assertCanvasAssessmentScope } from '~/server/utils/canvasAssessmentAuth'
import { listCanvasAssignments } from '~/server/utils/canvasApi'

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  await requireCanvasAssessmentAdmin(event, supabase)
  const query = getQuery(event)
  const scope = String(query.scope || '')
  const courseId = Number(query.courseId)
  assertCanvasAssessmentScope(scope)
  if (!Number.isSafeInteger(courseId) || courseId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'A valid courseId is required.' })
  }

  const service = await serverSupabaseServiceRole(event)
  const { data: courseConfig, error: configError } = await service
    .from('canvas_assessment_courses').select('is_enabled')
    .eq('scope', scope).eq('canvas_course_id', courseId).maybeSingle()
  if (configError) throw createError({ statusCode: 500, statusMessage: configError.message })
  if (!courseConfig?.is_enabled) {
    return { data: { assignments: [], courseEnabled: false } }
  }

  try {
    const canvasAssignments = await listCanvasAssignments(courseId)
    const rows = canvasAssignments.map((a) => ({
      canvas_course_id: courseId,
      canvas_assignment_id: a.id,
      name: a.name || `Assignment ${a.id}`,
      due_at: a.due_at || null,
      points_possible: a.points_possible ?? null,
      synced_at: new Date().toISOString(),
    }))
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await service.from('canvas_assignments')
        .upsert(rows.slice(i, i + 100), { onConflict: 'canvas_course_id,canvas_assignment_id' })
      if (error) throw error
    }

    const { data: configRows, error: selectionError } = await service
      .from('canvas_assessment_assignments')
      .select('canvas_assignment_id, is_assessment')
      .eq('scope', scope).eq('canvas_course_id', courseId)
    if (selectionError) throw selectionError
    const selected = new Map((configRows || []).map((r) => [r.canvas_assignment_id, r.is_assessment]))

    return {
      data: {
        courseEnabled: true,
        assignments: canvasAssignments.map((a) => ({
          id: a.id,
          name: a.name || `Assignment ${a.id}`,
          dueAt: a.due_at || null,
          pointsPossible: a.points_possible ?? null,
          isAssessment: selected.get(a.id) === true,
        })),
      },
    }
  } catch (err) {
    throw createError({ statusCode: err.statusCode || 500, statusMessage: err.message || 'Could not load Canvas assignments.' })
  }
})
