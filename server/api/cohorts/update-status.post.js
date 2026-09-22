import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

// POST /api/cohorts/update-status
// Body: { cohort_name: string, is_active: boolean }
// Updates is_active for every cohort row matching that name (i.e. across
// all programs that share this cohort name), since the UI treats
// same-named cohorts across programs as one logical cohort.
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
  const cohortName = typeof body?.cohort_name === 'string' ? body.cohort_name.trim() : ''
  const isActive = !!body?.is_active

  if (!cohortName) {
    throw createError({ statusCode: 400, statusMessage: 'cohort_name is required' })
  }

  const { data, error } = await supabase
    .from('cohorts')
    .update({ is_active: isActive })
    .eq('name', cohortName)
    .select('id, name, is_active')

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  return { data, message: `Cohort "${cohortName}" set to ${isActive ? 'active' : 'inactive'}` }
})
