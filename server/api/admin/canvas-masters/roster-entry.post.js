import { serverSupabaseClient } from '#supabase/server'
import { createError, readBody } from 'h3'
import { requireCanvasMastersAdmin } from '~/server/utils/canvasMastersRoster'

// POST /api/admin/canvas-masters/roster-entry
//
// Adds a student to the fixed Canvas Masters roster, or edits an
// existing one -- both are the same upsert, keyed on email (the
// table's primary key). This is the only supported way to manage the
// roster outside of editing canvas_student_labels directly in the
// database.
//
// Adding someone here does NOT pull their Canvas data -- it just makes
// them appear in the roster (initially unsynced, with an empty course
// list). Use "Sync From Canvas" on the roster page afterwards to
// resolve them and pull their courses/outcomes/submissions.
//
// Body: { email, program, cohortLabel, originalEmail? }
// `originalEmail`, when present, means "this is an edit of an existing
// row" -- if the email itself changed, the old row is deleted after
// the new one is written (email is the primary key, so you can't just
// UPDATE it in place without either an upsert-then-delete or a rename;
// upsert-then-delete keeps this a single simple code path for both
// add and edit).
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  await requireCanvasMastersAdmin(event, supabase)

  const body = await readBody(event)
  const email = String(body?.email || '').trim().toLowerCase()
  const program = String(body?.program || '').trim()
  const cohortLabel = String(body?.cohortLabel || '').trim()
  const originalEmail = body?.originalEmail ? String(body.originalEmail).trim().toLowerCase() : null

  if (!email || !program || !cohortLabel) {
    throw createError({ statusCode: 400, statusMessage: 'email, program, and cohortLabel are all required' })
  }
  // Basic sanity check -- not exhaustive email validation, just enough
  // to catch obvious typos before they end up in the roster.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createError({ statusCode: 400, statusMessage: 'That doesn\'t look like a valid email address' })
  }

  const { data: upserted, error: upsertError } = await supabase
    .from('canvas_student_labels')
    .upsert(
      { email, program, cohort_label: cohortLabel, updated_at: new Date().toISOString() },
      { onConflict: 'email' }
    )
    .select()
    .single()

  if (upsertError) {
    throw createError({ statusCode: 500, statusMessage: upsertError.message })
  }

  // Editing and changing the email: the upsert above created a NEW row
  // under the new email, so the old row (under originalEmail) needs to
  // be removed separately, or the student would show up twice.
  if (originalEmail && originalEmail !== email) {
    const { error: deleteError } = await supabase
      .from('canvas_student_labels')
      .delete()
      .eq('email', originalEmail)

    if (deleteError) {
      throw createError({ statusCode: 500, statusMessage: `Saved the new email, but failed to remove the old row (${originalEmail}): ${deleteError.message}` })
    }
  }

  return { data: { entry: upserted } }
})
