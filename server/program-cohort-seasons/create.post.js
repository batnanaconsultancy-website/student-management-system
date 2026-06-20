import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

// POST /api/program-cohort-seasons/create
// Body: { program_id, cohort_id, season_id, start_date, end_date }
// Schedules an existing season onto an existing cohort, with concrete
// dates for that cohort's run through it. This is what the
// Management → Seasons page uses to populate the Timeline page later.
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
  const { program_id, cohort_id, season_id, start_date, end_date } = body || {}

  if (!program_id || !cohort_id || !season_id || !start_date || !end_date) {
    throw createError({
      statusCode: 400,
      statusMessage: 'program_id, cohort_id, season_id, start_date, and end_date are all required'
    })
  }

  const { data, error } = await supabase
    .from('program_cohort_seasons')
    .insert({ program_id, cohort_id, season_id, start_date, end_date })
    .select('id, program_id, cohort_id, season_id, start_date, end_date')
    .single()

  if (error) {
    if (error.code === '23505') {
      throw createError({
        statusCode: 409,
        statusMessage: 'This season is already scheduled for this cohort'
      })
    }
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  return { data, message: 'Season scheduled successfully' }
})
