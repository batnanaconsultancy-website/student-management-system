import { writeAuditLog } from '~/server/utils/auditLog'
import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

// POST /api/students/bulk-action
// Body: { action: 'deactivate' | 'activate' | 'graduate' | 'reassign-cohort', student_ids: string[], cohort_id?: string }
export default defineEventHandler(async (event) => {
  const client = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const { data: callerRow } = await client
    .from('admin')
    .select('email')
    .eq('email', user.email)
    .maybeSingle()

  if (!callerRow) {
    throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
  }

  const body = await readBody(event)
  const { action, student_ids, cohort_id } = body || {}

  if (!action || !Array.isArray(student_ids) || student_ids.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'action and student_ids array are required' })
  }

  const validActions = ['deactivate', 'activate', 'graduate', 'reassign-cohort']
  if (!validActions.includes(action)) {
    throw createError({ statusCode: 400, statusMessage: `action must be one of: ${validActions.join(', ')}` })
  }

  if (action === 'reassign-cohort' && !cohort_id) {
    throw createError({ statusCode: 400, statusMessage: 'cohort_id is required for reassign-cohort action' })
  }

  let update = {}
  switch (action) {
    case 'deactivate':
      update = { account_status: 'Inactive', is_active: false }
      break
    case 'activate':
      update = { account_status: 'Active', is_active: true }
      break
    case 'graduate':
      update = { account_status: 'Graduated', is_active: false }
      break
    case 'reassign-cohort':
      update = { cohort_id }
      break
  }

  const { data, error } = await client
    .from('students')
    .update(update)
    .in('id', student_ids)
    .select('id, first_name, last_name, email, account_status, is_active, cohort_id')

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  await writeAuditLog(client, user.email, 'bulk_action', 'student', null,
    { action, count: data.length, student_ids, cohort_id }, event)

  return {
    affected: data.length,
    action,
    message: `${action} applied to ${data.length} student(s)`
  }
})
