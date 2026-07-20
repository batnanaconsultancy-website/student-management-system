// server/student/notifications-read.post.js
// POST /api/student/notifications-read
// Body: { notification_ids: string[] } or {} to mark all read
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

  if (!student) throw createError({ statusCode: 404, statusMessage: 'Student not found' })

  const body = await readBody(event)
  const ids = Array.isArray(body?.notification_ids) ? body.notification_ids : null

  let q = supabase
    .from('student_notifications')
    .update({ is_read: true })
    .eq('student_id', student.id)

  if (ids) q = q.in('id', ids)

  const { error } = await q
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { message: 'Notifications marked as read' }
})
