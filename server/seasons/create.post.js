import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

// POST /api/seasons/create
// Body: { name, program_id, order_in_program }
// Creates a new raw season definition (not a scheduling — that's program_cohort_seasons)
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })

  const { data: callerRow } = await supabase
    .from('admin').select('email').eq('email', user.email).maybeSingle()
  if (!callerRow) throw createError({ statusCode: 403, statusMessage: 'Admin access required' })

  const body = await readBody(event)
  const { name, program_id, order_in_program } = body || {}

  if (!name?.trim()) throw createError({ statusCode: 400, statusMessage: 'Season name is required' })
  if (!program_id) throw createError({ statusCode: 400, statusMessage: 'program_id is required' })

  const { data, error } = await supabase
    .from('seasons')
    .insert({ name: name.trim(), program_id, order_in_program: order_in_program || 0 })
    .select('id, name, program_id, order_in_program')
    .single()

  if (error) {
    if (error.code === '23505') throw createError({ statusCode: 409, statusMessage: `Season "${name}" already exists for this programme` })
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  return { data, message: `Season "${name}" created` }
})
