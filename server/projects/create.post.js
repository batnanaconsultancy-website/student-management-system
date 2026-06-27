import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

// POST /api/projects/create
// Body: { name, description?, duration_days?, program_id, season_id, order? }
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })

  const { data: callerRow } = await supabase
    .from('admin').select('email').eq('email', user.email).maybeSingle()
  if (!callerRow) throw createError({ statusCode: 403, statusMessage: 'Admin access required' })

  const body = await readBody(event)
  const { name, description, duration_days, program_id, season_id, order } = body || {}

  if (!name?.trim()) throw createError({ statusCode: 400, statusMessage: 'Project name is required' })
  if (!program_id) throw createError({ statusCode: 400, statusMessage: 'program_id is required' })

  const { data, error } = await supabase
    .from('projects')
    .insert({
      name: name.trim(),
      description: description?.trim() || null,
      duration_days: duration_days || null,
      program_id,
      season_id: season_id || null,
      order: order || 0
    })
    .select('id, name, program_id, season_id, duration_days, order')
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { data, message: `Project "${name}" created` }
})
