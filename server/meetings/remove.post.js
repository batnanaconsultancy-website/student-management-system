// server/meetings/remove.post.js
// POST /api/meetings/remove
// Body: { id }
import { writeAuditLog } from '~/server/utils/auditLog'
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

  const body = await readBody(event)
  const id = body?.id

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'id is required' })
  }

  const { error } = await supabase
    .from('scheduled_meetings')
    .delete()
    .eq('id', id)

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  await writeAuditLog(supabase, user.email, 'delete_scheduled_meeting', 'scheduled_meeting', id, {}, event)

  return { message: 'Meeting deleted' }
})
