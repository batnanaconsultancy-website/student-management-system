import { serverSupabaseClient } from '#supabase/server'
import { createError, readBody } from 'h3'
import { requireCanvasMastersAdmin } from '~/server/utils/canvasMastersRoster'

// DELETE /api/admin/canvas-masters/roster-entry
//
// Removes a student from the fixed Canvas Masters roster (deletes
// their canvas_student_labels row). They'll stop appearing on the
// roster page immediately.
//
// This does NOT delete any Canvas data already synced for them
// (canvas_students, canvas_enrollments, canvas_submissions, etc) --
// it only removes them from the roster listing, which is keyed off
// canvas_student_labels. If they're re-added later with the same
// email, their previously-synced Canvas data (if any) will show up
// again automatically without needing to re-sync.
//
// Body: { email }
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  await requireCanvasMastersAdmin(event, supabase)

  const body = await readBody(event)
  const email = String(body?.email || '').trim().toLowerCase()

  if (!email) {
    throw createError({ statusCode: 400, statusMessage: 'email is required' })
  }

  const { error: deleteError } = await supabase
    .from('canvas_student_labels')
    .delete()
    .eq('email', email)

  if (deleteError) {
    throw createError({ statusCode: 500, statusMessage: deleteError.message })
  }

  return { data: { removed: email } }
})
