// server/admin/notifications.get.js
// GET /api/admin/notifications
// Returns inbox-style notifications for the logged-in admin
// (status changes, student issue reports, pipeline failures, etc).
import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const { data: callerRow } = await supabase
    .from('admin')
    .select('email')
    .eq('email', user.email)
    .maybeSingle()

  if (!callerRow) {
    throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
  }

  const { data, error } = await supabase
    .from('admin_notifications')
    .select('*')
    .eq('admin_email', user.email)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  const unread = (data || []).filter(n => !n.is_read).length

  return { data: data || [], unread_count: unread }
})
