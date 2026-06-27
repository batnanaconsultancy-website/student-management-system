// server/student/notifications.get.js
// GET /api/student/notifications
// Returns system notifications for the logged-in student.
// These are stored in student_notifications table (see SQL migration).
import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const { data: student } = await supabase
    .from('students')
    .select('id')
    .eq('email', user.email)
    .maybeSingle()

  if (!student) {
    return { data: [], unread_count: 0 }
  }

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
