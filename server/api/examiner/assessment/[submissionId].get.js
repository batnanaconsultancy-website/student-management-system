import { serverSupabaseClient } from '#supabase/server'
import { requireExaminerForSubmission } from '~/server/utils/finalProjectAuth'

// GET /api/examiner/assessment/:submissionId
//
// Everything the assessment form page needs in one call: the
// student's name (for the form header), the active criteria for this
// submission's assessment_type, any grades already entered, any
// signature(s) already on file, and the submission's current status
// (the form renders read-only if status is SUBMITTED and hasn't been
// reopened -- Section 19).
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const submissionId = getRouterParam(event, 'submissionId')

  const { examiner, submission, assignment } = await requireExaminerForSubmission(event, supabase, submissionId)

  const [criteriaResult, gradesResult, signaturesResult, allExaminersResult] = await Promise.all([
    supabase
      .from('final_project_criteria')
      .select('id, label, max_grade, display_order')
      .eq('assessment_type', submission.assessment_type)
      .eq('is_active', true)
      .order('display_order', { ascending: true }),
    supabase
      .from('final_project_grades')
      .select('criterion_id, grade')
      .eq('submission_id', submissionId),
    supabase
      .from('final_project_signatures')
      .select('examiner_id, signature_text, signed_at, examiners ( name )')
      .eq('submission_id', submissionId),
    supabase
      .from('final_project_assignment_examiners')
      .select('examiner_id, examiners ( id, name )')
      .eq('assignment_id', assignment.id),
  ])

  if (criteriaResult.error) throw createError({ statusCode: 500, statusMessage: criteriaResult.error.message })
  if (gradesResult.error) throw createError({ statusCode: 500, statusMessage: gradesResult.error.message })
  if (signaturesResult.error) throw createError({ statusCode: 500, statusMessage: signaturesResult.error.message })
  if (allExaminersResult.error) throw createError({ statusCode: 500, statusMessage: allExaminersResult.error.message })

  const gradeByCriterion = new Map((gradesResult.data || []).map((g) => [g.criterion_id, g.grade]))

  // Read-only once SUBMITTED, unless an admin has reopened it since
  // the submit (reopened_at newer than submitted_at).
  const isReadOnly =
    submission.status === 'SUBMITTED' &&
    !(submission.reopened_at && new Date(submission.reopened_at) > new Date(submission.submitted_at))

  const student = assignment.students

  return {
    data: {
      submissionId: submission.id,
      assessmentType: submission.assessment_type,
      status: submission.status,
      averageGrade: submission.average_grade,
      isReadOnly,
      reopenReason: submission.reopen_reason,
      assessmentActivated: assignment.assessment_activated,
      student: student
        ? { id: student.id, name: `${student.first_name || ''} ${student.last_name || ''}`.trim(), email: student.email }
        : null,
      examiner: { id: examiner.id, name: examiner.name }, // the logged-in examiner -- auto-populates "Examiner Name"
      // Up to 2 examiners can sign this submission (Section 10/13).
      coExaminers: (allExaminersResult.data || [])
        .filter((e) => e.examiner_id !== examiner.id)
        .map((e) => ({ id: e.examiners?.id, name: e.examiners?.name })),
      criteria: (criteriaResult.data || []).map((c) => ({
        id: c.id,
        label: c.label,
        maxGrade: c.max_grade,
        grade: gradeByCriterion.has(c.id) ? gradeByCriterion.get(c.id) : null,
      })),
      signatures: (signaturesResult.data || []).map((s) => ({
        examinerId: s.examiner_id,
        examinerName: s.examiners?.name,
        signatureText: s.signature_text,
        signedAt: s.signed_at,
      })),
    },
  }
})
