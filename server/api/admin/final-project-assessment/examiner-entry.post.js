import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'
import { createError, readBody } from 'h3'
import { requireFinalProjectAdmin } from '~/server/utils/finalProjectAuth'

// POST /api/admin/final-project-assessment/examiner-entry
//
// Adds a new examiner, or edits an existing one (pass `id` to edit).
// This is the "structure it so it can later be replaced by a
// database/API-driven instructor list" piece of Section 1 -- examiners
// are added through this form rather than a migration seed, so the
// list can grow without touching the database directly.
//
// Body: { id?, email, name, isActive? }
// `id` present -> edit that examiner. `id` absent -> add new (email
// must not already exist -- the table's UNIQUE constraint on email
// enforces this; a duplicate attempt surfaces as a clear error rather
// than silently creating a second row).
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  await requireFinalProjectAdmin(event, supabase)
  const adminUser = await serverSupabaseUser(event)

  const body = await readBody(event)
  const id = body?.id || null
  const email = String(body?.email || '').trim().toLowerCase()
  const name = String(body?.name || '').trim()
  const isActive = body?.isActive === undefined ? true : Boolean(body.isActive)

  if (!email || !name) {
    throw createError({ statusCode: 400, statusMessage: 'Name and email are both required' })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createError({ statusCode: 400, statusMessage: "That doesn't look like a valid email address" })
  }

  let result
  if (id) {
    const { data, error } = await supabase
      .from('examiners')
      .update({ email, name, is_active: isActive })
      .eq('id', id)
      .select()
      .single()
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    result = data
  } else {
    const { data, error } = await supabase
      .from('examiners')
      .insert({ email, name, is_active: isActive })
      .select()
      .single()
    if (error) {
      // Postgres unique_violation
      if (error.code === '23505') {
        throw createError({ statusCode: 409, statusMessage: `${email} is already an examiner.` })
      }
      throw createError({ statusCode: 500, statusMessage: error.message })
    }
    result = data

    await supabase.from('audit_log').insert({
      admin_email: adminUser.email,
      action: 'examiner_added',
      entity_type: 'examiner',
      entity_id: data.id,
      details: { email, name },
    })
  }

  return { data: { examiner: result } }
})
