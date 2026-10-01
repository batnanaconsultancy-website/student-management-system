// server/utils/finalProjectAssessment.js
//
// Shared "fetch assignments with everything joined in" logic, used by
// both:
//   - server/api/admin/final-project-assessment/assignments.get.js (active list)
//   - server/api/admin/final-project-assessment/history.get.js (Section 7 Preview, with a year filter, including archived)
// kept in one place so the two views can never show inconsistent data
// shapes.

// Section 15's overall status derivation, from the two independent
// per-assessment-type submission statuses.
export function deriveOverallStatus(submissionStatus, presentationStatus) {
  const submitted = submissionStatus === 'SUBMITTED'
  const presented = presentationStatus === 'SUBMITTED'
  if (submitted && presented) return 'FINAL PROJECT ASSESSMENT COMPLETED'
  if (submitted && !presented) return 'PRESENTATION PENDING'
  return 'ASSESSMENT PENDING'
}

// options: { includeArchived?: boolean, year?: number }
export async function buildAssignmentList(supabase, options = {}) {
  const { includeArchived = false, year = null } = options

  let query = supabase
    .from('final_project_assignments')
    .select(`
      id, student_id, season04_confirmed, season04_override, season04_confirmed_by, season04_confirmed_at,
      assessment_activated, activated_by, activated_at, archived, archived_by, archived_at,
      created_by, created_at, updated_at,
      students ( id, first_name, last_name, email, program_id, cohort_id, programs ( name ), cohorts ( name ) ),
      final_project_assignment_examiners ( examiner_id, examiners ( id, name, email ) ),
      final_project_submissions ( id, assessment_type, status, average_grade, submitted_at, submitted_by, reopened_at, reopen_reason )
    `)
    .order('created_at', { ascending: false })

  if (!includeArchived) {
    query = query.eq('archived', false)
  }
  if (year) {
    const start = `${year}-01-01T00:00:00.000Z`
    const end = `${Number(year) + 1}-01-01T00:00:00.000Z`
    query = query.gte('created_at', start).lt('created_at', end)
  }

  const { data, error } = await query
  if (error) throw error

  return (data || []).map((row) => {
    const submission = row.final_project_submissions?.find((s) => s.assessment_type === 'submission') || null
    const presentation = row.final_project_submissions?.find((s) => s.assessment_type === 'presentation') || null

    return {
      id: row.id,
      student: row.students
        ? {
            id: row.students.id,
            name: `${row.students.first_name || ''} ${row.students.last_name || ''}`.trim(),
            email: row.students.email,
            program: row.students.programs?.name || null,
            cohort: row.students.cohorts?.name || null,
          }
        : null,
      examiners: (row.final_project_assignment_examiners || []).map((e) => ({
        id: e.examiners?.id,
        name: e.examiners?.name,
        email: e.examiners?.email,
      })),
      season04: {
        confirmed: row.season04_confirmed,
        override: row.season04_override,
        confirmedBy: row.season04_confirmed_by,
        confirmedAt: row.season04_confirmed_at,
      },
      assessmentActivated: row.assessment_activated,
      activatedBy: row.activated_by,
      activatedAt: row.activated_at,
      archived: row.archived,
      archivedBy: row.archived_by,
      archivedAt: row.archived_at,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      submission: submission && {
        status: submission.status,
        averageGrade: submission.average_grade,
        submittedAt: submission.submitted_at,
        reopened: Boolean(submission.reopened_at),
        reopenReason: submission.reopen_reason,
      },
      presentation: presentation && {
        status: presentation.status,
        averageGrade: presentation.average_grade,
        submittedAt: presentation.submitted_at,
        reopened: Boolean(presentation.reopened_at),
        reopenReason: presentation.reopen_reason,
      },
      overallStatus: deriveOverallStatus(submission?.status, presentation?.status),
    }
  })
}
