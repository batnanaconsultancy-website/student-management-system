import { serverSupabaseClient, serverSupabaseServiceRole } from '#supabase/server'
import { createError, readBody } from 'h3'
import { requireExaminerForSubmission } from '~/server/utils/finalProjectAuth'

// POST /api/examiner/assessment/:submissionId/save
//
// Submission:
//   Saves only the logged-in examiner's grades, feedback,
//   recommendations and signature as a DRAFT.
//
// Presentation:
//   Preserves the existing save behaviour for now.

function round2(value) {
  return Math.round(Number(value) * 100) / 100
}

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const submissionId = getRouterParam(event, 'submissionId')

  const { examiner, submission, assignment } =
    await requireExaminerForSubmission(event, supabase, submissionId)

  const body = await readBody(event)

  const grades = body?.grades && typeof body.grades === 'object'
    ? body.grades
    : {}

  const signatureText = body?.signatureText
    ? String(body.signatureText).trim()
    : null

  /*
   * ------------------------------------------------------------
   * PRESENTATION
   * ------------------------------------------------------------
   * Keep the old behaviour unchanged.
   */
  if (submission.assessment_type === 'presentation') {
    const isReadOnly =
      submission.status === 'SUBMITTED' &&
      !(
        submission.reopened_at &&
        submission.submitted_at &&
        new Date(submission.reopened_at) > new Date(submission.submitted_at)
      )

    if (isReadOnly) {
      throw createError({
        statusCode: 403,
        statusMessage:
          'This assessment has already been submitted and is read-only.',
      })
    }

    const { data: criteria, error: criteriaError } = await supabase
      .from('final_project_criteria')
      .select('id, max_grade')
      .eq('assessment_type', 'presentation')
      .eq('is_active', true)

    if (criteriaError) {
      throw createError({
        statusCode: 500,
        statusMessage: criteriaError.message,
      })
    }

    const validCriteria = new Map(
      (criteria || []).map((criterion) => [
        criterion.id,
        Number(criterion.max_grade ?? 100),
      ]),
    )

    for (const [criterionId, grade] of Object.entries(grades)) {
      if (!validCriteria.has(criterionId)) {
        throw createError({
          statusCode: 400,
          statusMessage: `Invalid criterion: ${criterionId}`,
        })
      }

      if (grade === null || grade === '') continue

      const numericGrade = Number(grade)

      if (
        !Number.isFinite(numericGrade) ||
        numericGrade < 0 ||
        numericGrade > validCriteria.get(criterionId)
      ) {
        throw createError({
          statusCode: 400,
          statusMessage: `Invalid grade for criterion ${criterionId}.`,
        })
      }

      const { error } = await supabase
        .from('final_project_grades')
        .upsert(
          {
            submission_id: submissionId,
            criterion_id: criterionId,
            examiner_id: examiner.id,
            grade: numericGrade,
          },
          {
            onConflict: 'submission_id,criterion_id,examiner_id',
          },
        )

      if (error) {
        throw createError({
          statusCode: 500,
          statusMessage: error.message,
        })
      }
    }

    if (signatureText) {
      const { error } = await supabase
        .from('final_project_signatures')
        .upsert(
          {
            submission_id: submissionId,
            examiner_id: examiner.id,
            signature_text: signatureText,
            signed_at: new Date().toISOString(),
          },
          {
            onConflict: 'submission_id,examiner_id',
          },
        )

      if (error) {
        throw createError({
          statusCode: 500,
          statusMessage: error.message,
        })
      }
    }

    if (
      submission.status === 'ASSIGNED' ||
      submission.status === 'ACTIVATED'
    ) {
      const { error } = await supabase
        .from('final_project_submissions')
        .update({
          status: 'IN_PROGRESS',
        })
        .eq('id', submissionId)

      if (error) {
        throw createError({
          statusCode: 500,
          statusMessage: error.message,
        })
      }
    }

    return {
      data: {
        saved: true,
        status: 'DRAFT',
      },
    }
  }

  /*
   * ------------------------------------------------------------
   * SUBMISSION — NEW MULTI-EXAMINER MODEL
   * ------------------------------------------------------------
   */

  /*
   * Load the current examiner's assessment.
   *
   * We use the normal authenticated client here so RLS ensures
   * the examiner can only access their own assessment.
   */
  const { data: existingAssessment, error: assessmentError } =
    await supabase
      .from('final_project_examiner_assessments')
      .select(`
        id,
        status,
        average_grade,
        letter_grade,
        decision,
        feedback,
        recommendations,
        submitted_at
      `)
      .eq('submission_id', submissionId)
      .eq('examiner_id', examiner.id)
      .maybeSingle()

  if (assessmentError) {
    throw createError({
      statusCode: 500,
      statusMessage: assessmentError.message,
    })
  }

  /*
   * Check whether the current examiner has an approved re-grading
   * request for this submitted assessment.
   */
  const { data: regradingRequest, error: regradingRequestError } =
    await supabase
      .from('final_project_regrading_requests')
      .select('id, request_number, status')
      .eq('submission_id', submissionId)
      .eq('examiner_id', examiner.id)
      .order('request_number', { ascending: false })
      .limit(1)
      .maybeSingle()

  if (regradingRequestError) {
    throw createError({
      statusCode: 500,
      statusMessage: regradingRequestError.message,
    })
  }

  const regradingApproved = regradingRequest?.status === 'APPROVED'
  const isReopened = Boolean(
    submission.status === 'SUBMITTED' &&
    submission.reopened_at &&
    submission.submitted_at &&
    new Date(submission.reopened_at) > new Date(submission.submitted_at)
  )

  /*
   * An approved re-grading request must have its original history
   * snapshot before any grade writes are allowed.
   */
  if (regradingApproved) {
    const adminClient = await serverSupabaseServiceRole(event)

    const { data: history, error: historyError } = await adminClient
      .from('final_project_regrading_history')
      .select('id, regrading_request_id, submission_id, examiner_id')
      .eq('regrading_request_id', regradingRequest.id)
      .maybeSingle()

    if (historyError) {
      throw createError({
        statusCode: 500,
        statusMessage: historyError.message,
      })
    }

    if (
      !history ||
      history.regrading_request_id !== regradingRequest.id ||
      history.submission_id !== submissionId ||
      history.examiner_id !== examiner.id
    ) {
      throw createError({
        statusCode: 409,
        statusMessage:
          'The approved re-grading request has no matching history record. No grades were saved.',
      })
    }
  }

  /*
   * A submitted assessment can only be edited when an administrator
   * has approved its re-grading request.
   */
  if (
    existingAssessment?.status === 'SUBMITTED' &&
    !regradingApproved &&
    !isReopened
  ) {
    throw createError({
      statusCode: 403,
      statusMessage:
        'Your assessment has already been submitted. Request admin permission to re-grade it before making changes.',
    })
  }

  /*
   * Load the active Submission criteria.
   */
  const { data: criteria, error: criteriaError } = await supabase
    .from('final_project_criteria')
    .select('id, label, max_grade')
    .eq('assessment_type', 'submission')
    .eq('is_active', true)
    .order('display_order', { ascending: true })

  if (criteriaError) {
    throw createError({
      statusCode: 500,
      statusMessage: criteriaError.message,
    })
  }

  const validCriteria = new Map(
    (criteria || []).map((criterion) => [
      criterion.id,
      Number(criterion.max_grade ?? 100),
    ]),
  )

  /*
   * Validate every grade sent by the browser.
   *
   * The browser cannot choose an examiner_id. The authenticated
   * examiner.id is always used below.
   */
  for (const [criterionId, grade] of Object.entries(grades)) {
    if (!validCriteria.has(criterionId)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Invalid criterion: ${criterionId}`,
      })
    }

    if (grade === null || grade === '') continue

    const numericGrade = Number(grade)

    if (
      !Number.isFinite(numericGrade) ||
      numericGrade < 0 ||
      numericGrade > validCriteria.get(criterionId)
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: `Invalid grade for criterion ${criterionId}.`,
      })
    }
  }

  /*
   * Save feedback and recommendations.
   */
  const feedback =
    body?.feedback !== undefined && body?.feedback !== null
      ? String(body.feedback)
      : ''

  const recommendations =
    body?.recommendations !== undefined &&
    body?.recommendations !== null
      ? String(body.recommendations)
      : ''

  /*
   * Save an approved re-grading draft atomically. The RPC owns all
   * writes for this path so a failed save cannot leave partial changes.
   * Ordinary draft saves continue through the existing code below.
   */
  if (regradingApproved) {
    const adminClient = await serverSupabaseServiceRole(event)

    const { data: rpcData, error: rpcError } = await adminClient.rpc(
      'save_final_project_regrading_draft',
      {
        p_request_id: regradingRequest.id,
        p_submission_id: submissionId,
        p_examiner_id: examiner.id,
        p_grades: grades,
        p_feedback: feedback,
        p_recommendations: recommendations,
        p_signature_text: signatureText || null,
      },
    )

    if (rpcError) {
      const message = String(rpcError.message || '')
      const match = message.match(
        /FP_REGRADING_(INVALID|NOT_FOUND|FORBIDDEN|CONFLICT):\s*(.*)/s,
      )

      if (match) {
        const statusCode = {
          INVALID: 400,
          NOT_FOUND: 404,
          FORBIDDEN: 403,
          CONFLICT: 409,
        }[match[1]]

        throw createError({
          statusCode,
          statusMessage: match[2] || 'The re-grading draft could not be saved.',
        })
      }

      console.error(
        '[final-project-regrading-draft-save] RPC failed',
        rpcError,
      )

      throw createError({
        statusCode: 500,
        statusMessage: 'Unable to save the re-grading draft.',
      })
    }

    if (rpcData?.saved !== true || rpcData?.status !== 'DRAFT') {
      console.error(
        '[final-project-regrading-draft-save] Unexpected RPC response',
        rpcData,
      )

      throw createError({
        statusCode: 500,
        statusMessage: 'The re-grading draft save returned an unexpected result.',
      })
    }

    return {
      data: rpcData,
    }
  }

  /*
   * An administrator-reopened Submission is corrected atomically without
   * demoting the examiner assessment or clearing the shared result.
   * Approved re-grading retains precedence through its dedicated RPC above.
   */
  if (isReopened && existingAssessment?.status === 'SUBMITTED') {
    const adminClient = await serverSupabaseServiceRole(event)
    const { data: rpcData, error: rpcError } = await adminClient.rpc(
      'save_final_project_reopened_submission_draft',
      {
        p_submission_id: submissionId,
        p_examiner_id: examiner.id,
        p_grades: grades,
        p_feedback: feedback,
        p_recommendations: recommendations,
        p_signature_text: signatureText || null,
      },
    )

    if (rpcError) {
      const message = String(rpcError.message || '')
      const match = message.match(
        /FP_REOPENED_SUBMISSION_SAVE_(INVALID|NOT_FOUND|FORBIDDEN|CONFLICT):\s*(.*)/s,
      )

      if (match) {
        const statusCode = {
          INVALID: 400,
          NOT_FOUND: 404,
          FORBIDDEN: 403,
          CONFLICT: 409,
        }[match[1]]

        throw createError({
          statusCode,
          statusMessage: match[2] || 'The correction could not be saved.',
        })
      }

      console.error('[final-project-reopened-save] RPC failed', rpcError)
      throw createError({
        statusCode: 500,
        statusMessage: 'Unable to save the submission correction.',
      })
    }

    if (rpcData?.saved !== true || rpcData?.status !== 'SUBMITTED') {
      console.error('[final-project-reopened-save] Unexpected RPC response', rpcData)
      throw createError({
        statusCode: 500,
        statusMessage: 'The correction save returned an unexpected result.',
      })
    }

    return { data: rpcData }
  }

  /*
   * Save an ordinary Submission draft atomically.
   * Approved re-grading returned through its separate RPC above.
   */
  if (!regradingApproved) {
    const adminClient = await serverSupabaseServiceRole(event)

    const { data: rpcData, error: rpcError } = await adminClient.rpc(
      'save_final_project_submission_draft',
      {
        p_submission_id: submissionId,
        p_examiner_id: examiner.id,
        p_grades: grades,
        p_feedback: feedback,
        p_recommendations: recommendations,
        p_signature_text: signatureText || null,
      },
    )

    if (rpcError) {
      const message = String(rpcError.message || '')
      const match = message.match(
        /FP_SUBMISSION_DRAFT_(INVALID|NOT_FOUND|FORBIDDEN|CONFLICT):\s*(.*)/s,
      )

      if (match) {
        const statusCode = {
          INVALID: 400,
          NOT_FOUND: 404,
          FORBIDDEN: 403,
          CONFLICT: 409,
        }[match[1]]

        throw createError({
          statusCode,
          statusMessage: match[2] || 'The draft could not be saved.',
        })
      }

      console.error('[final-project-draft-save] RPC failed', rpcError)

      throw createError({
        statusCode: 500,
        statusMessage: 'Unable to save the assessment draft.',
      })
    }

    if (rpcData?.saved !== true || rpcData?.status !== 'DRAFT') {
      console.error('[final-project-draft-save] Unexpected RPC response', rpcData)

      throw createError({
        statusCode: 500,
        statusMessage: 'The draft save returned an unexpected result.',
      })
    }

    return { data: rpcData }
  }

  /*
   * Save the logged-in examiner's grades.
   */
  for (const [criterionId, grade] of Object.entries(grades)) {
    if (grade === null || grade === '') continue

    const numericGrade = Number(grade)

    const { error } = await supabase
      .from('final_project_grades')
      .upsert(
        {
          submission_id: submissionId,
          criterion_id: criterionId,
          examiner_id: examiner.id,
          grade: numericGrade,
        },
        {
          onConflict: 'submission_id,criterion_id,examiner_id',
        },
      )

    if (error) {
      throw createError({
        statusCode: 500,
        statusMessage: error.message,
      })
    }
  }

  /*
   * Create or update the current examiner's assessment row.
   */
  const assessmentPayload = {
    submission_id: submissionId,
    examiner_id: examiner.id,
    status: 'DRAFT',
    feedback,
    recommendations,
    average_grade: null,
    letter_grade: null,
    decision: null,
    submitted_at: null,
    updated_at: new Date().toISOString(),
  }

  const { error: upsertAssessmentError } = await supabase
    .from('final_project_examiner_assessments')
    .upsert(assessmentPayload, {
      onConflict: 'submission_id,examiner_id',
    })

  if (upsertAssessmentError) {
    throw createError({
      statusCode: 500,
      statusMessage: upsertAssessmentError.message,
    })
  }

  /*
   * Save signature only when one was supplied.
   */
  if (signatureText) {
    const { error } = await supabase
      .from('final_project_signatures')
      .upsert(
        {
          submission_id: submissionId,
          examiner_id: examiner.id,
          signature_text: signatureText,
          signed_at: new Date().toISOString(),
        },
        {
          onConflict: 'submission_id,examiner_id',
        },
      )

    if (error) {
      throw createError({
        statusCode: 500,
        statusMessage: error.message,
      })
    }
  }

  /*
   * Saving a draft means the shared submission is now in progress.
   *
   * Do not mark it SUBMITTED here. That happens only when every
   * assigned examiner has submitted.
   */
  if (
    submission.status === 'ASSIGNED' ||
    submission.status === 'ACTIVATED'
  ) {
    const { error } = await supabase
      .from('final_project_submissions')
      .update({
        status: 'IN_PROGRESS',
        average_grade: null,
        submitted_by: null,
        submitted_at: null,
      })
      .eq('id', submissionId)

    if (error) {
      throw createError({
        statusCode: 500,
        statusMessage: error.message,
      })
    }
  }

  return {
    data: {
      saved: true,
      status: 'DRAFT',
    },
  }
})
