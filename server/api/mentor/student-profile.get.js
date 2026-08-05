import { createError, getQuery, getHeader } from 'h3'
import { serverSupabaseServiceRole } from '#supabase/server'
import { isSeasonCompleted } from '~/server/utils/seasonCompletion'

// GET /api/mentor/student-profile?email=student@example.com
//
// Server-to-server endpoint for the AI Mentor (Anam) backend. It has no
// student browser session to authenticate with (it's a separate app
// calling us directly), so this is gated by a shared secret instead of
// serverSupabaseUser -- the same student data a student can already see
// on their own dashboard, just handed to their mentor in real time so it
// can answer questions about their own progress.
//
// Auth: header `x-mentor-secret` must match runtimeConfig.mentorApiSecret.
// Returns { found: false } (200) if the email isn't a student in the
// system, rather than a 404, so the caller can handle "unknown student"
// as a normal case rather than an error.
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)

  if (!config.mentorApiSecret) {
    // Fail closed: if the secret isn't configured, never serve student data.
    throw createError({ statusCode: 503, statusMessage: 'Mentor integration not configured' })
  }

  const providedSecret = getHeader(event, 'x-mentor-secret')
  if (!providedSecret || providedSecret !== config.mentorApiSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid or missing mentor secret' })
  }

  const { email } = getQuery(event)
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    throw createError({ statusCode: 400, statusMessage: 'A valid email query param is required' })
  }
  const cleanEmail = email.trim().toLowerCase()

  try {
    const client = serverSupabaseServiceRole(event)

    const { data: studentData, error: studentError } = await client
      .from('students')
      .select(`
        *,
        programs:program_id ( id, name ),
        cohorts:cohort_id ( id, name )
      `)
      .eq('email', cleanEmail)
      .maybeSingle()

    if (studentError) {
      console.error('mentor/student-profile: error fetching student', studentError)
      throw createError({ statusCode: 500, statusMessage: studentError.message })
    }

    if (!studentData) {
      return { found: false }
    }

    // ── Completed projects + overall progress (same as the student dashboard) ──
    const { count: completedProjects } = await client
      .from('student_project_completion')
      .select('*', { count: 'exact', head: true })
      .eq('student_id', studentData.id)
      .eq('is_completed', true)

    const { data: progressRows } = await client
      .from('student_season_progress')
      .select('season_id, progress_percentage, is_completed, seasons(id, name)')
      .eq('student_id', studentData.id)

    let overallProgress = 0
    if (progressRows && progressRows.length > 0) {
      const total = progressRows.reduce((sum, row) => sum + parseFloat(row.progress_percentage || 0), 0)
      overallProgress = Math.round(total / progressRows.length)
    }

    const { data: allProgramSeasons } = await client
      .from('seasons')
      .select('id, name, program_id')
      .eq('program_id', studentData.program_id)

    const seasonNameById = new Map((allProgramSeasons || []).map(s => [s.id, s.name]))
    const currentSeasonName = seasonNameById.get(studentData.current_season_id) || null
    const expectedSeasonName = seasonNameById.get(studentData.expected_season_id) || null

    const seasonBreakdown = (progressRows || [])
      .map(row => ({
        season: row.seasons?.name || seasonNameById.get(row.season_id) || 'Unknown Season',
        progress_percent: Math.round(parseFloat(row.progress_percentage || 0)),
        is_completed: isSeasonCompleted(row.progress_percentage, row.is_completed),
      }))
      .filter(s => s.season !== 'Final Project' && s.season !== 'Onboarding')

    const completedSeasonsCount = seasonBreakdown.filter(s => s.is_completed).length

    // ── Projects still open in the student's CURRENT season only ──
    // (kept scoped to one season so this stays a short, useful list rather
    // than a full curriculum dump)
    let currentSeasonOpenProjects = []
    if (studentData.current_season_id) {
      const { data: seasonProjects } = await client
        .from('projects')
        .select('id, name')
        .eq('program_id', studentData.program_id)
        .eq('season_id', studentData.current_season_id)

      if (seasonProjects && seasonProjects.length > 0) {
        const { data: completions } = await client
          .from('student_project_completion')
          .select('project_id, is_completed')
          .eq('student_id', studentData.id)
          .eq('is_completed', true)

        const completedIds = new Set((completions || []).map(c => c.project_id))
        currentSeasonOpenProjects = seasonProjects
          .filter(p => !completedIds.has(p.id))
          .map(p => p.name)
      }
    }

    // ── Attendance, relative to the top attendee across all students ──
    // Mirrors the admin analytics definition: there's no "expected
    // sessions" count tracked anywhere, so this is a relative engagement
    // measure (this student's attended sessions vs. the most-attended
    // student org-wide), not literal "% of sessions held".
    const { data: allStudentsAttendance } = await client
      .from('students')
      .select('workshops_attended, standup_attended, mentoring_attended')

    let topAttendeeTotal = 0
    for (const s of allStudentsAttendance || []) {
      const total = Number(s.workshops_attended || 0) + Number(s.standup_attended || 0) + Number(s.mentoring_attended || 0)
      if (total > topAttendeeTotal) topAttendeeTotal = total
    }

    const studentAttendanceTotal =
      Number(studentData.workshops_attended || 0) +
      Number(studentData.standup_attended || 0) +
      Number(studentData.mentoring_attended || 0)

    const attendancePercentVsTopPeer =
      topAttendeeTotal > 0 ? Math.round((studentAttendanceTotal / topAttendeeTotal) * 10000) / 100 : 0

    return {
      found: true,
      student: {
        first_name: studentData.first_name,
        last_name: studentData.last_name,
        program_name: studentData.programs?.name || null,
        cohort_name: studentData.cohorts?.name || null,
        status: studentData.status || null,
        current_season: currentSeasonName,
        expected_season: expectedSeasonName,
        overall_progress_percent: overallProgress,
        completed_seasons: completedSeasonsCount,
        total_seasons: seasonBreakdown.length,
        earned_points: studentData.points_assigned ?? 0,
        qwasar_points: studentData.points ?? 0,
        exercises_completed: studentData.exercises_completed ?? 0,
        projects_completed: completedProjects || 0,
        workshops_attended: studentData.workshops_attended ?? 0,
        standups_attended: studentData.standup_attended ?? 0,
        mentoring_attended: studentData.mentoring_attended ?? 0,
        attendance_percent_vs_top_peer: attendancePercentVsTopPeer,
        last_login: studentData.last_login || null,
        season_breakdown: seasonBreakdown,
        current_season_open_projects: currentSeasonOpenProjects,
      },
    }
  } catch (err) {
    console.error('mentor/student-profile handler error:', err)
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err?.message || 'Internal server error',
    })
  }
})
