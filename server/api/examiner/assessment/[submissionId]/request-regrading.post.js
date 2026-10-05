import { serverSupabaseServiceRole } from "#supabase/server";
import { createError, getRouterParam, readBody } from "h3";
import { requireExaminerForSubmission } from "~/server/utils/finalProjectAuth";
import { notifyAllAdmins } from "~/server/utils/finalProjectAssessment";

export default defineEventHandler(async (event) => {
  const submissionId = getRouterParam(event, "submissionId");

  if (!submissionId) {
    throw createError({
      statusCode: 400,
      statusMessage: "Submission ID is required.",
    });
  }

  const body = await readBody(event);
  const reason = String(body?.reason || "").trim();

  if (!reason) {
    throw createError({
      statusCode: 400,
      statusMessage: "A reason for re-grading is required.",
    });
  }

  if (reason.length > 2000) {
    throw createError({
      statusCode: 400,
      statusMessage: "The re-grading reason must be 2000 characters or fewer.",
    });
  }

  /*
   * Verify that the logged-in user is an assigned examiner for this
   * submission.
   */

  const supabase = await serverSupabaseServiceRole(event);

  const { examiner } = await requireExaminerForSubmission(
    event,
    supabase,
    submissionId,
  );

  /*
   * The shared submission must exist and must already be submitted.
   */
  const { data: submission, error: submissionError } = await supabase
    .from("final_project_submissions")
    .select("id, assignment_id, assessment_type, status")
    .eq("id", submissionId)
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
      statusMessage: "Submission not found.",
    });
  }

  if (submission.assessment_type !== "submission") {
    throw createError({
      statusCode: 400,
      statusMessage:
        "Re-grading requests are only available for Final Project Submission assessments.",
    });
  }

  /*
   * The examiner must have a submitted assessment of their own.
   */
  const { data: ownAssessment, error: assessmentError } = await supabase
    .from("final_project_examiner_assessments")
    .select("id, status, average_grade, letter_grade, decision")
    .eq("submission_id", submissionId)
    .eq("examiner_id", examiner.id)
    .maybeSingle();

  if (assessmentError) {
    throw createError({
      statusCode: 500,
      statusMessage: assessmentError.message,
    });
  }

  if (!ownAssessment) {
    throw createError({
      statusCode: 404,
      statusMessage: "Your examiner assessment was not found.",
    });
  }

  if (ownAssessment.status !== "SUBMITTED") {
    throw createError({
      statusCode: 400,
      statusMessage: "Your assessment has not been submitted yet.",
    });
  }

  /*
   * Do not allow another request while one is already awaiting
   * an administrator's decision.
   */
  const { data: pendingRequest, error: pendingError } = await supabase
    .from("final_project_regrading_requests")
    .select("id, request_number, status")
    .eq("submission_id", submissionId)
    .eq("examiner_id", examiner.id)
    .eq("status", "PENDING")
    .maybeSingle();

  if (pendingError) {
    throw createError({
      statusCode: 500,
      statusMessage: pendingError.message,
    });
  }

  if (pendingRequest) {
    throw createError({
      statusCode: 409,
      statusMessage: `Re-grading request #${pendingRequest.request_number} is already pending administrator review.`,
    });
  }

  /*
   * Find the next request number for this examiner and submission.
   */
  const { data: previousRequests, error: previousRequestsError } =
    await supabase
      .from("final_project_regrading_requests")
      .select("request_number")
      .eq("submission_id", submissionId)
      .eq("examiner_id", examiner.id)
      .order("request_number", { ascending: false })
      .limit(1);

  if (previousRequestsError) {
    throw createError({
      statusCode: 500,
      statusMessage: previousRequestsError.message,
    });
  }

  const requestNumber = previousRequests?.length
    ? Number(previousRequests[0].request_number) + 1
    : 1;

  /*
   * Create the re-grading request.
   */
  const { data: request, error: requestError } = await supabase
    .from("final_project_regrading_requests")
    .insert({
      submission_id: submissionId,
      examiner_id: examiner.id,
      request_number: requestNumber,
      reason,
      status: "PENDING",
    })
    .select("id, request_number, status, reason, created_at")
    .single();

  if (requestError) {
    throw createError({
      statusCode: 500,
      statusMessage: requestError.message,
    });
  }

  /*
   * Notify every administrator through the existing Admin Inbox.
   */
  await notifyAllAdmins(supabase, {
    type: "final_project_regrading_requested",
    title: "Final project re-grading requested",
    body: `${examiner.name || examiner.email} requested re-grading #${requestNumber} for a Final Project Submission assessment.`,
    entityType: "final_project_regrading_request",
    entityId: request.id,
  });

  return {
    data: {
      request,
    },
  };
});
