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
      finalProjectResult,
      attendanceResult,
      attendanceAuditResult,
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

      client
        .from('final_project_assignments')
        .select(`
          id,
          archived,
          final_project_submissions (
            assessment_type,
            status,
            average_grade,
            submitted_at,
            reopened_at
          )
        `)
        .eq('student_id', studentId)
        .eq('archived', false)
        .maybeSingle(),

      authenticatedClient.rpc('get_assessment_student_attendance', {
        p_student_id: studentId,
      }),

      authenticatedClient.rpc('get_assessment_student_attendance_audit', {
        p_student_id: studentId,
      }),
    ])

    const results = [
      studentResult,
      progressResult,
      projectsResult,
      completionsResult,
      seasonsResult,
      finalProjectResult,
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

    if (attendanceResult.error) {
      console.error('Student attendance summary query failed:', attendanceResult.error)

      const isNotFound = attendanceResult.error.code === 'P0002'
      const isForbidden = attendanceResult.error.code === '42501'

      throw createError({
        statusCode: isNotFound ? 404 : isForbidden ? 403 : 500,
        statusMessage: isNotFound
          ? 'Student record not found'
          : isForbidden
            ? 'You are not authorised to view this attendance summary'
            : 'Unable to load attendance summary',
      })
    }

    if (attendanceAuditResult.error) {
      console.error('Student attendance audit query failed:', attendanceAuditResult.error)

      const isNotFound = attendanceAuditResult.error.code === 'P0002'
      const isForbidden = attendanceAuditResult.error.code === '42501'

      throw createError({
        statusCode: isNotFound ? 404 : isForbidden ? 403 : 500,
        statusMessage: isNotFound
          ? 'Student record not found'
          : isForbidden
            ? 'You are not authorised to view this attendance audit'
            : 'Unable to load attendance audit',
      })
    }

    const attendanceSummary = attendanceResult.data?.[0]
    const attendanceAuditSummary = attendanceAuditResult.data?.[0]

    if (!attendanceAuditSummary) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Student attendance audit returned no data',
      })
    }

    if (!attendanceSummary) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Student attendance summary not found',
      })
    }

    const calculatePoints = (percent, maximum) =>
      Number((Number(percent || 0) / 100 * maximum).toFixed(2))

    const attendance = {
      workshops: {
        count: Number(attendanceSummary.workshops || 0),
        max: Number(attendanceSummary.workshops_max || 0),
        percent: Number(attendanceSummary.workshops_percent || 0),
        points: calculatePoints(attendanceSummary.workshops_percent, 3),
      },
      mentoring: {
        count: Number(attendanceSummary.mentoring || 0),
        max: Number(attendanceSummary.mentoring_max || 0),
        percent: Number(attendanceSummary.mentoring_percent || 0),
        points: calculatePoints(attendanceSummary.mentoring_percent, 3),
      },
      standups: {
        count: Number(attendanceSummary.standups || 0),
        max: Number(attendanceSummary.standups_max || 0),
        percent: Number(attendanceSummary.standups_percent || 0),
        points: calculatePoints(attendanceSummary.standups_percent, 1),
      },
    }

    attendance.total_points = Number((
      attendance.workshops.points +
      attendance.mentoring.points +
      attendance.standups.points
    ).toFixed(2))

    const attendanceAudit = {
      uses_ledger: Boolean(attendanceAuditSummary?.uses_ledger),
      legacy: {
        workshops: attendanceAuditSummary?.legacy_workshops == null
          ? null
          : Number(attendanceAuditSummary.legacy_workshops),
        mentoring: attendanceAuditSummary?.legacy_mentoring == null
          ? null
          : Number(attendanceAuditSummary.legacy_mentoring),
        standups: attendanceAuditSummary?.legacy_standups == null
          ? null
          : Number(attendanceAuditSummary.legacy_standups),
      },
      unverified_total: Number(attendanceAuditSummary?.unverified_total || 0),
      unverified_by_reason: Array.isArray(attendanceAuditSummary?.unverified_by_reason)
        ? attendanceAuditSummary.unverified_by_reason
        : [],
    }

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

    const progressBySeason = new Map(
      (progressResult.data || []).map(row => [row.season_id, row]),
    )

    // Include scheduled Seasons without progress, while retaining historical records.
    const seasonIds = new Set([
      ...seasonSchedules.keys(),
      ...progressBySeason.keys(),
    ])

    const seasonProgress = Array.from(seasonIds).map(seasonId => {
      const row = progressBySeason.get(seasonId)
      const progressPercentage = Number(row?.progress_percentage || 0)

      return {
        season_id: seasonId,
        season_name: seasonNames.get(seasonId) || 'Unknown Season',
        progress_percentage: progressPercentage,
        is_completed: isSeasonCompleted(
          progressPercentage,
          row?.is_completed,
        ),
        ...(seasonSchedules.get(seasonId) || {
          start_date: null,
          end_date: null,
        }),
      }
    })

    const finalProjectSubmissions =
      finalProjectResult.data?.final_project_submissions || []

    const getReleasedAssessment = (assessmentType) => {
      const record = finalProjectSubmissions.find(
        item => item.assessment_type === assessmentType,
      )

      if (!record) return null

      const isActivelyReopened = Boolean(
        record.reopened_at &&
        record.submitted_at &&
        new Date(record.reopened_at) > new Date(record.submitted_at),
      )
      const isSubmitted = record.status === 'SUBMITTED' && !isActivelyReopened

      return {
        status: isActivelyReopened ? 'REOPENED' : record.status,
        grade: isSubmitted ? record.average_grade : null,
        submitted_at: record.submitted_at || null,
      }
    }

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
          audit: attendanceAudit,
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
          final_project: {
            has_assignment: Boolean(finalProjectResult.data),
            submission: finalProjectResult.data
              ? getReleasedAssessment('submission')
              : null,
            presentation: finalProjectResult.data
              ? getReleasedAssessment('presentation')
              : null,
          },
          viva_available: false,
          note: 'Submission and Presentation results are shown only after they are submitted. VIVA evidence is not yet integrated into this dashboard.',
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
