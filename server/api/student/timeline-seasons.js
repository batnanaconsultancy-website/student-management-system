import { serverSupabaseClient } from '#supabase/server'
import { resolveStudentViewContext } from '~/server/utils/studentView'

export default defineEventHandler(async (event) => {
  try {
    const authenticatedClient = await serverSupabaseClient(event)
    const context = await resolveStudentViewContext(event, authenticatedClient)
    const client = context.dataClient
    const student = context.student

    // Fetch seasons for the student's cohort and program
    const { data: seasonsProgress, error: progressError } = await client
      .from('program_cohort_seasons')
      .select(`
        id,
        start_date,
        end_date,
        cohort_id,
        program_id,
        season_id,
        seasons!inner (
          id,
          name,
          program_id
        )
      `)
      .eq('cohort_id', student.cohort_id)
      .eq('program_id', student.program_id)
      .order('start_date', { ascending: true })

    if (progressError) {
      throw createError({ statusCode: 500, statusMessage: progressError.message })
    }

    // Format seasons for dropdown and timeline
    const studentSeasons = (seasonsProgress || []).map(season => ({
      label: season.seasons.name,
      value: String(season.seasons.id)
    }))

    const cohortSeasonsDeadlines = (seasonsProgress || []).map(season => ({
      id: String(season.seasons.id),
      name: season.seasons.name,
      start_date: season.start_date,
      end_date: season.end_date,
      program_cohort_season_id: season.id,
      type: 2
    }))

    return {
      data: {
        studentProgramId: student.program_id,
        studentCohortId: student.cohort_id,
        currentSeasonId: student.current_season_id ?? null,
        studentSeasons,
        cohortSeasonsDeadlines,
        rawSeasons: seasonsProgress
      }
    }
  } catch (err) {
    console.error('Timeline seasons handler error:', err)
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err?.message || 'Internal server error'
    })
  }
})
