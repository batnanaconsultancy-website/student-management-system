import { serverSupabaseClient } from '#supabase/server'
import { requireExaminer } from '~/server/utils/finalProjectAuth'

// GET /api/examiner/assignments
//
// Powers "MY FINAL PROJECT ASSESSMENTS" (spec Section 21): every
// student this examiner is linked to, with both assessment types'
// independent status. Archived assignments are excluded -- once an
// admin archives an assignment, it drops out of the examiner's active
// list the same way it does the admin's.
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const { examiner } = await requireExaminer(event, supabase)

  const { data: links, error: linksError } = await supabase
    .from('final_project_assignment_examiners')
    .select('assignment_id')
    .eq('examiner_id', examiner.id)

  if (linksError) {
    throw createError({ statusCode: 500, statusMessage: linksError.message })
  }
  const assignmentIds = [...new Set((links || []).map((l) => l.assignment_id))]
  if (assignmentIds.length === 0) {
    return { data: { assignments: [] } }
  }

  const { data, error } = await supabase
    .from('final_project_assignments')
    .select(`
      id, student_id, assessment_activated, archived,
      final_project_submissions ( id, assessment_type, status, average_grade, submitted_at )
    `)
    .in('id', assignmentIds)
    .eq('archived', false)
    .order('created_at', { ascending: false })

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  const studentIds = [...new Set((data || []).map((row) => row.student_id).filter(Boolean))]

  if (studentIds.length === 0) {
    return { data: { assignments: [] } }
  }

  const { data: profiles, error: profilesError } = await supabase
    .rpc('get_final_project_examiner_student_profiles')

  if (profilesError) {
    throw createError({ statusCode: 500, statusMessage: profilesError.message })
  }

  const profileByStudentId = new Map(
    (profiles || []).map((profile) => [profile.id, profile]),
  )

  if ((data || []).some((row) => !profileByStudentId.has(row.student_id))) {
    throw createError({
      statusCode: 403,
      statusMessage: 'One or more assigned student profiles are not accessible.',
    })
  }

  const assignments = (data || []).map((row) => {
    const submission = row.final_project_submissions?.find((s) => s.assessment_type === 'submission') || null
    const presentation = row.final_project_submissions?.find((s) => s.assessment_type === 'presentation') || null
    const profile = profileByStudentId.get(row.student_id) || null

    return {
      assignmentId: row.id,
      assessmentActivated: row.assessment_activated,
      student: profile
        ? {
            id: profile.id,
            name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
            email: profile.email,
            program: profile.program_name || null,
            cohort: profile.cohort_name || null,
          }
        : null,
      submission: submission && {
        id: submission.id,
        status: submission.status,
        averageGrade: submission.average_grade,
        submittedAt: submission.submitted_at,
      },
      presentation: presentation && {
        id: presentation.id,
        status: presentation.status,
        averageGrade: presentation.average_grade,
        submittedAt: presentation.submitted_at,
      },
    }
  })

  return { data: { assignments } }
})
