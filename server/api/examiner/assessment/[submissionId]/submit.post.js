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

  /*
   * A submitted examiner assessment can only be resubmitted
   * through an approved re-grading request.
   */
  if (
    ownAssessment?.status === 'SUBMITTED' &&
    !regradingApproved
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

  if (
    !normalSubmissionStatusAllowed &&
    !regradingSubmissionStatusAllowed
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
  const adminClient = await serverSupabaseServiceRole(event)

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

  const assignedExaminerIds = (assignedRows || [])
    .map((row) => row.examiner_id)
    .filter(Boolean)

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
    const { data: history, error: historyError } = await adminClient
      .from('final_project_regrading_history')
      .select('id')
      .eq('regrading_request_id', regradingRequest.id)
      .maybeSingle()

    if (historyError) {
      throw createError({
        statusCode: 500,
        statusMessage: historyError.message,
      })
    }

    if (!history) {
      throw createError({
        statusCode: 500,
        statusMessage:
          'The approved re-grading history record could not be found.',
      })
    }

    const { error: historyUpdateError } = await adminClient
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
      .eq('id', history.id)

    if (historyUpdateError) {
      throw createError({
        statusCode: 500,
        statusMessage: historyUpdateError.message,
      })
    }

    const { error: regradingCompleteError } = await adminClient
      .from('final_project_regrading_requests')
      .update({
        status: 'COMPLETED',
        completed_at: submittedAt,
        updated_at: submittedAt,
      })
      .eq('id', regradingRequest.id)
      .eq('status', 'APPROVED')

    if (regradingCompleteError) {
      throw createError({
        statusCode: 500,
        statusMessage: regradingCompleteError.message,
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
