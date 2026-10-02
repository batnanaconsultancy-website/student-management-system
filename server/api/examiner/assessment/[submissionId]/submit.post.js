import { serverSupabaseClient, serverSupabaseServiceRole } from '#supabase/server'
import { createError, readBody } from 'h3'
import { requireExaminerForSubmission } from '~/server/utils/finalProjectAuth'
import { notifyAllAdmins } from '~/server/utils/finalProjectAssessment'

// POST /api/examiner/assessment/:submissionId/submit
//
// Section 11/14: SUBMIT FINAL PROJECT SUBMISSION / PRESENTATION.
// Validates everything the spec requires, computes the average grade
// (never trusts a client-supplied average), locks the submission
// read-only, and fans out an Admin Inbox notification to every admin.
//
// Because Admin and Student both read directly from
// final_project_submissions / final_project_grades (no separate
// Admin-side or Student-side copy of this data), their checkmarks
// update "automatically" the instant this transaction commits --
// there's nothing else to sync.
//
// Body: { grades: { [criterionId]: number }, signatureText: string }
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const serviceSupabase = serverSupabaseServiceRole(event)
  const submissionId = getRouterParam(event, 'submissionId')
  const { user, examiner, submission, assignment } = await requireExaminerForSubmission(event, supabase, submissionId)

  const isReadOnly =
    submission.status === 'SUBMITTED' &&
    !(submission.reopened_at && new Date(submission.reopened_at) > new Date(submission.submitted_at))
  if (isReadOnly) {
    throw createError({ statusCode: 403, statusMessage: 'This assessment has already been submitted.' })
  }
  if (!assignment.assessment_activated) {
    throw createError({ statusCode: 403, statusMessage: 'This assessment has not been activated by the admin.' })
  }

  const body = await readBody(event)
  const submittedGrades = body?.grades || {}
  const signatureText = body?.signatureText ? String(body.signatureText).trim() : ''

  if (!signatureText) {
    throw createError({ statusCode: 400, statusMessage: 'A signature is required before submitting.' })
  }

  // ── Validate against the real criteria list (not whatever the
  // client happened to send) -- every active criterion for this
  // assessment type must have a grade, within range.
  const { data: criteria, error: criteriaError } = await supabase
    .from('final_project_criteria')
    .select('id, label, max_grade')
    .eq('assessment_type', submission.assessment_type)
    .eq('is_active', true)

  if (criteriaError) throw createError({ statusCode: 500, statusMessage: criteriaError.message })
  if (!criteria || criteria.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No grading criteria are configured for this assessment type.' })
  }

  const resolvedGrades = []
  for (const criterion of criteria) {
    const raw = submittedGrades[criterion.id]
    const grade = Number(raw)
    if (raw === undefined || raw === null || raw === '' || Number.isNaN(grade)) {
      throw createError({ statusCode: 400, statusMessage: `A grade is required for "${criterion.label}".` })
    }
    if (grade < 0 || grade > criterion.max_grade) {
      throw createError({ statusCode: 400, statusMessage: `"${criterion.label}" must be between 0 and ${criterion.max_grade}.` })
    }
    resolvedGrades.push({ criterionId: criterion.id, grade })
  }

  // Average Grade = sum of entered grades / number of criteria.
  // Matches the spec's formula exactly -- NOT a weighted average
  // against each criterion's own max, a plain mean of the entered
  // numbers, same as the worked example in the spec (100+76+80+23 = 69.75).
  const averageGrade =
    Math.round((resolvedGrades.reduce((sum, g) => sum + g.grade, 0) / resolvedGrades.length) * 100) / 100

  // ── Write grades
  for (const g of resolvedGrades) {
    const { error } = await supabase
      .from('final_project_grades')
      .upsert({ submission_id: submissionId, criterion_id: g.criterionId, grade: g.grade }, { onConflict: 'submission_id,criterion_id' })
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  }

  // ── Write this examiner's signature
  const nowIso = new Date().toISOString()
  const { error: sigError } = await supabase
    .from('final_project_signatures')
    .upsert(
      { submission_id: submissionId, examiner_id: examiner.id, signature_text: signatureText, signed_at: nowIso },
      { onConflict: 'submission_id,examiner_id' }
    )
  if (sigError) throw createError({ statusCode: 500, statusMessage: sigError.message })

  // ── Lock the submission
  const { data: updatedSubmission, error: updateError } = await supabase
    .from('final_project_submissions')
    .update({
      status: 'SUBMITTED',
      average_grade: averageGrade,
      submitted_by: examiner.id,
      submitted_at: nowIso,
    })
    .eq('id', submissionId)
    .select()
    .single()
  if (updateError) throw createError({ statusCode: 500, statusMessage: updateError.message })

  // ── Audit trail (Section 20)
  await supabase.from('audit_log').insert({
    admin_email: user.email, // actor, not necessarily an admin -- see column note in the Phase 1 changelog
    action: 'final_project_assessment_submitted',
    entity_type: 'final_project_submission',
    entity_id: submissionId,
    details: {
      assessmentType: submission.assessment_type,
      studentId: assignment.student_id,
      examinerId: examiner.id,
      averageGrade,
    },
  })

  // ── Admin Inbox notification (Section 8)
  const studentName = assignment.students
    ? `${assignment.students.first_name || ''} ${assignment.students.last_name || ''}`.trim()
    : 'Unknown student'
  const assessmentLabel = submission.assessment_type === 'submission' ? 'Final Project Submission' : 'Final Project Presentation'

  await notifyAllAdmins(serviceSupabase, {
    type: 'final_project_assessment_submitted',
    title: 'New Final Project Assessment Submitted',
    body: `Student: ${studentName}\nExaminer: ${examiner.name}\nAssessment: ${assessmentLabel}\nAverage Grade: ${averageGrade}`,
    entityType: 'final_project_assignment',
    entityId: assignment.id,
  })

  return { data: { submission: updatedSubmission, averageGrade } }
})
