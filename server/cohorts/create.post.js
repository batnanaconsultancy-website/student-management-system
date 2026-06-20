import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

// POST /api/cohorts/create
// Body: { name, meeting_id?, is_active?, programs: [{ program_id, start_date, end_date }] }
// Creates one cohort row per program in the programs array, all sharing
// the same name. This is what lets the Add Cohort modal support
// multi-program selection in a single submission.
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
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const meetingId = typeof body?.meeting_id === 'string' ? body.meeting_id.trim() : null
  const isActive = body?.is_active !== false
  const programs = Array.isArray(body?.programs) ? body.programs : []

  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'Cohort name is required' })
  }
  if (programs.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'At least one program is required' })
  }

  for (const p of programs) {
    if (!p.program_id || !p.start_date || !p.end_date) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Each program entry requires program_id, start_date, and end_date'
      })
    }
  }

  const rows = programs.map((p) => ({
    name,
    program_id: p.program_id,
    start_date: p.start_date,
    end_date: p.end_date,
    meeting_id: meetingId,
    is_active: isActive
  }))

  const { data, error } = await supabase
    .from('cohorts')
    .insert(rows)
    .select('id, name, program_id, start_date, end_date, meeting_id, is_active')

  if (error) {
    // Unique constraint violation = cohort already exists for that program
    if (error.code === '23505') {
      throw createError({
        statusCode: 409,
        statusMessage: `A cohort named "${name}" already exists for one of the selected programs`
      })
    }
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  return { data, message: `Cohort "${name}" created for ${rows.length} program(s)` }
})
