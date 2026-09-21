import { serverSupabaseClient } from '#supabase/server'
import { createError } from 'h3'
import { buildCanvasMastersRoster, requireCanvasMastersAdmin } from '~/server/utils/canvasMastersRoster'

// GET /api/admin/canvas-masters/student/:email
//
// Powers pages/admin/canvas-masters/[email].vue -- the single-student
// dashboard that opens when an admin clicks a student on the Canvas
// Masters roster. Returns everything roster.get.js returns for one
// student (name, program/cohort, attendance, and the full nested
// Course -> Learning Outcome -> Assignment tree), instead of the
// whole roster.
//
// Keyed by email rather than the internal Canvas student id, because
// a student who hasn't been Canvas-synced yet has no such id (see
// buildCanvasMastersRoster's `unsynced:<email>` placeholder) -- email
// is the one identifier that's stable and known for every roster
// member from the moment they're added, synced or not.
//
// This currently re-runs the same roster-wide queries as roster.get.js
// and picks out one student, rather than querying just for this
// student -- the roster is small (a few dozen students), so the extra
// work is cheap, and it guarantees this page can never disagree with
// the list page it was opened from. If the roster grows large enough
// for that to matter, buildCanvasMastersRoster can be split into a
// single-student query path without changing this endpoint's contract.
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  await requireCanvasMastersAdmin(event, supabase)

  const rawEmail = getRouterParam(event, 'email')
  if (!rawEmail) {
    throw createError({ statusCode: 400, statusMessage: 'Missing student email' })
  }
  const email = decodeURIComponent(rawEmail).toLowerCase()

  const { students } = await buildCanvasMastersRoster(supabase)
  const student = students.find((s) => s.email.toLowerCase() === email)

  if (!student) {
    throw createError({ statusCode: 404, statusMessage: 'Student not found in the masters roster' })
  }

  return { data: { student } }
})
