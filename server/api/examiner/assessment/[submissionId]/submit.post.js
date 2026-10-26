import { serverSupabaseClient, serverSupabaseServiceRole } from '#supabase/server'
import { createError, readBody } from 'h3'
import { requireExaminerForSubmission } from '~/server/utils/finalProjectAuth'
import { notifyAllAdmins } from '~/server/utils/finalProjectAssessment'

function round2(value) {
  return Math.round(Number(value) * 100) / 100
}

function letterGrade(value) {
  const grade = Number(value)

  if (grade >= 88) return 'E'
  if (grade >= 74) return 'G'
  if (grade >= 60) return 'S'
  if (grade >= 53) return 'F'
  return 'P'
}

function decisionForGrade(value) {
  return Number(value) >= 60 ? 'PASS' : 'FAIL'
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
    : ''

  const feedback =
    body?.feedback !== undefined && body?.feedback !== null
      ? String(body.feedback).trim()
      : ''

  const recommendations =
    body?.recommendations !== undefined &&
    body?.recommendations !== null
      ? String(body.recommendations).trim()
      : ''

  /*
   * ------------------------------------------------------------
   * PRESENTATION
   * ------------------------------------------------------------
   * Preserve the existing single-examiner behaviour for now.
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

    if (!signatureText) {
      throw createError({
        statusCode: 400,
        statusMessage:
          'Signature required. Type your full name before submitting.',
      })
    }

    const { data: criteria, error: criteriaError } = await supabase
      .from('final_project_criteria')
      .select('id, max_grade')
      .eq('assessment_type', 'presentation')
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

    const criterionIds = [...validCriteria.keys()]

    for (const criterionId of criterionIds) {
      const value = grades[criterionId]

      if (value === undefined || value === null || value === '') {
        throw createError({
          statusCode: 400,
          statusMessage:
            'Every assessment criterion must have a grade before submission.',
        })
      }

      const numericGrade = Number(value)

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

    for (const [criterionId, grade] of Object.entries(grades)) {
      if (!validCriteria.has(criterionId)) {
        throw createError({
          statusCode: 400,
          statusMessage: `Invalid criterion: ${criterionId}`,
        })
      }

      const { error } = await supabase
        .from('final_project_grades')
        .upsert(
          {
            submission_id: submissionId,
            criterion_id: criterionId,
            examiner_id: examiner.id,
            grade: Number(grade),
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

    const average = round2(
      criterionIds.reduce(
        (sum, criterionId) => sum + Number(grades[criterionId]),
        0,
      ) / criterionIds.length,
    )

    const { error: signatureError } = await supabase
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

    if (signatureError) {
      throw createError({
        statusCode: 500,
        statusMessage: signatureError.message,
      })
    }

    const { error: submissionError } = await supabase
      .from('final_project_submissions')
      .update({
        status: 'SUBMITTED',
        average_grade: average,
        submitted_by: examiner.id,
        submitted_at: new Date().toISOString(),
      })
      .eq('id', submissionId)

    if (submissionError) {
      throw createError({
        statusCode: 500,
        statusMessage: submissionError.message,
      })
    }

    return {
      data: {
        submitted: true,
        examinerAverage: average,
        letterGrade: letterGrade(average),
        decision: decisionForGrade(average),
        allExaminersSubmitted: true,
        overallAverage: average,
      },
    }
  }

  /*
   * ------------------------------------------------------------
   * SUBMISSION — NEW MULTI-EXAMINER MODEL
   * ------------------------------------------------------------
   */

  /*
   * Read the current examiner's assessment through normal RLS.
   */
  const { data: ownAssessment, error: ownAssessmentError } =
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

  if (ownAssessmentError) {
    throw createError({
      statusCode: 500,
      statusMessage: ownAssessmentError.message,
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
  const isReopenedCorrection =
    !regradingApproved &&
    isReopened &&
    ownAssessment?.status === 'SUBMITTED'

  /*
   * A submitted examiner assessment can only be resubmitted
   * through an approved re-grading request.
   */
  if (
    ownAssessment?.status === 'SUBMITTED' &&
    !regradingApproved &&
    !isReopenedCorrection
  ) {
    throw createError({
      statusCode: 403,
      statusMessage:
        'Your assessment has already been submitted. Request admin permission to re-grade it before submitting changes.',
    })
  }

  if (submission.status === 'ARCHIVED') {
    throw createError({
      statusCode: 403,
      statusMessage: 'This assessment has been archived.',
    })
  }

  const normalSubmissionStatusAllowed = [
    'ASSIGNED',
    'ACTIVATED',
    'IN_PROGRESS',
  ].includes(submission.status)

  const regradingSubmissionStatusAllowed =
    regradingApproved && submission.status === 'SUBMITTED'
  const reopenedSubmissionStatusAllowed =
    isReopenedCorrection && submission.status === 'SUBMITTED'

  if (
    !normalSubmissionStatusAllowed &&
    !regradingSubmissionStatusAllowed &&
    !reopenedSubmissionStatusAllowed
  ) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'This assessment is not currently available for submission.',
    })
  }

  /*
   * Load the active Submission criteria.
   */
  const { data: criteria, error: criteriaError } = await supabase
    .from('final_project_criteria')
    .select('id, label, max_grade, display_order')
    .eq('assessment_type', 'submission')
    .eq('is_active', true)
    .order('display_order', { ascending: true })

  if (criteriaError) {
    throw createError({
      statusCode: 500,
      statusMessage: criteriaError.message,
    })
  }

  if (!criteria?.length) {
    throw createError({
      statusCode: 500,
      statusMessage: 'No active Submission assessment criteria were found.',
    })
  }

  const validCriteria = new Map(
    criteria.map((criterion) => [
      criterion.id,
      Number(criterion.max_grade ?? 100),
    ]),
  )

  /*
   * Every active criterion is required.
   */
  for (const criterion of criteria) {
    const value = grades[criterion.id]

    if (value === undefined || value === null || value === '') {
      throw createError({
        statusCode: 400,
        statusMessage:
          `Every assessment criterion must have a grade before submission. Missing: ${criterion.label}.`,
      })
    }

    const numericGrade = Number(value)

    if (
      !Number.isFinite(numericGrade) ||
      numericGrade < 0 ||
      numericGrade > validCriteria.get(criterion.id)
    ) {
      throw createError({
        statusCode: 400,
        statusMessage:
          `Invalid grade for criterion: ${criterion.label}.`,
      })
    }
  }

  /*
   * Reject unknown criterion IDs.
   */
  for (const criterionId of Object.keys(grades)) {
    if (!validCriteria.has(criterionId)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Invalid criterion: ${criterionId}`,
      })
    }
  }

  if (!signatureText) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'Signature required. Type your full name before submitting.',
    })
  }

  /*
   * Finalize an approved re-grading in one database transaction.
   * Return immediately so the ordinary submission path cannot
   * overwrite the original submission timestamps or repeat writes.
   */
  if (regradingApproved && regradingRequest) {
    const adminClient = await serverSupabaseServiceRole(event)

    const { data: rpcData, error: rpcError } = await adminClient.rpc(
      'submit_final_project_regrading',
      {
        p_request_id: regradingRequest.id,
        p_submission_id: submissionId,
        p_examiner_id: examiner.id,
        p_grades: grades,
        p_signature_text: signatureText,
        p_feedback: feedback,
        p_recommendations: recommendations,
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
          statusMessage:
            match[2] || 'The re-grading assessment could not be submitted.',
        })
      }

      console.error(
        '[final-project-regrading-submit] RPC failed',
        rpcError,
      )

      throw createError({
        statusCode: 500,
        statusMessage: 'Unable to submit the re-grading assessment.',
      })
    }

    const hasValidResponse =
      rpcData?.submitted === true &&
      rpcData?.allExaminersSubmitted === true &&
      rpcData?.examinerAverage !== null &&
      rpcData?.examinerAverage !== undefined &&
      typeof rpcData?.letterGrade === 'string' &&
      typeof rpcData?.decision === 'string' &&
      rpcData?.submittedExaminerCount !== null &&
      rpcData?.submittedExaminerCount !== undefined &&
      Number.isFinite(Number(rpcData.submittedExaminerCount)) &&
      rpcData?.totalExaminerCount !== null &&
      rpcData?.totalExaminerCount !== undefined &&
      Number.isFinite(Number(rpcData.totalExaminerCount)) &&
      rpcData?.overallAverage !== null &&
      rpcData?.overallAverage !== undefined &&
      typeof rpcData?.overallLetterGrade === 'string' &&
      typeof rpcData?.overallDecision === 'string'

    if (!hasValidResponse) {
      console.error(
        '[final-project-regrading-submit] Unexpected RPC response',
        rpcData,
      )

      throw createError({
        statusCode: 500,
        statusMessage:
          'The re-grading submission returned an unexpected result.',
      })
    }

    /*
     * The database transaction has committed at this point.
     * Keep the existing administrator notification behavior.
     */
    await notifyAllAdmins(adminClient, {
      type: 'final_project_assessment_submitted',
      title: 'Final Project Submission assessment completed',
      body:
        `${assignment.student?.name || 'Student'} has received all ` +
        `${rpcData.totalExaminerCount} examiner assessments. ` +
        `Overall average: ${rpcData.overallAverage}. ` +
        `Grade: ${rpcData.overallLetterGrade}. ` +
        `Decision: ${rpcData.overallDecision}.`,
      entityType: 'final_project_submission',
      entityId: submissionId,
    })

    return {
      data: rpcData,
    }
  }

  /*
   * Finalize an administrator-reopened correction through its own atomic
   * RPC. Never route this path through the ordinary submit function, which
   * can clear the shared submitted result when examiners are incomplete.
   */
  if (isReopenedCorrection) {
    const adminClient = await serverSupabaseServiceRole(event)
    const { data: rpcData, error: rpcError } = await adminClient.rpc(
      'submit_final_project_reopened_submission',
      {
        p_submission_id: submissionId,
        p_examiner_id: examiner.id,
        p_grades: grades,
        p_signature_text: signatureText,
        p_feedback: feedback,
        p_recommendations: recommendations,
      },
    )

    if (rpcError) {
      const message = String(rpcError.message || '')
      const match = message.match(
        /FP_REOPENED_SUBMISSION_SUBMIT_(INVALID|NOT_FOUND|FORBIDDEN|CONFLICT):\s*(.*)/s,
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
          statusMessage: match[2] || 'The submission correction could not be finalized.',
        })
      }

      console.error('[final-project-reopened-submit] RPC failed', rpcError)
      throw createError({
        statusCode: 500,
        statusMessage: 'Unable to finalize the submission correction.',
      })
    }

    const validCorrectionResponse =
      rpcData?.submitted === true &&
      rpcData?.correction === true &&
      rpcData?.allExaminersSubmitted === true &&
      Number.isFinite(Number(rpcData?.examinerAverage)) &&
      typeof rpcData?.letterGrade === 'string' &&
      typeof rpcData?.decision === 'string' &&
      Number.isFinite(Number(rpcData?.submittedExaminerCount)) &&
      Number.isFinite(Number(rpcData?.totalExaminerCount)) &&
      Number.isFinite(Number(rpcData?.overallAverage)) &&
      typeof rpcData?.overallLetterGrade === 'string' &&
      typeof rpcData?.overallDecision === 'string'

    if (!validCorrectionResponse) {
      console.error('[final-project-reopened-submit] Unexpected RPC response', rpcData)
      throw createError({
        statusCode: 500,
        statusMessage: 'The correction returned an unexpected result.',
      })
    }

    await notifyAllAdmins(adminClient, {
      type: 'final_project_assessment_corrected',
      title: 'Final Project Submission correction completed',
      body:
        `${examiner.name} finalized a correction for ` +
        `${assignment.student?.name || 'the student'}. ` +
        `Updated overall average: ${rpcData.overallAverage}. ` +
        `Grade: ${rpcData.overallLetterGrade}. ` +
        `Decision: ${rpcData.overallDecision}.`,
      entityType: 'final_project_submission',
      entityId: submissionId,
    })

    return { data: rpcData }
  }

  /*
   * Submit an ordinary Submission assessment atomically.
   * Approved re-grading returned through its separate RPC above.
   */
  if (!regradingApproved) {
    const adminClient = await serverSupabaseServiceRole(event)

    const { data: rpcData, error: rpcError } = await adminClient.rpc(
      'submit_final_project_submission',
      {
        p_submission_id: submissionId,
        p_examiner_id: examiner.id,
        p_grades: grades,
        p_signature_text: signatureText,
        p_feedback: feedback,
        p_recommendations: recommendations,
      },
    )

    if (rpcError) {
      const message = String(rpcError.message || '')
      const match = message.match(
        /FP_SUBMISSION_SUBMIT_(INVALID|NOT_FOUND|FORBIDDEN|CONFLICT):\s*(.*)/s,
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
          statusMessage: match[2] || 'The assessment could not be submitted.',
        })
      }

      console.error('[final-project-submit] RPC failed', rpcError)

      throw createError({
        statusCode: 500,
        statusMessage: 'Unable to submit the assessment.',
      })
    }

    const countsValid =
      Number.isInteger(Number(rpcData?.submittedExaminerCount)) &&
      Number.isInteger(Number(rpcData?.totalExaminerCount)) &&
      Number(rpcData.totalExaminerCount) >= 1 &&
      Number(rpcData.submittedExaminerCount) >= 1 &&
      Number(rpcData.submittedExaminerCount) <= Number(rpcData.totalExaminerCount)

    const commonResponseValid =
      rpcData?.submitted === true &&
      typeof rpcData?.allExaminersSubmitted === 'boolean' &&
      rpcData?.examinerAverage !== null &&
      rpcData?.examinerAverage !== undefined &&
      Number.isFinite(Number(rpcData.examinerAverage)) &&
      typeof rpcData?.letterGrade === 'string' &&
      typeof rpcData?.decision === 'string' &&
      countsValid

    const overallResponseValid = rpcData?.allExaminersSubmitted
      ? rpcData?.overallAverage !== null &&
        rpcData?.overallAverage !== undefined &&
        Number.isFinite(Number(rpcData.overallAverage)) &&
        typeof rpcData?.overallLetterGrade === 'string' &&
        typeof rpcData?.overallDecision === 'string'
      : rpcData?.overallAverage === null &&
        rpcData?.overallLetterGrade === null &&
        rpcData?.overallDecision === null

    if (!commonResponseValid || !overallResponseValid) {
      console.error('[final-project-submit] Unexpected RPC response', rpcData)

      throw createError({
        statusCode: 500,
        statusMessage: 'The submission returned an unexpected result.',
      })
    }

    if (rpcData.allExaminersSubmitted) {
      await notifyAllAdmins(adminClient, {
        type: 'final_project_assessment_submitted',
        title: 'Final Project Submission assessment completed',
        body:
          `${assignment.student?.name || 'Student'} has received all ` +
          `${rpcData.totalExaminerCount} examiner assessments. ` +
          `Overall average: ${rpcData.overallAverage}. ` +
          `Grade: ${rpcData.overallLetterGrade}. ` +
          `Decision: ${rpcData.overallDecision}.`,
        entityType: 'final_project_submission',
        entityId: submissionId,
      })
    } else {
      await notifyAllAdmins(adminClient, {
        type: 'final_project_examiner_assessment_submitted',
        title: 'Final Project Submission assessment received',
        body:
          `${examiner.name} submitted their assessment for ` +
          `${assignment.student?.name || 'the student'}. ` +
          `${rpcData.submittedExaminerCount} of ` +
          `${rpcData.totalExaminerCount} assigned examiners have now submitted.`,
        entityType: 'final_project_submission',
        entityId: submissionId,
      })
    }

    return { data: rpcData }
  }

  /*
   * Preflight approved re-grading before the first grade write.
   */
  let adminClient = null
  let regradingHistoryId = null

  if (regradingApproved && regradingRequest) {
    adminClient = await serverSupabaseServiceRole(event)

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
          'The approved re-grading request has no matching history record. No grades were submitted.',
      })
    }

    regradingHistoryId = history.id

    const { data: preflightRows, error: preflightRowsError } =
      await adminClient
        .from('final_project_assignment_examiners')
        .select('examiner_id')
        .eq('assignment_id', assignment.id)

    if (preflightRowsError) {
      throw createError({
        statusCode: 500,
        statusMessage: preflightRowsError.message,
      })
    }

    const preflightIds = [...new Set(
      (preflightRows || []).map(row => row.examiner_id).filter(Boolean),
    )]

    if (!preflightIds.length) {
      throw createError({
        statusCode: 409,
        statusMessage: 'No examiners are assigned to this assessment.',
      })
    }

    const { data: preflightAssessments, error: preflightAssessmentsError } =
      await adminClient
        .from('final_project_examiner_assessments')
        .select('examiner_id, status')
        .eq('submission_id', submissionId)
        .in('examiner_id', preflightIds)

    if (preflightAssessmentsError) {
      throw createError({
        statusCode: 500,
        statusMessage: preflightAssessmentsError.message,
      })
    }

    /*
     * The current examiner may be DRAFT while editing an approved
     * re-grading. All other assigned examiners must remain SUBMITTED.
     */
    if (!preflightIds.includes(examiner.id)) {
      throw createError({
        statusCode: 409,
        statusMessage:
          'You are not assigned to this assessment and cannot submit its re-grading.',
      })
    }

    const submittedIds = new Set(
      (preflightAssessments || [])
        .filter(row => row.status === 'SUBMITTED')
        .map(row => row.examiner_id),
    )

    const otherExaminersSubmitted = preflightIds
      .filter(id => id !== examiner.id)
      .every(id => submittedIds.has(id))

    if (!otherExaminersSubmitted) {
      throw createError({
        statusCode: 409,
        statusMessage:
          'Re-grading cannot proceed because another assigned examiner assessment is not submitted. No grades were changed.',
      })
    }
  }

  /*
   * Calculate this examiner's average.
   */
  const examinerAverage = round2(
    criteria.reduce(
      (sum, criterion) => sum + Number(grades[criterion.id]),
      0,
    ) / criteria.length,
  )

  const examinerLetterGrade = letterGrade(examinerAverage)
  const examinerDecision = decisionForGrade(examinerAverage)

  /*
   * Save this examiner's grades.
   */
  for (const criterion of criteria) {
    const { error } = await supabase
      .from('final_project_grades')
      .upsert(
        {
          submission_id: submissionId,
          criterion_id: criterion.id,
          examiner_id: examiner.id,
          grade: Number(grades[criterion.id]),
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
   * Save the examiner's signature.
   */
  const { error: signatureError } = await supabase
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

  if (signatureError) {
    throw createError({
      statusCode: 500,
      statusMessage: signatureError.message,
    })
  }

  /*
   * Mark this examiner's assessment SUBMITTED.
   */
  const { error: assessmentError } = await supabase
    .from('final_project_examiner_assessments')
    .upsert(
      {
        submission_id: submissionId,
        examiner_id: examiner.id,
        status: 'SUBMITTED',
        average_grade: examinerAverage,
        letter_grade: examinerLetterGrade,
        decision: examinerDecision,
        feedback,
        recommendations,
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'submission_id,examiner_id',
      },
    )

  if (assessmentError) {
    throw createError({
      statusCode: 500,
      statusMessage: assessmentError.message,
    })
  }

  /*
   * From this point onward, use the service-role client for the
   * shared completion check. RLS intentionally prevents an examiner
   * from reading other examiners' private assessment rows.
   */
  adminClient = adminClient || await serverSupabaseServiceRole(event)

  const { data: assignedRows, error: assignedError } =
    await adminClient
      .from('final_project_assignment_examiners')
      .select('examiner_id, examiners ( id, name, email )')
      .eq('assignment_id', assignment.id)

  if (assignedError) {
    throw createError({
      statusCode: 500,
      statusMessage: assignedError.message,
    })
  }

  const assignedExaminerIds = [...new Set(
    (assignedRows || [])
      .map((row) => row.examiner_id)
      .filter(Boolean),
  )]

  if (!assignedExaminerIds.length) {
    throw createError({
      statusCode: 500,
      statusMessage:
        'No examiners are assigned to this final project submission.',
    })
  }

  const { data: submittedAssessments, error: submittedError } =
    await adminClient
      .from('final_project_examiner_assessments')
      .select(
        'examiner_id, status, average_grade, letter_grade, decision',
      )
      .eq('submission_id', submissionId)
      .in('examiner_id', assignedExaminerIds)

  if (submittedError) {
    throw createError({
      statusCode: 500,
      statusMessage: submittedError.message,
    })
  }

  const submittedByExaminer = new Map(
    (submittedAssessments || [])
      .filter((assessment) => assessment.status === 'SUBMITTED')
      .map((assessment) => [
        assessment.examiner_id,
        assessment,
      ]),
  )

  const allExaminersSubmitted =
    submittedByExaminer.size === assignedExaminerIds.length

  /*
   * A re-grading submission must not reopen the shared assessment.
   * The original submission was already complete, so all assigned
   * examiner assessments should still be submitted after this
   * examiner's revised assessment is saved.
   */
  if (regradingApproved && !allExaminersSubmitted) {
    throw createError({
      statusCode: 500,
      statusMessage:
        'Re-grading could not be completed because not all assigned examiner assessments are submitted.',
    })
  }

  /*
   * Not everyone has submitted yet.
   */
  if (!allExaminersSubmitted) {
    const { error: progressError } = await adminClient
      .from('final_project_submissions')
      .update({
        status: 'IN_PROGRESS',
        average_grade: null,
        submitted_by: null,
        submitted_at: null,
      })
      .eq('id', submissionId)

    if (progressError) {
      throw createError({
        statusCode: 500,
        statusMessage: progressError.message,
      })
    }

    await notifyAllAdmins(adminClient, {
      type: 'final_project_examiner_assessment_submitted',
      title: 'Final Project Submission assessment received',
      body:
        `${examiner.name} submitted their assessment for ` +
        `${assignment.student?.name || 'the student'}. ` +
        `${submittedByExaminer.size} of ${assignedExaminerIds.length} ` +
        'assigned examiners have now submitted.',
      entityType: 'final_project_submission',
      entityId: submissionId,
    })

    return {
      data: {
        submitted: true,
        examinerAverage,
        letterGrade: examinerLetterGrade,
        decision: examinerDecision,
        allExaminersSubmitted: false,
        submittedExaminerCount: submittedByExaminer.size,
        totalExaminerCount: assignedExaminerIds.length,
        overallAverage: null,
        overallLetterGrade: null,
        overallDecision: null,
      },
    }
  }

  /*
   * ------------------------------------------------------------
   * ALL EXAMINERS HAVE SUBMITTED
   * ------------------------------------------------------------
   *
   * Overall average = mean of the examiner averages.
   */
  const examinerAverages = assignedExaminerIds.map((examinerId) => {
    const assessment = submittedByExaminer.get(examinerId)

    if (
      !assessment ||
      assessment.average_grade === null ||
      assessment.average_grade === undefined
    ) {
      throw createError({
        statusCode: 500,
        statusMessage:
          'One or more submitted examiner assessments has no average grade.',
      })
    }

    return Number(assessment.average_grade)
  })

  const overallAverage = round2(
    examinerAverages.reduce((sum, value) => sum + value, 0) /
      examinerAverages.length,
  )

  const overallLetterGrade = letterGrade(overallAverage)
  const overallDecision = decisionForGrade(overallAverage)
  const submittedAt = new Date().toISOString()

  /*
   * The shared submission is now officially complete.
   */
  const { error: submissionError } = await adminClient
    .from('final_project_submissions')
    .update({
      status: 'SUBMITTED',
      average_grade: overallAverage,
      submitted_by: examiner.id,
      submitted_at: submittedAt,
    })
    .eq('id', submissionId)

  if (submissionError) {
    throw createError({
      statusCode: 500,
      statusMessage: submissionError.message,
    })
  }

  /*
   * Complete the approved re-grading request and preserve the
   * revised assessment values in the re-grading history.
   */
  if (regradingApproved && regradingRequest) {
    const revisedGrades = Object.fromEntries(
      criterionIds.map((criterionId) => [
        criterionId,
        Number(grades[criterionId]),
      ]),
    )
    if (!regradingHistoryId) {
      throw createError({
        statusCode: 409,
        statusMessage:
          'The approved re-grading history was not validated before submission.',
      })
    }

    const { data: updatedHistory, error: historyUpdateError } =
      await adminClient
        .from('final_project_regrading_history')
        .update({
          revised_grades: revisedGrades,
          revised_average_grade: examinerAverage,
          revised_letter_grade: examinerLetterGrade,
          revised_decision: examinerDecision,
          revised_feedback: feedback,
          revised_recommendations: recommendations,
          completed_at: submittedAt,
        })
        .eq('id', regradingHistoryId)
        .eq('regrading_request_id', regradingRequest.id)
        .eq('submission_id', submissionId)
        .eq('examiner_id', examiner.id)
        .select('id')
        .maybeSingle()

    if (historyUpdateError) {
      throw createError({
        statusCode: 500,
        statusMessage: historyUpdateError.message,
      })
    }

    if (!updatedHistory) {
      throw createError({
        statusCode: 409,
        statusMessage:
          'The revised assessment history was not updated. The re-grading request was not marked completed.',
      })
    }

    const { data: completedRequest, error: regradingCompleteError } =
      await adminClient
        .from('final_project_regrading_requests')
        .update({
          status: 'COMPLETED',
          completed_at: submittedAt,
          updated_at: submittedAt,
        })
        .eq('id', regradingRequest.id)
        .eq('status', 'APPROVED')
        .select('id')
        .maybeSingle()

    if (regradingCompleteError) {
      throw createError({
        statusCode: 500,
        statusMessage: regradingCompleteError.message,
      })
    }

    if (!completedRequest) {
      throw createError({
        statusCode: 409,
        statusMessage:
          'The re-grading request was not completed because it is no longer approved.',
      })
    }
  }

  /*
   * Notify administrators only when the complete Submission
   * assessment has been received from every assigned examiner.
   */
  await notifyAllAdmins(adminClient, {
    type: 'final_project_assessment_submitted',
    title: 'Final Project Submission assessment completed',
    body:
      `${assignment.student?.name || 'Student'} has received all ` +
      `${assignedExaminerIds.length} examiner assessments. ` +
      `Overall average: ${overallAverage}. ` +
      `Grade: ${overallLetterGrade}. ` +
      `Decision: ${overallDecision}.`,
    entityType: 'final_project_submission',
    entityId: submissionId,
  })

  return {
    data: {
      submitted: true,
      examinerAverage,
      letterGrade: examinerLetterGrade,
      decision: examinerDecision,
      allExaminersSubmitted: true,
      submittedExaminerCount: assignedExaminerIds.length,
      totalExaminerCount: assignedExaminerIds.length,
      overallAverage,
      overallLetterGrade,
      overallDecision,
    },
  }
})
