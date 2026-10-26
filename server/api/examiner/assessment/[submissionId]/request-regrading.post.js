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
   * The database RPC performs the authoritative checks and inserts the
   * request atomically, including protection against duplicate pending
   * requests and concurrent request-number allocation.
   */
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "create_final_project_regrading_request",
    {
      p_submission_id: submissionId,
      p_examiner_id: examiner.id,
      p_reason: reason,
    },
  );

  if (rpcError) {
    const message = String(rpcError.message || "");
    const match = message.match(
      /^FP_REGRADING_(INVALID|NOT_FOUND|FORBIDDEN|CONFLICT):(.*)$/s,
    );

    if (match) {
      const statusByCode = {
        INVALID: 400,
        NOT_FOUND: 404,
        FORBIDDEN: 403,
        CONFLICT: 409,
      };

      throw createError({
        statusCode: statusByCode[match[1]],
        statusMessage: match[2].trim() || "The re-grading request could not be created.",
      });
    }

    console.error("Failed to create final project re-grading request:", rpcError);
    throw createError({
      statusCode: 500,
      statusMessage: "The re-grading request could not be created.",
    });
  }

  const request = rpcData?.request;

  if (
    !request?.id ||
    request.request_number == null ||
    request.status !== "PENDING"
  ) {
    console.error("Re-grading request RPC returned an unexpected response.");
    throw createError({
      statusCode: 500,
      statusMessage: "The re-grading request could not be created.",
    });
  }

  const requestNumber = request.request_number;

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
