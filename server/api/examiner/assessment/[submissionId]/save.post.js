import { serverSupabaseClient } from '#supabase/server'
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
   * A submitted assessment cannot be edited.
   *
   * The future re-grading approval workflow will provide an explicit
   * approved path for editing a submitted assessment.
   */
  if (existingAssessment?.status === 'SUBMITTED') {
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
