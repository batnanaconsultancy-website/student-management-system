import { serverSupabaseClient } from '#supabase/server'
import { createError } from 'h3'
import { resolveStudentViewContext } from '~/server/utils/studentView'
import { deriveOverallStatus } from '~/server/utils/finalProjectAssessment'

// GET /api/students/final-project-assessment
//
// Student-facing status checklist. Resolves the student through the
// authenticated account or a server-validated, read-only Student View
// session. Never accepts a target student id from the client.
//
// Returns null-ish "not started" fields (rather than a 404) when the
// student has no assignment yet, since "no assignment" is an expected,
// normal state for most students most of the time, not an error.
export default defineEventHandler(async (event) => {
  const authenticatedClient = await serverSupabaseClient(event)
  const context = await resolveStudentViewContext(event, authenticatedClient)
  const supabase = context.dataClient
  const studentId = context.student.id

  const { data: assignment, error: assignmentError } = await supabase
    .from('final_project_assignments')
    .select(`
      id, season04_confirmed, season04_override, assessment_activated, archived,
      final_project_assignment_examiners ( examiners ( name ) ),
      final_project_submissions ( assessment_type, status, average_grade, submitted_at, reopened_at )
    `)
    .eq('student_id', studentId)
    .eq('archived', false)
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

  const getStudentVisibleAssessment = (record) => {
    if (!record) return null

    const isActivelyReopened = Boolean(
      record.reopened_at &&
      record.submitted_at &&
      new Date(record.reopened_at) > new Date(record.submitted_at),
    )
    const isSubmitted = record.status === 'SUBMITTED' && !isActivelyReopened

    return {
      status: isActivelyReopened ? 'REOPENED' : record.status,
      averageGrade: isSubmitted ? record.average_grade : null,
      submittedAt: record.submitted_at,
    }
  }

  const studentSubmission = getStudentVisibleAssessment(submission)
  const studentPresentation = getStudentVisibleAssessment(presentation)

  return {
    data: {
      hasAssignment: true,
      season04Confirmed: assignment.season04_confirmed,
      assessmentActivated: assignment.assessment_activated,
      submission: studentSubmission,
      presentation: studentPresentation,
      overallStatus: deriveOverallStatus(
        studentSubmission?.status,
        studentPresentation?.status,
      ),
      examiners: (assignment.final_project_assignment_examiners || []).map((e) => e.examiners?.name).filter(Boolean),
    },
  }
})
