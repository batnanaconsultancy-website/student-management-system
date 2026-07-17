import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'
import { writeAuditLog } from '~/server/utils/auditLog'

// POST /api/students/bulk-update-status
// Body: { student_ids: string[], account_status: 'Active' | 'Inactive' | 'Frozen' | 'Graduated' }
// Updates account_status (and the matching is_active flag) for many
// students at once. Caller must already be an admin.
export default defineEventHandler(async (event) => {
  const client = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const { data: callerRow, error: callerError } = await client
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
  const { student_ids, account_status } = body || {}

  const VALID_STATUSES = ['Active', 'Inactive', 'Frozen', 'Graduated']

  if (!Array.isArray(student_ids) || student_ids.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'student_ids must be a non-empty array' })
  }
  if (!account_status || !VALID_STATUSES.includes(account_status)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid account_status. Must be one of: ${VALID_STATUSES.join(', ')}`
    })
  }

  const is_active = account_status === 'Active'

  try {
    // Fetch prior statuses first, for a meaningful audit log (and to
    // confirm the ids are real students rather than silently no-op'ing).
    const { data: existingStudents, error: fetchError } = await client
      .from('students')
      .select('id, username, account_status')
      .in('id', student_ids)

    if (fetchError) {
      throw createError({ statusCode: 500, statusMessage: fetchError.message })
    }
    if (!existingStudents || existingStudents.length === 0) {
      throw createError({ statusCode: 404, statusMessage: 'No matching students found' })
    }

    const { data: updatedStudents, error: updateError } = await client
      .from('students')
      .update({ account_status, is_active })
      .in('id', student_ids)
      .select('id, username, account_status, is_active')

    if (updateError) {
      console.error('Error bulk-updating student status:', updateError)
      throw createError({
        statusCode: 500,
        statusMessage: updateError.message || 'Failed to update student statuses'
      })
    }

    await writeAuditLog(
      client,
      user.email,
      'bulk_update_student_status',
      'student',
      null,
      {
        student_ids,
        student_usernames: existingStudents.map((s) => s.username),
        to: account_status,
        count: updatedStudents?.length || 0,
      },
      event
    )

    return {
      success: true,
      data: updatedStudents,
      message: `Updated ${updatedStudents?.length || 0} student(s) to "${account_status}"`
    }
  } catch (err) {
    console.error('Bulk update student status handler error:', err)
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err?.message || err?.statusMessage || 'Internal server error'
    })
  }
})
