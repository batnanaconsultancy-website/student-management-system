import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'
import { isSeasonCompleted } from '~/server/utils/seasonCompletion'

export default defineEventHandler(async (event) => {
  try {
    const client = await serverSupabaseClient(event)
    const user = await serverSupabaseUser(event)

    if (!user?.email) {
      throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    // Get student's cohort and program
    const { data: studentData, error: studentError } = await client
      .from('students')
      .select('id, cohort_id, program_id')
      .eq('email', user.email)
      .single()

    if (studentError) {
      throw createError({ statusCode: 500, statusMessage: studentError.message })
    }

    if (!studentData) {
      throw createError({ statusCode: 404, statusMessage: 'Student not found' })
    }

    // Get student season progress to determine which Season 03 track they're in
    const { data: progressData, error: progressError } = await client
      .from('student_season_progress')
      .select('*, seasons(id, name)')
      .eq('student_id', studentData.id)

    if (progressError) {
      throw createError({ statusCode: 500, statusMessage: progressError.message })
    }

    // Find which Season 03 specialization the student has progress in
    const season03Progress = (progressData || []).find(p =>
      p.seasons?.name?.match(/^Season 03 Software Engineer/)
    )
    const studentSeason03Track = season03Progress?.seasons?.name

    // Get program cohort seasons
    const { data: cohortSeasons, error: seasonsError } = await client
      .from('program_cohort_seasons')
      .select(`
        *,
        seasons (
          name
        )
      `)
      .eq('cohort_id', studentData.cohort_id)
      .order('start_date', { ascending: true })

    if (seasonsError) {
      throw createError({ statusCode: 500, statusMessage: seasonsError.message })
    }

    // Fetch all projects for the student's program
    const { data: projectsData } = await client
      .from('projects')
      .select('id, name, season_id')
      .eq('program_id', studentData.program_id)

    // Fetch student's completed projects
    const { data: completedProjectsData } = await client
      .from('student_project_completion')
      .select('project_id, is_completed')
      .eq('student_id', studentData.id)
      .eq('is_completed', true)

    // Create a set of completed project IDs for quick lookup
    const completedProjectIds = new Set(
      (completedProjectsData || []).map(cp => cp.project_id)
    )

    // Filter out Season 03 tracks that don't match the student's track
    const filteredSeasons = (cohortSeasons || []).filter((season) => {
      const seasonName = season.seasons?.name
      const isSeason03SE = seasonName?.match(/^Season 03 Software Engineer/)

      // If it's a Season 03 SE track, only include it if it matches the student's track
      if (isSeason03SE) {
        return studentSeason03Track && seasonName === studentSeason03Track
      }

      // Include all other seasons
      return true
    })

    // Map seasons with progress and projects
    const seasons = filteredSeasons.map((season) => {
      const progress = (progressData || []).find(p => p.season_id === season.season_id)

      // Get projects for this season and mark completion status
      const seasonProjects = (projectsData || [])
        .filter(p => p.season_id === season.season_id)
        .map(project => ({
          ...project,
          is_completed: completedProjectIds.has(project.id)
        }))

      return {
        ...season,
        name: season.seasons?.name || 'Season',
        progress_percentage: progress?.progress_percentage || '0.00',
        is_completed: isSeasonCompleted(progress?.progress_percentage, progress?.is_completed),
        completion_date: progress?.completion_date || null,
        projects: seasonProjects
      }
    })

    return { data: seasons }
  } catch (err) {
    console.error('Student roadmap handler error:', err)
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err?.message || 'Internal server error'
    })
  }
})
