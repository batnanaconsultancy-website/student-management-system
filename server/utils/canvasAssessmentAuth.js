import { createError } from 'h3'
import { requireFinalProjectAdmin, requireExaminer } from '~/server/utils/finalProjectAuth'

export const CANVAS_ASSESSMENT_SCOPES = ['canvas_bachelor', 'canvas_masters']

export function assertCanvasAssessmentScope(scope) {
  if (!CANVAS_ASSESSMENT_SCOPES.includes(scope)) {
    throw createError({ statusCode: 400, statusMessage: 'scope must be canvas_bachelor or canvas_masters' })
  }
}

export async function requireCanvasAssessmentAdmin(event, supabase) {
  return requireFinalProjectAdmin(event, supabase)
}

export async function requireCanvasAssessmentExaminer(event, supabase) {
  const identity = await requireExaminer(event, supabase)
  const { data, error } = await supabase
    .from('canvas_assessment_examiners')
    .select('scope')
    .eq('examiner_id', identity.examiner.id)

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  return { ...identity, scopes: [...new Set((data || []).map((row) => row.scope))] }
}
