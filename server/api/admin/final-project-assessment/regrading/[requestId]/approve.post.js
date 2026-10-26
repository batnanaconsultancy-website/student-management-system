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
   * Resolve the database administrator ID used by reviewed_by.
   */
  const { data: adminRow, error: adminError } = await supabase
    .from("admin")
    .select("id")
    .eq("email", adminUser.email)
    .maybeSingle();

  if (adminError) {
    console.error(
      "[final-project-regrading] Failed to resolve administrator:",
      adminError,
    );

    throw createError({
      statusCode: 500,
      statusMessage: "Unable to verify the administrator record.",
    });
  }

  if (!adminRow) {
    throw createError({
      statusCode: 404,
      statusMessage: "Administrator record not found.",
    });
  }

  /*
   * Atomically preserve the original assessment snapshot and approve
   * the request. Both operations are handled by the database RPC.
   */
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "approve_final_project_regrading_request",
    {
      p_request_id: requestId,
      p_admin_id: adminRow.id,
    },
  );

  if (rpcError) {
    const message =
      typeof rpcError.message === "string" ? rpcError.message : "";

    const match = message.match(
      /FP_REGRADING_(INVALID|NOT_FOUND|FORBIDDEN|CONFLICT):\s*(.*)/s,
    );

    if (match) {
      const [, category, detail] = match;
      const statusByCategory = {
        INVALID: 400,
        NOT_FOUND: 404,
        FORBIDDEN: 403,
        CONFLICT: 409,
      };

      throw createError({
        statusCode: statusByCategory[category],
        statusMessage: detail.trim() || "Unable to approve the re-grading request.",
      });
    }

    console.error(
      "[final-project-regrading] Atomic approval RPC failed:",
      rpcError,
    );

    throw createError({
      statusCode: 500,
      statusMessage: "Unable to approve the re-grading request.",
    });
  }

  if (
    !rpcData?.request?.id ||
    String(rpcData.request.id) !== String(requestId) ||
    rpcData.request.status !== "APPROVED" ||
    !rpcData.historyId
  ) {
    console.error(
      "[final-project-regrading] Unexpected atomic approval RPC response.",
      rpcData,
    );

    throw createError({
      statusCode: 500,
      statusMessage: "The approval operation returned an invalid response.",
    });
  }

  return {
    data: {
      request: rpcData.request,
      historyId: rpcData.historyId,
    },
  };
});
