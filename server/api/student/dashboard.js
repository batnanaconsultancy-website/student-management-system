import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'
import { isSeasonCompleted } from '~/server/utils/seasonCompletion'

export default defineEventHandler(async (event) => {
  try {
    const client = await serverSupabaseClient(event)
    const user = await serverSupabaseUser(event)

    if (!user?.email) {
      throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    // Fetch student data with program and cohort info
    const { data: studentData, error: studentError } = await client
      .from('students')
      .select(`
        *,
        programs:program_id ( id, name ),
        cohorts:cohort_id ( id, name )
      `)
      .eq('email', user.email)
      .maybeSingle()

    if (studentError) {
      console.error('Error fetching student data:', studentError)
      throw createError({ statusCode: 500, statusMessage: studentError.message })
    }

    if (!studentData) {
      throw createError({ statusCode: 404, statusMessage: 'Student not found for this email' })
    }

    // Fetch completed projects count
    const { count: completedProjects } = await client
      .from('student_project_completion')
      .select('*', { count: 'exact', head: true })
      .eq('student_id', studentData.id)
      .eq('is_completed', true)

    // Fetch overall progress (average of all season progress)
    const { data: progressData } = await client
      .from('student_season_progress')
      .select('progress_percentage')
      .eq('student_id', studentData.id)

    let overallProgress = 0
    if (progressData && progressData.length > 0) {
      const total = progressData.reduce((sum, row) => sum + parseFloat(row.progress_percentage), 0)
      overallProgress = Math.round(total / progressData.length)
    }

    // Fetch season progress with season names
    const { data: seasonProgressData } = await client
      .from('student_season_progress')
      .select(`
        season_id,
        progress_percentage,
        is_completed,
        seasons!inner(id, name)
      `)
      .eq('student_id', studentData.id)

    const seasonProgress = (seasonProgressData || []).map(item => ({
      season_id: item.season_id,
      season_name: item.seasons?.name || 'Unknown Season',
      progress_percentage: Math.round(parseFloat(item.progress_percentage)),
      is_completed: isSeasonCompleted(item.progress_percentage, item.is_completed)
    }))

    // Fetch all seasons for the student's program
    const { data: programSeasons } = await client
      .from('seasons')
      .select('id, name, program_id')
      .eq('program_id', studentData.program_id)

    // Filter seasons (exclude Final Project, Onboarding, dedupe Season 03)
    let filteredSeasons = (programSeasons || []).filter(
      s => s.name !== 'Final Project' && s.name !== 'Onboarding'
    )
    const seen = new Set()
    filteredSeasons = filteredSeasons.filter(s => {
      const match = s.name.match(/^Season 03 Software Engineer( .+)?$/)
      if (match) {
        if (seen.has('Season 03')) return false
        seen.add('Season 03')
        return true
      }
      return true
    })

    // Count completed seasons (using the same 75%-or-flagged rule as everywhere else)
    const completedSeasonsCount = seasonProgress.filter(sp => sp.is_completed).length

    return {
      data: {
        ...studentData,
        program_name: studentData.programs?.name,
        cohort_name: studentData.cohorts?.name,
        completed_projects: completedProjects || 0,
        progress: overallProgress,
        season_progress: seasonProgress,
        all_program_seasons: programSeasons || [],
        filtered_seasons: filteredSeasons,
        total_seasons: filteredSeasons.length,
        completed_seasons: completedSeasonsCount
      }
    }
  } catch (err) {
    console.error('Student dashboard handler error:', err)
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err?.message || 'Internal server error'
    })
  }
})
