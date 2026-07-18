import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

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

  // RLS already grants any admin full access to every request (see
  // "guidance_requests: admin full access" policy) -- this select isn't
  // scoped by student, so every admin sees every submission.
  const { data, error } = await client
    .from('guidance_requests')
    .select(`
      id,
      categories,
      message,
      status,
      created_at,
      students:student_id ( id, first_name, last_name, email, username )
    `)
    .order('created_at', { ascending: false })

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  return { data: data || [] }
})
