import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

// POST /api/auth/ensure-profile
// Called right after Google OAuth completes (see pages/auth/confirm.vue).
// Checks whether the logged-in email is in the admin table; returns
// the resulting role so the client knows where to redirect.
// Does NOT create a students row automatically — students are still
// expected to be added via CSV import by an admin beforehand. If no
// matching student row exists yet, role defaults to 'user' and the
// student dashboard will show empty/zero state until an admin imports them.
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const { data: adminRow, error: adminError } = await supabase
    .from('admin')
    .select('email')
    .eq('email', user.email)
    .maybeSingle()

  if (adminError) {
    throw createError({ statusCode: 500, statusMessage: adminError.message })
  }

  const role = adminRow ? 'admin' : 'user'

  return { success: true, role }
})
