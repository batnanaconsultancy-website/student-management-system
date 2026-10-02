// server/api/admin/student-issues/update.post.js
// POST /api/admin/student-issues/update
//
// Updates the status and/or admin notes for a student-reported issue.

import { createError, readBody } from 'h3'
import {
  serverSupabaseClient,
  serverSupabaseUser
} from '#supabase/server'

const ALLOWED_STATUSES = [
  'open',
  'in_progress',
  'resolved'
]

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Not authenticated'
    })
  }

  // Verify admin access.
  const {
    data: callerRow,
    error: adminError
  } = await supabase
    .from('admin')
    .select('email')
    .eq('email', user.email)
    .maybeSingle()

  if (adminError) {
    console.error('Failed to verify admin access:', adminError)

    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to verify admin access'
    })
  }

  if (!callerRow) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Admin access required'
    })
  }

  const body = await readBody(event)

  const id =
    typeof body?.id === 'string'
      ? body.id.trim()
      : ''

  const status =
    typeof body?.status === 'string'
      ? body.status.trim()
      : ''

  const adminNotes =
    typeof body?.admin_notes === 'string'
      ? body.admin_notes.trim()
      : null

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Issue id is required'
    })
  }

  if (!status || !ALLOWED_STATUSES.includes(status)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid status. Allowed values: ${ALLOWED_STATUSES.join(', ')}`
    })
  }

  const {
    data,
    error
  } = await supabase
    .from('student_issues')
    .update({
      status,
      admin_notes: adminNotes,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select(`
      id,
      student_id,
      type,
      description,
      status,
      admin_notes,
      created_at,
      updated_at,
      students (
        id,
        first_name,
        last_name,
        email
      )
    `)
    .single()

  if (error) {
    console.error('Failed to update student issue:', error)

    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  return {
    data,
    message: 'Student issue updated successfully'
  }
})

