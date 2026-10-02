import { serverSupabaseClient } from '#supabase/server'
import { createError, getRouterParam } from 'h3'
import { requireFinalProjectAdmin } from '~/server/utils/finalProjectAuth'

// GET /api/admin/final-project-assessment/assignment/:assignmentId
//
// Full detail for one assignment -- both assessment types, each with
// their full criteria/grades/signatures breakdown, not just the
// summary average shown in the list view. This is what "View
// Assessment" (Section 8's notification action, and clicking a row in
// the admin list) opens.
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  await requireFinalProjectAdmin(event, supabase)

  const assignmentId = getRouterParam(event, 'assignmentId')

  const { data: assignment, error: assignmentError } = await supabase
    .from('final_project_assignments')
    .select(`
      *,
      students ( id, first_name, last_name, email, programs ( name ), cohorts ( name ) ),
      final_project_assignment_examiners ( examiner_id, examiners ( id, name, email ) )
    `)
    .eq('id', assignmentId)
    .maybeSingle()

  if (assignmentError) throw createError({ statusCode: 500, statusMessage: assignmentError.message })
  if (!assignment) throw createError({ statusCode: 404, statusMessage: 'Assignment not found' })

  const { data: submissions, error: submissionsError } = await supabase
    .from('final_project_submissions')
    .select('*')
    .eq('assignment_id', assignmentId)

  if (submissionsError) throw createError({ statusCode: 500, statusMessage: submissionsError.message })

  const submissionIds = (submissions || []).map((s) => s.id)

  const [gradesResult, signaturesResult, criteriaResult] = await Promise.all([
    submissionIds.length > 0
      ? supabase.from('final_project_grades').select('submission_id, criterion_id, grade').in('submission_id', submissionIds)
      : Promise.resolve({ data: [], error: null }),
    submissionIds.length > 0
      ? supabase.from('final_project_signatures').select('submission_id, examiner_id, signature_text, signed_at, examiners ( name )').in('submission_id', submissionIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('final_project_criteria').select('id, assessment_type, label, max_grade, display_order').order('display_order'),
  ])

  if (gradesResult.error) throw createError({ statusCode: 500, statusMessage: gradesResult.error.message })
  if (signaturesResult.error) throw createError({ statusCode: 500, statusMessage: signaturesResult.error.message })
  if (criteriaResult.error) throw createError({ statusCode: 500, statusMessage: criteriaResult.error.message })

  const criteriaById = new Map((criteriaResult.data || []).map((c) => [c.id, c]))

  function buildSubmissionDetail(assessmentType) {
    const submission = (submissions || []).find((s) => s.assessment_type === assessmentType)
    if (!submission) return null

    const grades = (gradesResult.data || [])
      .filter((g) => g.submission_id === submission.id)
      .map((g) => ({
        criterionId: g.criterion_id,
        label: criteriaById.get(g.criterion_id)?.label || 'Unknown criterion',
        maxGrade: criteriaById.get(g.criterion_id)?.max_grade || null,
        grade: g.grade,
      }))

    const signatures = (signaturesResult.data || [])
      .filter((s) => s.submission_id === submission.id)
      .map((s) => ({
        examinerId: s.examiner_id,
        examinerName: s.examiners?.name,
        signatureText: s.signature_text,
        signedAt: s.signed_at,
      }))

    return {
      id: submission.id,
      status: submission.status,
      averageGrade: submission.average_grade,
      submittedAt: submission.submitted_at,
      submittedBy: submission.submitted_by,
      reopenedAt: submission.reopened_at,
      reopenedBy: submission.reopened_by,
      reopenReason: submission.reopen_reason,
      grades,
      signatures,
    }
  }

  return {
    data: {
      assignment: {
        id: assignment.id,
        student: assignment.students
          ? {
              id: assignment.students.id,
              name: `${assignment.students.first_name || ''} ${assignment.students.last_name || ''}`.trim(),
              email: assignment.students.email,
              program: assignment.students.programs?.name || null,
              cohort: assignment.students.cohorts?.name || null,
            }
          : null,
        examiners: (assignment.final_project_assignment_examiners || []).map((e) => ({
          id: e.examiners?.id,
          name: e.examiners?.name,
          email: e.examiners?.email,
        })),
        season04: {
          confirmed: assignment.season04_confirmed,
          override: assignment.season04_override,
        },
        assessmentActivated: assignment.assessment_activated,
        archived: assignment.archived,
        createdBy: assignment.created_by,
        createdAt: assignment.created_at,
      },
      submission: buildSubmissionDetail('submission'),
      presentation: buildSubmissionDetail('presentation'),
    },
  }
})
