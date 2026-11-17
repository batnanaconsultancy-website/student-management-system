import { serverSupabaseClient } from '#supabase/server'
import { resolveStudentViewContext } from '~/server/utils/studentView'
import { isSeasonCompleted } from '~/server/utils/seasonCompletion'

export default defineEventHandler(async (event) => {
  try {
    const authenticatedClient = await serverSupabaseClient(event)
    const context = await resolveStudentViewContext(event, authenticatedClient)
    const client = context.dataClient
    const studentData = context.student

    // Fetch the student's existing season progress.
    const { data: progressData, error: progressError } = await client
      .from('student_season_progress')
      .select('*, seasons(id, name)')
      .eq('student_id', studentData.id)

    if (progressError) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to load student season progress',
      })
    }

    // Identify the student's Season 03 Software Engineering track, if applicable.
    const season03Progress = (progressData || []).find((progress) =>
      progress.seasons?.name?.match(/^Season 03 Software Engineer/),
    )
    const studentSeason03Track = season03Progress?.seasons?.name

    // Only return seasons scheduled for this student's cohort AND programme.
    const { data: cohortSeasons, error: seasonsError } = await client
      .from('program_cohort_seasons')
      .select(`
        *,
        seasons (
          name
        )
      `)
      .eq('cohort_id', studentData.cohort_id)
      .eq('program_id', studentData.program_id)
      .order('start_date', { ascending: true })

    if (seasonsError) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to load scheduled programme seasons',
      })
    }

    // Fetch all projects belonging to the student's programme.
    const { data: projectsData, error: projectsError } = await client
      .from('projects')
      .select('id, name, season_id')
      .eq('program_id', studentData.program_id)

    if (projectsError) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to load programme projects',
      })
    }

    // Fetch completed project records for this student.
    const { data: completedProjectsData, error: completionsError } = await client
      .from('student_project_completion')
      .select('project_id, is_completed')
      .eq('student_id', studentData.id)
      .eq('is_completed', true)

    if (completionsError) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to load student project completion records',
      })
    }

    const completedProjectIds = new Set(
      (completedProjectsData || []).map((completion) => completion.project_id),
    )

    // Preserve the existing Season 03 specialization filtering.
    const filteredSeasons = (cohortSeasons || []).filter((season) => {
      const seasonName = season.seasons?.name
      const isSeason03SE = seasonName?.match(/^Season 03 Software Engineer/)

      if (isSeason03SE) {
        return studentSeason03Track && seasonName === studentSeason03Track
      }

      return true
    })

    const seasons = filteredSeasons.map((season) => {
      const progress = (progressData || []).find(
        (item) => item.season_id === season.season_id,
      )

      const seasonProjects = (projectsData || [])
        .filter((project) => project.season_id === season.season_id)
        .map((project) => ({
          ...project,
          is_completed: completedProjectIds.has(project.id),
        }))

      const completedProjectCount = seasonProjects.filter(
        (project) => project.is_completed,
      ).length

      return {
        ...season,
        name: season.seasons?.name || 'Season',
        progress_percentage: progress?.progress_percentage ?? '0.00',
        is_completed: isSeasonCompleted(
          progress?.progress_percentage,
          progress?.is_completed,
        ),
        completion_date: progress?.completion_date || null,
        projects: seasonProjects,
        completed_project_count: completedProjectCount,
        remaining_project_count: seasonProjects.length - completedProjectCount,
      }
    })

    return { data: seasons }
  } catch (err) {
    console.error('Student roadmap handler error:', err)
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err.statusMessage || err.message || 'Internal server error',
    })
  }
})
