import { createError } from 'h3'
import { serverSupabaseClient } from '#supabase/server'
import { resolveStudentViewContext } from '~/server/utils/studentView'
import { isSeasonCompleted } from '~/server/utils/seasonCompletion'

export default defineEventHandler(async (event) => {
  try {
    const authenticatedClient = await serverSupabaseClient(event)
    const context = await resolveStudentViewContext(event, authenticatedClient)
    const client = context.dataClient
    const studentId = context.student.id

    // Resolve the student exclusively from the authenticated account or
    // the server-validated Student View session.
    const [
      studentResult,
      progressResult,
      projectsResult,
      completionsResult,
      seasonsResult,
    ] = await Promise.all([
      client
        .from('students')
        .select(`
          id,
          first_name,
          last_name,
          email,
          program_id,
          cohort_id,
          points_assigned,
          points,
          exercises_completed,
          workshops_attended,
          mentoring_attended,
          standup_attended,
          programs:program_id ( id, name ),
          cohorts:cohort_id ( id, name )
        `)
        .eq('id', studentId)
        .maybeSingle(),

      client
        .from('student_season_progress')
        .select('season_id, progress_percentage, is_completed')
        .eq('student_id', studentId),

      client
        .from('projects')
        .select('id, name, description, season_id')
        .eq('program_id', context.student.program_id),

      client
        .from('student_project_completion')
        .select('project_id, is_completed')
        .eq('student_id', studentId),

      client
        .from('program_cohort_seasons')
        .select(`
          season_id,
          start_date,
          end_date,
          seasons!inner (
            id,
            name
          )
        `)
        .eq('cohort_id', context.student.cohort_id)
        .eq('program_id', context.student.program_id)
        .order('start_date', { ascending: true }),
    ])

    const results = [
      studentResult,
      progressResult,
      projectsResult,
      completionsResult,
      seasonsResult,
    ]

    const failed = results.find(result => result.error)
    if (failed?.error) {
      console.error('Student assessment data query failed:', failed.error)
      throw createError({
        statusCode: 500,
        statusMessage: 'Unable to load assessment evidence',
      })
    }

    const student = studentResult.data
    if (!student) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Student record not found',
      })
    }

    const attendance = {
      workshops: Number(student.workshops_attended || 0),
      mentoring: Number(student.mentoring_attended || 0),
      standups: Number(student.standup_attended || 0),
    }

    attendance.points =
      attendance.workshops * 3 +
      attendance.mentoring * 3 +
      attendance.standups

    const completedIds = new Set(
      (completionsResult.data || [])
        .filter(row => row.is_completed)
        .map(row => row.project_id)
    )

    const seasonNames = new Map(
      (seasonsResult.data || []).map(row => [
        row.season_id,
        row.seasons?.name || 'Unknown Season',
      ])
    )

    const seasonSchedules = new Map(
      (seasonsResult.data || []).map(row => [
        row.season_id,
        {
          start_date: row.start_date || null,
          end_date: row.end_date || null,
        },
      ])
    )

    const projects = (projectsResult.data || []).map(project => ({
      id: project.id,
      name: project.name,
      description: project.description || null,
      season_id: project.season_id,
      season_name: seasonNames.get(project.season_id) || 'Unassigned Season',
      is_completed: completedIds.has(project.id),
    }))

    const seasonProgress = (progressResult.data || []).map(row => ({
      season_id: row.season_id,
      season_name: seasonNames.get(row.season_id) || 'Unknown Season',
      progress_percentage: Number(row.progress_percentage || 0),
      is_completed: isSeasonCompleted(
        row.progress_percentage,
        row.is_completed,
      ),
      ...(seasonSchedules.get(row.season_id) || {
        start_date: null,
        end_date: null,
      }),
    }))

    return {
      data: {
        student: {
          id: student.id,
          name: `${student.first_name || ''} ${student.last_name || ''}`.trim(),
          email: student.email,
          program_name: student.programs?.name || null,
          cohort_name: student.cohorts?.name || null,
        },
        low_stakes: {
          ...attendance,
          recorded_points: Number(student.points_assigned ?? attendance.points),
          target: null,
          target_note: 'Assessment thresholds are programme-specific and are not yet applied here.',
        },
        medium_stakes: {
          completed_projects: projects.filter(project => project.is_completed).length,
          total_projects: projects.length,
          projects,
          qwasar_credit_enabled: false,
          note: 'Qwasar project credit is not currently enabled because the approved SIS mapping registry contains no approved mappings.',
        },
        season_progress: seasonProgress,
        high_stakes: {
          final_project_assessment_available: true,
          note: 'Final Project Assessment is managed through the existing assessment process. Other VIVA evidence will be added when programme-specific rules are configured.',
        },
        is_student_view: context.isStudentView,
      },
    }
  } catch (err) {
    console.error('Student assessment handler error:', err)
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err.statusMessage || err.message || 'Internal server error',
    })
  }
})
