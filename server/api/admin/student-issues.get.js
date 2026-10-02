// server/api/admin/student-issues.get.js
// GET /api/admin/student-issues
//
// Returns student-reported issues for authenticated admins.

import { createError } from 'h3'
import {
  serverSupabaseClient,
  serverSupabaseUser
} from '#supabase/server'

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Not authenticated'
    })
  }

  // Verify that the logged-in user is an admin.
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

  // Fetch issues together with the student who reported each issue.
  const {
    data,
    error
  } = await supabase
    .from('student_issues')
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
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Failed to fetch student issues:', error)

    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  return {
    data: data || []
  }
})

