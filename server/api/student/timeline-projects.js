import { serverSupabaseClient } from '#supabase/server'
import { resolveStudentViewContext } from '~/server/utils/studentView'

export default defineEventHandler(async (event) => {
  try {
    const authenticatedClient = await serverSupabaseClient(event)
    const context = await resolveStudentViewContext(event, authenticatedClient)
    const client = context.dataClient
    const student = context.student

    const query = getQuery(event)
    const programCohortSeasonId = query.programCohortSeasonId

    if (!programCohortSeasonId) {
      return { data: [] }
    }

    if (typeof programCohortSeasonId !== 'string') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid program cohort season ID',
      })
    }

    // Service-role queries bypass RLS, so verify the requested schedule
    // belongs to the selected student's cohort and program first.
    const { data: allowedSeason, error: allowedSeasonError } = await client
      .from('program_cohort_seasons')
      .select('id')
      .eq('id', programCohortSeasonId)
      .eq('cohort_id', student.cohort_id)
      .eq('program_id', student.program_id)
      .maybeSingle()

    if (allowedSeasonError) {
      throw createError({
        statusCode: 500,
        statusMessage: allowedSeasonError.message,
      })
    }

    if (!allowedSeason) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Timeline season not found for this student',
      })
    }

    // Fetch projects for this program_cohort_season
    const { data: projectSchedules, error: scheduleError } = await client
      .from('program_cohort_season_projects')
      .select(`
        id,
        start_date,
        end_date,
        projects!inner (
          id,
          name,
          description
        )
      `)
      .eq('program_cohort_season_id', programCohortSeasonId)

    if (scheduleError) {
      throw createError({ statusCode: 500, statusMessage: scheduleError.message })
    }

    return { data: projectSchedules || [] }
  } catch (err) {
    console.error('Timeline projects handler error:', err)
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err?.message || 'Internal server error'
    })
  }
})
