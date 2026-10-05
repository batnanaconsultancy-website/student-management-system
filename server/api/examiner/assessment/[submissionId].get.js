import { serverSupabaseClient, serverSupabaseServiceRole } from '#supabase/server'
import { createError } from 'h3'
import { requireExaminerForSubmission } from '~/server/utils/finalProjectAuth'

// GET /api/examiner/assessment/:submissionId
//
// Submission:
//   Returns the shared multi-examiner assessment view.
//   The current examiner can see/edit their own assessment.
//   Other examiners' grades are visible only after they submit.
//
// Presentation:
//   Preserves the existing single-examiner behaviour for now.

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

  /*
   * ------------------------------------------------------------
   * PRESENTATION
   * ------------------------------------------------------------
   * Keep the existing behaviour unchanged for now.
   */
  if (submission.assessment_type === 'presentation') {
    const [criteriaResult, gradesResult, signaturesResult, allExaminersResult] =
      await Promise.all([
        supabase
          .from('final_project_criteria')
          .select('id, label, max_grade, display_order')
          .eq('assessment_type', 'presentation')
          .eq('is_active', true)
          .order('display_order', { ascending: true }),

        supabase
          .from('final_project_grades')
          .select('criterion_id, grade')
          .eq('submission_id', submissionId)
          .eq('examiner_id', examiner.id),

        supabase
          .from('final_project_signatures')
          .select('examiner_id, signature_text, signed_at, examiners ( name )')
          .eq('submission_id', submissionId),

        supabase
          .from('final_project_assignment_examiners')
          .select('examiner_id, examiners ( id, name )')
          .eq('assignment_id', assignment.id),
      ])

    if (criteriaResult.error) {
      throw createError({
        statusCode: 500,
        statusMessage: criteriaResult.error.message,
      })
    }

    if (gradesResult.error) {
      throw createError({
        statusCode: 500,
        statusMessage: gradesResult.error.message,
      })
    }

    if (signaturesResult.error) {
      throw createError({
        statusCode: 500,
        statusMessage: signaturesResult.error.message,
      })
    }

    if (allExaminersResult.error) {
      throw createError({
        statusCode: 500,
        statusMessage: allExaminersResult.error.message,
      })
    }

    const gradeByCriterion = new Map(
      (gradesResult.data || []).map((row) => [row.criterion_id, row.grade]),
    )

    const criteria = (criteriaResult.data || []).map((criterion) => ({
      ...criterion,
      grade: gradeByCriterion.get(criterion.id) ?? null,
    }))

    const allExaminers = (allExaminersResult.data || [])
      .map((row) => row.examiners)
      .filter(Boolean)

    const signatures = (signaturesResult.data || []).map((row) => ({
      examinerId: row.examiner_id,
      signatureText: row.signature_text,
      signedAt: row.signed_at,
      examinerName: row.examiners?.name || null,
    }))

    const isReadOnly =
      submission.status === 'SUBMITTED' &&
      !(
        submission.reopened_at &&
        submission.submitted_at &&
        new Date(submission.reopened_at) > new Date(submission.submitted_at)
      )

    return {
      data: {
        submissionId,
        assessmentType: 'presentation',
        status: submission.status,
        averageGrade: submission.average_grade,
        isReadOnly,
        reopenReason: submission.reopen_reason || null,
        assessmentActivated: ['ACTIVATED', 'IN_PROGRESS', 'SUBMITTED'].includes(
          submission.status,
        ),
        student: assignment.student || null,
        examiner: {
          id: examiner.id,
          name: examiner.name,
          email: examiner.email,
        },
        coExaminers: allExaminers.filter((item) => item.id !== examiner.id),
        criteria,
        signatures,
      },
    }
  }

  /*
   * ------------------------------------------------------------
   * SUBMISSION — NEW MULTI-EXAMINER MODEL
   * ------------------------------------------------------------
   */

  /*
   * Use service role for the read side because the normal RLS policy
   * intentionally allows an examiner to see only their own grades.
   *
   * Authorization was already performed above through
   * requireExaminerForSubmission().
   */
  const adminClient = await serverSupabaseServiceRole(event)

  const [
    criteriaResult,
    examinersResult,
    assessmentsResult,
    signaturesResult,
    gradesResult,
    regradingRequestResult,
  ] = await Promise.all([
    adminClient
      .from('final_project_criteria')
      .select('id, label, max_grade, display_order, description')
      .eq('assessment_type', 'submission')
      .eq('is_active', true)
      .order('display_order', { ascending: true }),

    adminClient
      .from('final_project_assignment_examiners')
      .select(`
        examiner_id,
        assigned_at,
        examiners (
          id,
          name,
          email,
          is_active
        )
      `)
      .eq('assignment_id', assignment.id)
      .order('assigned_at', { ascending: true }),

    adminClient
      .from('final_project_examiner_assessments')
      .select(`
        id,
        submission_id,
        examiner_id,
        status,
        average_grade,
        letter_grade,
        decision,
        feedback,
        recommendations,
        submitted_at,
        created_at,
        updated_at
      `)
      .eq('submission_id', submissionId),

    adminClient
      .from('final_project_signatures')
      .select(`
        examiner_id,
        signature_text,
        signed_at,
        examiners (
          name
        )
      `)
      .eq('submission_id', submissionId),

    adminClient
      .from('final_project_grades')
      .select('criterion_id, examiner_id, grade')
      .eq('submission_id', submissionId),

    adminClient
      .from('final_project_regrading_requests')
      .select(`
        id,
        request_number,
        reason,
        status,
        reviewed_by,
        reviewed_at,
        approved_at,
        completed_at,
        created_at
      `)
      .eq('submission_id', submissionId)
      .eq('examiner_id', examiner.id)
      .order('request_number', { ascending: false })
      .limit(1),
  ])

  if (criteriaResult.error) {
    throw createError({
      statusCode: 500,
      statusMessage: criteriaResult.error.message,
    })
  }

  if (examinersResult.error) {
    throw createError({
      statusCode: 500,
      statusMessage: examinersResult.error.message,
    })
  }

  if (assessmentsResult.error) {
    throw createError({
      statusCode: 500,
      statusMessage: assessmentsResult.error.message,
    })
  }

  if (signaturesResult.error) {
    throw createError({
      statusCode: 500,
      statusMessage: signaturesResult.error.message,
    })
  }

  if (gradesResult.error) {
    throw createError({
      statusCode: 500,
      statusMessage: gradesResult.error.message,
    })
  }

  if (regradingRequestResult.error) {
    throw createError({
      statusCode: 500,
      statusMessage: regradingRequestResult.error.message,
    })
  }

  const regradingRequest = regradingRequestResult.data?.[0] || null
  const regradingApproved = regradingRequest?.status === 'APPROVED'

  const criteria = (criteriaResult.data || []).map((criterion) => ({
    id: criterion.id,
    label: criterion.label,
    maxGrade: criterion.max_grade,
    displayOrder: criterion.display_order,
    description: criterion.description,
  }))

  const assignedExaminers = (examinersResult.data || [])
    .map((row) => ({
      id: row.examiners?.id || row.examiner_id,
      name: row.examiners?.name || 'Unknown examiner',
      email: row.examiners?.email || null,
      isActive: row.examiners?.is_active ?? true,
      assignedAt: row.assigned_at,
    }))
    .filter((item) => item.id)

  /*
   * Make sure the current examiner has an assessment row.
   *
   * This is intentionally done server-side so the frontend does not
   * have to create assessment records merely by opening the page.
   */
  let assessments = assessmentsResult.data || []

  let ownAssessment = assessments.find(
    (item) => item.examiner_id === examiner.id,
  )

  if (!ownAssessment) {
    const { data: createdAssessment, error: createAssessmentError } =
      await adminClient
        .from('final_project_examiner_assessments')
        .insert({
          submission_id: submissionId,
          examiner_id: examiner.id,
          status: 'DRAFT',
        })
        .select(`
          id,
          submission_id,
          examiner_id,
          status,
          average_grade,
          letter_grade,
          decision,
          feedback,
          recommendations,
          submitted_at,
          created_at,
          updated_at
        `)
        .single()

    if (createAssessmentError) {
      throw createError({
        statusCode: 500,
        statusMessage: createAssessmentError.message,
      })
    }

    ownAssessment = createdAssessment
    assessments = [...assessments, createdAssessment]
  }

  const assessmentByExaminer = new Map(
    assessments.map((assessment) => [assessment.examiner_id, assessment]),
  )

  const signatureByExaminer = new Map(
    (signaturesResult.data || []).map((signature) => [
      signature.examiner_id,
      {
        examinerId: signature.examiner_id,
        signatureText: signature.signature_text,
        signedAt: signature.signed_at,
        examinerName: signature.examiners?.name || null,
      },
    ]),
  )

  const gradesByExaminer = new Map()

  for (const row of gradesResult.data || []) {
    if (!gradesByExaminer.has(row.examiner_id)) {
      gradesByExaminer.set(row.examiner_id, new Map())
    }

    gradesByExaminer
      .get(row.examiner_id)
      .set(row.criterion_id, row.grade)
  }

  /*
   * Only submitted examiners' grades are exposed to other examiners.
   *
   * The current examiner can always see their own grades while drafting.
   */
  const examinerColumns = assignedExaminers.map((assignedExaminer) => {
    const assessment = assessmentByExaminer.get(assignedExaminer.id) || null
    const isCurrent = assignedExaminer.id === examiner.id
    const isSubmitted = assessment?.status === 'SUBMITTED'

    const grades = {}

    if (isCurrent || isSubmitted) {
      const examinerGrades = gradesByExaminer.get(assignedExaminer.id)

      for (const criterion of criteria) {
        grades[criterion.id] = examinerGrades?.get(criterion.id) ?? null
      }
    }

    const signature = signatureByExaminer.get(assignedExaminer.id)

    return {
      id: assignedExaminer.id,
      name: assignedExaminer.name,
      email: assignedExaminer.email,
      isCurrent,
      status: assessment?.status || 'DRAFT',
      averageGrade: assessment?.average_grade ?? null,
      letterGrade: assessment?.letter_grade ?? null,
      decision: assessment?.decision ?? null,
      feedback: isCurrent || isSubmitted ? assessment?.feedback || '' : null,
      recommendations:
        isCurrent || isSubmitted ? assessment?.recommendations || '' : null,
      submittedAt: assessment?.submitted_at || null,
      signature: signature || null,
      grades,
      canEdit:
        isCurrent &&
        (
          !assessment ||
          assessment.status === 'DRAFT' ||
          (
            assessment.status === 'SUBMITTED' &&
            regradingApproved
          )
        ),
    }
  })

  /*
   * An examiner with an approved re-grading request can edit only
   * their own submitted assessment.
   *
   * For normal assessment work, only DRAFT assessments are editable.
   */
  const submittedExaminerCount = examinerColumns.filter(
    (item) => item.status === 'SUBMITTED',
  ).length

  const allExaminersSubmitted =
    assignedExaminers.length > 0 &&
    submittedExaminerCount === assignedExaminers.length

  let overallAverage = null
  let overallLetterGrade = null
  let overallDecision = null

  if (allExaminersSubmitted) {
    const examinerAverages = examinerColumns
      .map((item) => Number(item.averageGrade))
      .filter((value) => Number.isFinite(value))

    if (examinerAverages.length === assignedExaminers.length) {
      overallAverage = round2(
        examinerAverages.reduce((sum, value) => sum + value, 0) /
          examinerAverages.length,
      )

      overallLetterGrade = letterGrade(overallAverage)
      overallDecision = decisionForGrade(overallAverage)
    }
  }

  /*
   * The shared submission row becomes the authoritative overall
   * result only after all assigned examiners have submitted.
   *
   * An APPROVED re-grading request temporarily unlocks only the
   * requesting examiner's submitted assessment.
   */
  const isReadOnly =
    ownAssessment.status === 'SUBMITTED' &&
    !regradingApproved

  const canEdit = examinerColumns.find(
    (item) => item.id === examiner.id,
  )?.canEdit || false

  const overallResultAvailable = allExaminersSubmitted

  return {
    data: {
      submissionId,
      assessmentType: 'submission',

      status: submission.status,
      averageGrade: overallResultAvailable
        ? overallAverage
        : null,

      overall: {
        available: overallResultAvailable,
        averageGrade: overallAverage,
        letterGrade: overallLetterGrade,
        decision: overallDecision,
        submittedExaminerCount,
        totalExaminerCount: assignedExaminers.length,
      },

      isReadOnly,
      canEdit,

      regrading: {
        request: regradingRequest
          ? {
              id: regradingRequest.id,
              requestNumber: regradingRequest.request_number,
              reason: regradingRequest.reason,
              status: regradingRequest.status,
              reviewedBy: regradingRequest.reviewed_by,
              reviewedAt: regradingRequest.reviewed_at,
              approvedAt: regradingRequest.approved_at,
              completedAt: regradingRequest.completed_at,
              createdAt: regradingRequest.created_at,
            }
          : null,
        approved: regradingApproved,
      },

      reopenReason: submission.reopen_reason || null,

      assessmentActivated: [
        'ACTIVATED',
        'IN_PROGRESS',
        'SUBMITTED',
      ].includes(submission.status),

      student: assignment.student || null,

      examiner: {
        id: examiner.id,
        name: examiner.name,
        email: examiner.email,
      },

      examiners: examinerColumns,

      criteria,

      /*
       * Kept for compatibility with parts of the existing UI while
       * the frontend is being replaced.
       */
      signatures: Array.from(signatureByExaminer.values()),

      /*
       * The new UI should use `examiners`.
       */
      allExaminersSubmitted,
    },
  }
})
