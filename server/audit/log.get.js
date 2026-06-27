import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

// GET /api/audit/log?limit=50&offset=0&admin=&action=
export default defineEventHandler(async (event) => {
  const client = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const { data: callerRow } = await client
    .from('admin').select('email').eq('email', user.email).maybeSingle()

  if (!callerRow) {
    throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
  }

  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 50, 200)
  const offset = Number(query.offset) || 0

  let q = client
    .from('audit_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (query.admin) q = q.ilike('admin_email', `%${query.admin}%`)
  if (query.action) q = q.eq('action', query.action)

  const { data, error, count } = await q

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { data, total: count, limit, offset }
})
