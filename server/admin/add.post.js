import { writeAuditLog } from '~/server/utils/auditLog'
import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

// POST /api/admin/add
// Body: { emails: string[] }
// Adds one or more emails to the admin allowlist. Caller must already be an admin.
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
  const emails = Array.isArray(body?.emails) ? body.emails : []

  const cleanEmails = emails
    .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
    .filter((e) => e.length > 0 && e.includes('@'))

  if (cleanEmails.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No valid email addresses provided' })
  }

  const rows = cleanEmails.map((email) => ({ email }))

  // Upsert so re-adding an existing admin email doesn't error
  const { data, error } = await supabase
    .from('admin')
    .upsert(rows, { onConflict: 'email', ignoreDuplicates: true })
    .select('id, email, created_at')

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  await writeAuditLog(supabase, user.email, 'add_admin', 'admin', null,
    { emails: cleanEmails }, event)

  return {
    data,
    message: `${cleanEmails.length} admin(s) added`
  }
})
