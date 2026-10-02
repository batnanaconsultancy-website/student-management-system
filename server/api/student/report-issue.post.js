// server/api/student/report-issue.post.js
// POST /api/student/report-issue
//
// Creates a student_issues record and creates an in-app notification
// for every admin.
//
// Important:
// The student request uses the normal authenticated Supabase client for
// authentication and the student record. Admin notifications are created
// with the service-role client because normal students are not allowed by
// RLS to insert rows into admin_notifications.

import { createError, readBody } from 'h3'
import {
  serverSupabaseClient,
  serverSupabaseServiceRole,
  serverSupabaseUser
} from '#supabase/server'

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const serviceSupabase = serverSupabaseServiceRole(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Not authenticated'
    })
  }

  const { data: student, error: studentError } = await supabase
    .from('students')
    .select('id, first_name, last_name, email')
    .eq('email', user.email)
    .maybeSingle()

  if (studentError) {
    console.error('Failed to find student record:', studentError)

    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to load student record'
    })
  }

  if (!student) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Student record not found'
    })
  }

  const body = await readBody(event)

  const type =
    typeof body?.type === 'string'
      ? body.type.trim()
      : ''

  const description =
    typeof body?.description === 'string'
      ? body.description.trim()
      : ''

  if (!type || !description) {
    throw createError({
      statusCode: 400,
      statusMessage: 'type and description are required'
    })
  }

  // ------------------------------------------------------------
  // 1. Create the student issue
  // ------------------------------------------------------------

  const { data, error } = await supabase
    .from('student_issues')
    .insert({
      student_id: student.id,
      type,
      description,
      status: 'open'
    })
    .select('id')
    .single()

  if (error) {
    console.error('Failed to create student issue:', error)

    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  // ------------------------------------------------------------
  // 2. Create admin notifications
  //
  // Use the service-role client because the student is not allowed
  // by RLS to insert rows into admin_notifications.
  // ------------------------------------------------------------

  const {
    data: admins,
    error: adminsError
  } = await serviceSupabase
    .from('admin')
    .select('email')

  if (adminsError) {
    console.error(
      'Student issue created, but failed to load admins for notification:',
      adminsError
    )

    throw createError({
      statusCode: 500,
      statusMessage: 'Issue created, but admin notification could not be created'
    })
  }

  if (admins && admins.length > 0) {
    const notificationRows = admins.map((admin) => ({
      admin_email: admin.email,
      type: 'student_issue',
      title: `Issue reported by ${student.first_name} ${student.last_name}`,
      body: `${type}: ${description}`,
      entity_type: 'student_issue',
      entity_id: data.id,
      is_read: false
    }))

    const {
      error: notificationError
    } = await serviceSupabase
      .from('admin_notifications')
      .insert(notificationRows)

    if (notificationError) {
      console.error(
        'Student issue created, but failed to create admin notifications:',
        notificationError
      )

      throw createError({
        statusCode: 500,
        statusMessage: 'Issue created, but admin notification could not be created'
      })
    }
  }

  return {
    data,
    message: 'Issue reported successfully. An admin will review it shortly.'
  }
})

