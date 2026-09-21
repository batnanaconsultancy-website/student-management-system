import { serverSupabaseClient } from '#supabase/server'
import { buildCanvasMastersRoster, requireCanvasMastersAdmin } from '~/server/utils/canvasMastersRoster'

// GET /api/admin/canvas-masters/roster
//
// Powers pages/admin/canvas-masters.vue (the roster list). For EVERY
// student in the fixed masters roster (canvas_student_labels, seeded
// from the list you provided), returns their name, program/cohort
// label, meeting attendance, and a nested Course -> Learning Outcome ->
// Assignment tree showing which assignments count toward each outcome
// and whether they've submitted them.
//
// The list page itself only renders the summary fields (name, email,
// program, cohort, attendance, sync status) -- the full per-student
// course/outcome tree is what pages/admin/canvas-masters/[email].vue
// (the per-student dashboard) drills into. Both this endpoint and that
// one share the same buildCanvasMastersRoster() so they can never
// disagree with each other.
//
// Unlike submissions.get.js / competencies.get.js on the regular Canvas
// tab, this is NOT scoped to a single selected course -- it spans every
// course that's been synced so far for each student, since a student
// can be enrolled in several. It also isn't limited to students who
// happen to already be synced: a labeled student with no Canvas data
// yet still appears, with an empty course list, so the full roster you
// gave us is always visible rather than silently dropping anyone who
// hasn't been synced.
//
// Reads only from already-synced tables (no live Canvas calls). Caller
// must be an admin.
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  await requireCanvasMastersAdmin(event, supabase)

  const { students, syncStatus } = await buildCanvasMastersRoster(supabase)

  return { data: { students, syncStatus } }
})
