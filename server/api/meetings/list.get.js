// server/meetings/list.get.js
// GET /api/meetings/list
// Returns all scheduled meetings (admin only) with program/cohort names joined in.
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
    .from('scheduled_meetings')
    .select(`
      *,
      programs:program_id ( id, name ),
      cohorts:cohort_id ( id, name )
    `)
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true })

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  const rows = (data || []).map((m) => ({
    ...m,
    program_name: m.programs?.name || 'All Programs',
    cohort_name: m.cohorts?.name || 'All Cohorts'
  }))

  return { data: rows }
})
