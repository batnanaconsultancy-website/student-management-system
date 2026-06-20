import { createError } from 'h3'
import { serverSupabaseClient } from '#supabase/server'

// POST /api/admin/check
// Body: { email: string }
// Returns whether the given email exists in the admin table.
// No admin-only guard here since useAuth.ts relies on this during
// the login flow itself, before the caller's own role is known.
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const body = await readBody(event)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''

  if (!email) {
    throw createError({ statusCode: 400, statusMessage: 'Email is required' })
  }

  const { data, error } = await supabase
    .from('admin')
    .select('email')
    .eq('email', email)
    .maybeSingle()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  return { isAdmin: !!data }
})
