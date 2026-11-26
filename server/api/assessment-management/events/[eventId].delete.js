import { createError, getRouterParam } from "h3";
import { requireBachelorAssessmentManagementAccess } from "~/server/utils/bachelorAssessmentManagementAuth";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default defineEventHandler(async (event) => {
  const access = await requireBachelorAssessmentManagementAccess(event);

  if (!access.isAdmin && !access.isAssessmentManager) {
    throw createError({
      statusCode: 403,
      statusMessage: "Only admins and active Assessment Managers can delete Case Study Forum events.",
    });
  }

  const eventId = getRouterParam(event, "eventId");

  if (!eventId || !UUID_PATTERN.test(eventId)) {
    throw createError({
      statusCode: 400,
      statusMessage: "A valid Case Study Forum event ID is required.",
    });
  }

  const { data, error } = await access.service.rpc(
    "delete_bachelor_case_study_forum_event",
    {
      p_event_id: eventId,
      p_actor_email: access.user.email.trim().toLowerCase(),
    },
  );

  if (error?.code === "P0002") {
    throw createError({
      statusCode: 404,
      statusMessage: "Case Study Forum event not found.",
    });
  }

  if (error) {
    console.error("Deleting Case Study Forum event failed:", error.message);
    throw createError({
      statusCode: 500,
      statusMessage: "Unable to delete the Case Study Forum event.",
    });
  }

  return { data };
});
