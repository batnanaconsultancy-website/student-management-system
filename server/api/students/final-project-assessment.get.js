import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'
import { createError } from 'h3'
import { deriveOverallStatus } from '~/server/utils/finalProjectAssessment'

// GET /api/students/final-project-assessment
//
// Section 17: the student-facing status checklist. Deliberately
// resolves the student from the LOGGED-IN user's own email rather
// than accepting a student id from the client -- a student can only
// ever see their own Final Project Assessment status through this
// endpoint, there's no id to tamper with.
//
// Returns null-ish "not started" fields (rather than a 404) when the
// student has no assignment yet, since "no assignment" is an expected,
// normal state for most students most of the time, not an error.
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const { data: student, error: studentError } = await supabase
    .from('students')
    .select('id')
    .eq('email', user.email)
    .maybeSingle()

  if (studentError) throw createError({ statusCode: 500, statusMessage: studentError.message })
  if (!student) {
    throw createError({ statusCode: 404, statusMessage: 'No student record found for this account' })
  }

  const { data: assignment, error: assignmentError } = await supabase
    .from('final_project_assignments')
    .select(`
      id, season04_confirmed, season04_override, assessment_activated, archived,
      final_project_assignment_examiners ( examiners ( name ) ),
      final_project_submissions ( assessment_type, status, average_grade, submitted_at )
    `)
    .eq('student_id', student.id)
    .maybeSingle()

  if (assignmentError) throw createError({ statusCode: 500, statusMessage: assignmentError.message })

  if (!assignment || assignment.archived) {
    return {
      data: {
        hasAssignment: false,
        season04Confirmed: false,
        assessmentActivated: false,
        submission: null,
        presentation: null,
        overallStatus: 'ASSESSMENT PENDING',
        examiners: [],
      },
    }
  }

  const submission = assignment.final_project_submissions?.find((s) => s.assessment_type === 'submission') || null
  const presentation = assignment.final_project_submissions?.find((s) => s.assessment_type === 'presentation') || null

  return {
    data: {
      hasAssignment: true,
      season04Confirmed: assignment.season04_confirmed,
      assessmentActivated: assignment.assessment_activated,
      submission: submission && {
        status: submission.status,
        averageGrade: submission.average_grade,
        submittedAt: submission.submitted_at,
      },
      presentation: presentation && {
        status: presentation.status,
        averageGrade: presentation.average_grade,
        submittedAt: presentation.submitted_at,
      },
      overallStatus: deriveOverallStatus(submission?.status, presentation?.status),
      examiners: (assignment.final_project_assignment_examiners || []).map((e) => e.examiners?.name).filter(Boolean),
    },
  }
})
