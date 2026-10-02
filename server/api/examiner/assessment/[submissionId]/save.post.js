import { serverSupabaseClient } from '#supabase/server'
import { createError, readBody } from 'h3'
import { requireExaminerForSubmission } from '~/server/utils/finalProjectAuth'

// POST /api/examiner/assessment/:submissionId/save
//
// Saves grades (and optionally this examiner's signature) as a draft,
// WITHOUT finalizing. Marks the submission IN_PROGRESS so the admin
// list reflects that work has started. Does nothing if the submission
// is already SUBMITTED and not reopened -- same read-only rule as the
// GET endpoint.
//
// Body: { grades: { [criterionId]: number }, signatureText?: string }
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const submissionId = getRouterParam(event, 'submissionId')
  const { examiner, submission } = await requireExaminerForSubmission(event, supabase, submissionId)

  const isReadOnly =
    submission.status === 'SUBMITTED' &&
    !(submission.reopened_at && new Date(submission.reopened_at) > new Date(submission.submitted_at))
  if (isReadOnly) {
    throw createError({ statusCode: 403, statusMessage: 'This assessment has already been submitted and is read-only.' })
  }

  const body = await readBody(event)
  const grades = body?.grades || {}
  const signatureText = body?.signatureText ? String(body.signatureText).trim() : null

  for (const [criterionId, grade] of Object.entries(grades)) {
    if (grade === null || grade === '') continue
    const { error } = await supabase
      .from('final_project_grades')
      .upsert({ submission_id: submissionId, criterion_id: criterionId, grade: Number(grade) }, { onConflict: 'submission_id,criterion_id' })
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  }

  if (signatureText) {
    const { error } = await supabase
      .from('final_project_signatures')
      .upsert(
        { submission_id: submissionId, examiner_id: examiner.id, signature_text: signatureText, signed_at: new Date().toISOString() },
        { onConflict: 'submission_id,examiner_id' }
      )
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  }

  if (submission.status === 'ASSIGNED' || submission.status === 'ACTIVATED') {
    const { error } = await supabase
      .from('final_project_submissions')
      .update({ status: 'IN_PROGRESS' })
      .eq('id', submissionId)
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  }

  return { data: { saved: true } }
})
