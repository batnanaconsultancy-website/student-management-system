import { serverSupabaseClient } from '#supabase/server'
import { requireFinalProjectAdmin } from '~/server/utils/finalProjectAuth'
import { buildAssignmentList } from '~/server/utils/finalProjectAssessment'

// GET /api/admin/final-project-assessment/assignments
//
// The main Admin "Final Project Assessment" list -- active
// (non-archived) assignments only. See history.get.js for the
// archived + year-filtered Preview view (Section 7).
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  await requireFinalProjectAdmin(event, supabase)

  const assignments = await buildAssignmentList(supabase, { includeArchived: false })

  return { data: { assignments } }
})
