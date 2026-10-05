import { serverSupabaseServiceRole } from "#supabase/server";
import { createError, getRouterParam } from "h3";
import { requireFinalProjectAdmin } from "~/server/utils/finalProjectAuth";

export default defineEventHandler(async (event) => {
  const requestId = getRouterParam(event, "requestId");

  if (!requestId) {
    throw createError({
      statusCode: 400,
      statusMessage: "Re-grading request ID is required.",
    });
  }

  /*
   * Verify that the logged-in user is an administrator.
   */
  const supabase = await serverSupabaseServiceRole(event);
  const adminUser = await requireFinalProjectAdmin(event, supabase);

  /*
   * Load the pending re-grading request.
   */
  const { data: request, error: requestError } = await supabase
    .from("final_project_regrading_requests")
    .select(
      `
      id,
      submission_id,
      examiner_id,
      request_number,
      reason,
      status,
      created_at
    `,
    )
    .eq("id", requestId)
    .maybeSingle();

  if (requestError) {
    throw createError({
      statusCode: 500,
      statusMessage: requestError.message,
    });
  }

  if (!request) {
    throw createError({
      statusCode: 404,
      statusMessage: "Re-grading request not found.",
    });
  }

  if (request.status !== "PENDING") {
    throw createError({
      statusCode: 409,
      statusMessage:
        `Re-grading request #${request.request_number} is already ` +
        `${request.status.toLowerCase()}.`,
    });
  }

  /*
   * Confirm that the request belongs to a Final Project Submission.
   */
  const { data: submission, error: submissionError } = await supabase
    .from("final_project_submissions")
    .select("id, assignment_id, assessment_type, status")
    .eq("id", request.submission_id)
    .maybeSingle();

  if (submissionError) {
    throw createError({
      statusCode: 500,
      statusMessage: submissionError.message,
    });
  }

  if (!submission) {
    throw createError({
      statusCode: 404,
      statusMessage: "Submission assessment not found.",
    });
  }

  if (submission.assessment_type !== "submission") {
    throw createError({
      statusCode: 400,
      statusMessage:
        "Re-grading is only available for Final Project Submission assessments.",
    });
  }

  /*
   * Load the examiner's submitted assessment.
   */
  const { data: assessment, error: assessmentError } = await supabase
    .from("final_project_examiner_assessments")
    .select(
      `
      id,
      submission_id,
      examiner_id,
      status,
      average_grade,
      letter_grade,
      decision,
      feedback,
      recommendations,
      submitted_at
    `,
    )
    .eq("submission_id", request.submission_id)
    .eq("examiner_id", request.examiner_id)
    .maybeSingle();

  if (assessmentError) {
    throw createError({
      statusCode: 500,
      statusMessage: assessmentError.message,
    });
  }

  if (!assessment) {
    throw createError({
      statusCode: 404,
      statusMessage: "The examiner's assessment was not found.",
    });
  }

  if (assessment.status !== "SUBMITTED") {
    throw createError({
      statusCode: 400,
      statusMessage: "The examiner's assessment is not currently submitted.",
    });
  }

  /*
   * Load only this examiner's grades.
   */
  const { data: grades, error: gradesError } = await supabase
    .from("final_project_grades")
    .select("criterion_id, grade")
    .eq("submission_id", request.submission_id)
    .eq("examiner_id", request.examiner_id);

  if (gradesError) {
    throw createError({
      statusCode: 500,
      statusMessage: gradesError.message,
    });
  }

  if (!grades?.length) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "No grades were found for the examiner's submitted assessment.",
    });
  }

  /*
   * Convert the original grades into a criterionId -> grade object.
   */
  const originalGrades = Object.fromEntries(
    grades.map((grade) => [grade.criterion_id, Number(grade.grade)]),
  );

  /*
   * Find the Admin record so reviewed_by can reference admin.id.
   */
  const { data: adminRow, error: adminError } = await supabase
    .from("admin")
    .select("id")
    .eq("email", adminUser.email)
    .maybeSingle();

  if (adminError) {
    throw createError({
      statusCode: 500,
      statusMessage: adminError.message,
    });
  }

  if (!adminRow) {
    throw createError({
      statusCode: 404,
      statusMessage: "Administrator record not found.",
    });
  }

  const now = new Date().toISOString();

  /*
   * Preserve the original submitted assessment BEFORE allowing
   * any re-grading changes.
   */
  const { data: history, error: historyError } = await supabase
    .from("final_project_regrading_history")
    .insert({
      regrading_request_id: request.id,
      submission_id: request.submission_id,
      examiner_id: request.examiner_id,
      request_number: request.request_number,
      original_grades: originalGrades,
      original_average_grade: assessment.average_grade,
      original_letter_grade: assessment.letter_grade,
      original_decision: assessment.decision,
      original_feedback: assessment.feedback,
      original_recommendations: assessment.recommendations,
    })
    .select("id")
    .single();

  if (historyError) {
    throw createError({
      statusCode: 500,
      statusMessage: historyError.message,
    });
  }

  /*
   * Approve the request.
   *
   * IMPORTANT:
   * The shared submission remains SUBMITTED.
   *
   * The examiner-side save/submit endpoints will later recognize
   * this APPROVED request and allow only this examiner to edit.
   */
  const { data: approvedRequest, error: updateError } = await supabase
    .from("final_project_regrading_requests")
    .update({
      status: "APPROVED",
      reviewed_by: adminRow.id,
      reviewed_at: now,
      approved_at: now,
      updated_at: now,
    })
    .eq("id", request.id)
    .eq("status", "PENDING")
    .select(
      `
      id,
      submission_id,
      examiner_id,
      request_number,
      reason,
      status,
      reviewed_by,
      reviewed_at,
      approved_at,
      created_at
    `,
    )
    .single();

  if (updateError) {
    throw createError({
      statusCode: 500,
      statusMessage: updateError.message,
    });
  }

  return {
    data: {
      request: approvedRequest,
      historyId: history.id,
    },
  };
});
