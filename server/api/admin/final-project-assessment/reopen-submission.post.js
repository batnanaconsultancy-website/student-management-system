import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'
import { createError, readBody } from 'h3'
import { requireFinalProjectAdmin } from '~/server/utils/finalProjectAuth'

// POST /api/admin/final-project-assessment/reopen-submission
//
// Section 19's controlled correction flow:
//   Request Correction -> Admin Review -> Reopen Assessment -> Examiner Edits -> Resubmit
// This endpoint IS the "Reopen Assessment" step (the "Request
// Correction" and "Admin Review" steps are conversations that happen
// outside the system -- an examiner emailing/messaging an admin, say
// -- this is where that conversation results in an actual action).
//
// Does NOT change status away from SUBMITTED -- the examiner-facing
// endpoints already treat a submission as editable again once
// reopened_at is newer than submitted_at (see
// requireExaminerForSubmission / the form page's isReadOnly check),
// so status staying "SUBMITTED" while reopened_at advances is
// deliberate, not a bug: it's what makes "this was submitted, then
// reopened" distinguishable from "never submitted" in the data itself.
//
// Body: { submissionId, reason }
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  await requireFinalProjectAdmin(event, supabase)
  const adminUser = await serverSupabaseUser(event)

  const body = await readBody(event)
  const submissionId = body?.submissionId
  const reason = String(body?.reason || '').trim()

  if (!submissionId) {
    throw createError({ statusCode: 400, statusMessage: 'submissionId is required' })
  }
  if (!reason) {
    throw createError({ statusCode: 400, statusMessage: 'A reason is required so the examiner knows what to fix.' })
  }

  const { data: submission, error: fetchError } = await supabase
    .from('final_project_submissions')
    .select('id, status, assignment_id')
    .eq('id', submissionId)
    .maybeSingle()

  if (fetchError) throw createError({ statusCode: 500, statusMessage: fetchError.message })
  if (!submission) throw createError({ statusCode: 404, statusMessage: 'Submission not found' })
  if (submission.status !== 'SUBMITTED') {
    throw createError({ statusCode: 400, statusMessage: 'Only a submitted assessment can be reopened.' })
  }

  const nowIso = new Date().toISOString()
  const { data: updated, error: updateError } = await supabase
    .from('final_project_submissions')
    .update({ reopened_by: adminUser.email, reopened_at: nowIso, reopen_reason: reason })
    .eq('id', submissionId)
    .select()
    .single()

  if (updateError) throw createError({ statusCode: 500, statusMessage: updateError.message })

  await supabase.from('audit_log').insert({
    admin_email: adminUser.email,
    action: 'final_project_submission_reopened',
    entity_type: 'final_project_submission',
    entity_id: submissionId,
    details: { reason, assignmentId: submission.assignment_id },
  })

  return { data: { submission: updated } }
})
