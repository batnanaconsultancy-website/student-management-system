import { writeAuditLog } from '~/server/utils/auditLog'
import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

// POST /api/admin/remove
// Body: { email: string }
// Removes an email from the admin allowlist. Caller must already be an admin.
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const { data: callerRow, error: callerError } = await supabase
    .from('admin')
    .select('email')
    .eq('email', user.email)
    .maybeSingle()

  if (callerError) {
    throw createError({ statusCode: 500, statusMessage: callerError.message })
  }
  if (!callerRow) {
    throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
  }

  const body = await readBody(event)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''

  if (!email) {
    throw createError({ statusCode: 400, statusMessage: 'Email is required' })
  }

  // Prevent an admin from removing their own access by accident,
  // which could lock everyone out if they're the only admin.
  if (email === user.email.toLowerCase()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'You cannot remove your own admin access from this page'
    })
  }

  const { error } = await supabase
    .from('admin')
    .delete()
    .eq('email', email)

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  await writeAuditLog(supabase, user.email, 'remove_admin', 'admin', null,
    { removed_email: email }, event)

  return { message: `${email} removed from admins` }
})
