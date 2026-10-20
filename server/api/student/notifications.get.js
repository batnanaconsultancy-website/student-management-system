// server/student/notifications.get.js
// GET /api/student/notifications
// Returns system notifications for the logged-in student.
// These are stored in student_notifications table (see SQL migration).
import { createError } from 'h3'
import { serverSupabaseClient } from '#supabase/server'
import { resolveStudentViewContext } from '~/server/utils/studentView'

export default defineEventHandler(async (event) => {
  const authenticatedClient = await serverSupabaseClient(event)
  const context = await resolveStudentViewContext(event, authenticatedClient)
  const supabase = context.dataClient
  const student = context.student

  const { data, error } = await supabase
    .from('student_notifications')
    .select('*')
    .eq('student_id', student.id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  const unread = (data || []).filter(n => !n.is_read).length

  return { data: data || [], unread_count: unread }
})
