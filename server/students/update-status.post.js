import { writeAuditLog } from '~/server/utils/auditLog'
import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

// POST /api/students/update-status
// Body: { student_id, account_status, is_active }
// account_status: 'Active' | 'Inactive' | 'Frozen' | 'Graduated'
// is_active: boolean — controls whether scraper picks up this student
// Admin-only. Soft-delete only: no rows are ever deleted, just flagged.
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
  const { student_id, account_status, is_active } = body || {}

  if (!student_id) {
    throw createError({ statusCode: 400, statusMessage: 'student_id is required' })
  }

  const validStatuses = ['Active', 'Inactive', 'Frozen', 'Graduated']
  if (account_status && !validStatuses.includes(account_status)) {
    throw createError({
      statusCode: 400,
      statusMessage: `account_status must be one of: ${validStatuses.join(', ')}`
    })
  }

  const update = {}
  if (account_status !== undefined) update.account_status = account_status
  if (is_active !== undefined) update.is_active = !!is_active

  // Convenience: setting account_status automatically syncs is_active
  if (account_status === 'Active') update.is_active = true
  if (['Inactive', 'Frozen', 'Graduated'].includes(account_status)) update.is_active = false

  const { data, error } = await supabase
    .from('students')
    .update(update)
    .eq('id', student_id)
    .select('id, first_name, last_name, email, account_status, is_active')
    .single()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  await writeAuditLog(supabase, user.email, 'change_student_status', 'student', student_id,
    { account_status, is_active: data.is_active }, event)

  return { data, message: `Student updated: ${data.first_name} ${data.last_name} → ${data.account_status}` }
})
