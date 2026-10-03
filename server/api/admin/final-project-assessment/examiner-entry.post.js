import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'
import { createError, readBody } from 'h3'
import { requireFinalProjectAdmin } from '~/server/utils/finalProjectAuth'

// POST /api/admin/final-project-assessment/examiner-entry
//
// Adds a new examiner, reactivates an inactive examiner, or edits an
// existing examiner.
//
// Body: { id?, email, name, isActive? }
//
// - `id` present -> edit that examiner.
// - `id` absent + email does not exist -> create examiner.
// - `id` absent + email exists but is inactive -> reactivate examiner.
// - `id` absent + email exists and is active -> return duplicate error.
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
    throw createError({
      statusCode: 400,
      statusMessage: 'Name and email are both required',
    })
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createError({
      statusCode: 400,
      statusMessage: "That doesn't look like a valid email address",
    })
  }

  let result

  if (id) {
    const { data, error } = await supabase
      .from('examiners')
      .update({
        email,
        name,
        is_active: isActive,
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      throw createError({
        statusCode: 500,
        statusMessage: error.message,
      })
    }

    result = data
  } else {
    // Check whether this email already has an Examiner record.
    const { data: existing, error: existingError } = await supabase
      .from('examiners')
      .select('id, email, name, is_active')
      .eq('email', email)
      .maybeSingle()

    if (existingError) {
      throw createError({
        statusCode: 500,
        statusMessage: existingError.message,
      })
    }

    if (existing) {
      // An inactive Examiner can be added again by reactivating the
      // existing record instead of attempting a duplicate INSERT.
      if (!existing.is_active) {
        const { data, error } = await supabase
          .from('examiners')
          .update({
            name,
            is_active: true,
          })
          .eq('id', existing.id)
          .select()
          .single()

        if (error) {
          throw createError({
            statusCode: 500,
            statusMessage: error.message,
          })
        }

        result = data

        await supabase.from('audit_log').insert({
          admin_email: adminUser.email,
          action: 'examiner_reactivated',
          entity_type: 'examiner',
          entity_id: data.id,
          details: {
            email,
            name,
          },
        })

        return { data: { examiner: result } }
      }

      throw createError({
        statusCode: 409,
        statusMessage: `${email} is already an examiner.`,
      })
    }

    const { data, error } = await supabase
      .from('examiners')
      .insert({
        email,
        name,
        is_active: isActive,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        throw createError({
          statusCode: 409,
          statusMessage: `${email} is already an examiner.`,
        })
      }

      throw createError({
        statusCode: 500,
        statusMessage: error.message,
      })
    }

    result = data

    await supabase.from('audit_log').insert({
      admin_email: adminUser.email,
      action: 'examiner_added',
      entity_type: 'examiner',
      entity_id: data.id,
      details: {
        email,
        name,
      },
    })
  }

  return { data: { examiner: result } }
})
