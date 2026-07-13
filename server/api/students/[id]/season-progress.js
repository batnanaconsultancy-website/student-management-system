import { createError } from 'h3'
import { serverSupabaseClient } from '#supabase/server'
import { isSeasonCompleted } from '~/server/utils/seasonCompletion'

/**
 * GET /api/students/:id/season-progress
 * Fetch student's season progress with complete season list for their program
 * Merges actual progress with all available seasons to show complete roadmap
 */
export default defineEventHandler(async (event) => {
  try {
    const studentId = getRouterParam(event, 'id')

    if (!studentId) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Student ID is required'
      })
    }

    const client = await serverSupabaseClient(event)

    // First, get the student's cohort and program info
    const { data: studentData, error: studentError } = await client
      .from('students')
      .select('cohort_id, program_id')
      .eq('id', studentId)
      .single()

    if (studentError || !studentData) {
      console.error('Error fetching student data:', studentError)
      throw createError({
        statusCode: 404,
        statusMessage: studentError?.message || 'Student not found'
      })
    }

    // Fetch ALL seasons for the program (to show complete list)
    const { data: allSeasons, error: seasonsError } = await client
      .from('seasons')
      .select('id, name, order_in_program')
      .eq('program_id', studentData.program_id)
      .order('order_in_program', { ascending: true })

    if (seasonsError) {
      console.error('Error fetching all seasons:', seasonsError)
      throw createError({
        statusCode: 500,
        statusMessage: seasonsError.message || 'Failed to fetch seasons'
      })
    }

    // Fetch student's actual progress
    const { data: progressData, error: progressError } = await client
      .from('student_season_progress')
      .select('*')
      .eq('student_id', studentId)

    if (progressError) {
      console.error('Error fetching season progress:', progressError)
      throw createError({
        statusCode: 500,
        statusMessage: progressError.message || 'Failed to fetch season progress'
      })
    }

    // Fetch program_cohort_seasons for date information
    const { data: cohortSeasonsData, error: cohortSeasonsError } = await client
      .from('program_cohort_seasons')
      .select('season_id, start_date, end_date')
      .eq('cohort_id', studentData.cohort_id)
      .eq('program_id', studentData.program_id)

    if (cohortSeasonsError) {
      console.error('Error fetching cohort seasons:', cohortSeasonsError)
    }

    // Create complete list: for each season, merge with student progress (if exists)
    const mergedData = allSeasons?.map(season => {
      // Find student's progress for this season (if any)
      const progress = progressData?.find(p => p.season_id === season.id)

      // Find cohort season dates
      const cohortSeason = cohortSeasonsData?.find(cs => cs.season_id === season.id)

      // If student has progress, use it; otherwise create default "Not Started" entry
      return {
        id: progress?.id || `placeholder-${season.id}`,
        student_id: studentId,
        season_id: season.id,
        progress_percentage: progress?.progress_percentage || 0,
        is_completed: isSeasonCompleted(progress?.progress_percentage, progress?.is_completed),
        completion_date: progress?.completion_date || null,
        created_at: progress?.created_at || null,
        updated_at: progress?.updated_at || null,
        seasons: season,
        program_cohort_seasons: cohortSeason || null
      }
    })

    return { data: mergedData || [] }
  } catch (err) {
    console.error('Season progress handler error:', err)

    // If it's already a createError, re-throw it
    if (err.statusCode) {
      throw err
    }

    throw createError({
      statusCode: 500,
      statusMessage: err?.message || 'Internal server error'
    })
  }
})
