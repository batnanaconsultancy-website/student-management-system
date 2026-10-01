import { serverSupabaseClient } from '#supabase/server'
import { requireFinalProjectAdmin } from '~/server/utils/finalProjectAuth'
import { buildAssignmentList } from '~/server/utils/finalProjectAssessment'

// GET /api/admin/final-project-assessment/history?year=2026
//
// Section 7: Preview / Historical Records. Includes archived
// assignments (unlike assignments.get.js), filtered by the year the
// assignment was created in. Omit `year` to see everything.
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  await requireFinalProjectAdmin(event, supabase)

  const query = getQuery(event)
  const year = query.year ? Number(query.year) : null

  const assignments = await buildAssignmentList(supabase, { includeArchived: true, year })

  return { data: { assignments } }
})
