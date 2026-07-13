import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'
import { writeAuditLog } from '~/server/utils/auditLog'

// POST /api/students/update-status
// Body: { student_id: string, account_status: 'Active' | 'Inactive' | 'Frozen' | 'Graduated' }
// Updates a student's account_status (and the matching is_active flag).
// Caller must already be an admin.
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
  const { student_id, account_status } = body || {}

  const VALID_STATUSES = ['Active', 'Inactive', 'Frozen', 'Graduated']

  if (!student_id || !account_status) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required fields: student_id, account_status'
    })
  }

  if (!VALID_STATUSES.includes(account_status)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid account_status. Must be one of: ${VALID_STATUSES.join(', ')}`
    })
  }

  // is_active mirrors account_status: only 'Active' counts as active.
  const is_active = account_status === 'Active'

  try {
    const { data: existingStudent, error: fetchError } = await client
      .from('students')
      .select('id, account_status')
      .eq('id', student_id)
      .maybeSingle()

    if (fetchError) {
      throw createError({ statusCode: 500, statusMessage: fetchError.message })
    }
    if (!existingStudent) {
      throw createError({ statusCode: 404, statusMessage: 'Student not found' })
    }

    const { data: updatedStudent, error: updateError } = await client
      .from('students')
      .update({ account_status, is_active })
      .eq('id', student_id)
      .select('id, account_status, is_active')
      .single()

    if (updateError) {
      console.error('Error updating student account status:', updateError)
      throw createError({
        statusCode: 500,
        statusMessage: updateError.message || 'Failed to update student status'
      })
    }

    await writeAuditLog(
      client,
      user.email,
      'update_student_status',
      'student',
      student_id,
      { from: existingStudent.account_status, to: account_status },
      event
    )

    return {
      success: true,
      data: updatedStudent,
      message: `Student status updated to "${account_status}"`
    }
  } catch (err) {
    console.error('Update student status handler error:', err)
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err?.message || err?.statusMessage || 'Internal server error'
    })
  }
})
