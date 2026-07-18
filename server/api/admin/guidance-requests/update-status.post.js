import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

const VALID_STATUSES = ['New', 'In Progress', 'Resolved']

export default defineEventHandler(async (event) => {
  const client = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const { data: adminRow, error: adminError } = await client
    .from('admin')
    .select('email')
    .eq('email', user.email)
    .maybeSingle()

  if (adminError) {
    throw createError({ statusCode: 500, statusMessage: adminError.message })
  }
  if (!adminRow) {
    throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
  }

  const body = await readBody(event)
  const { id, status } = body || {}

  if (!id || !status || !VALID_STATUSES.includes(status)) {
    throw createError({
      statusCode: 400,
      statusMessage: `id and a valid status (${VALID_STATUSES.join(', ')}) are required`
    })
  }

  const { data, error } = await client
    .from('guidance_requests')
    .update({ status })
    .eq('id', id)
    .select('id, status')
    .single()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  return { success: true, data }
})
