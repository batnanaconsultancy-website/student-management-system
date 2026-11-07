import { createError, readBody } from "h3";
import {
  requireAssessmentAccessAdmin,
  requireAssessmentAccessUuid,
  throwAssessmentAccessDatabaseError,
} from "~/server/utils/assessmentAccessAdmin";

export default defineEventHandler(async (event) => {
  const { user, service } = await requireAssessmentAccessAdmin(event);
  const body = await readBody(event);
  const appointmentId = requireAssessmentAccessUuid(
    body?.appointmentId,
    "appointment ID",
  );

  const { data: existing, error: lookupError } = await service
    .from("assessment_managers")
    .select("id, is_active")
    .eq("id", appointmentId)
    .maybeSingle();

  if (lookupError) {
    throwAssessmentAccessDatabaseError(lookupError, "Finding Assessment Manager appointment");
  }

  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: "Assessment Manager appointment not found.",
    });
  }

  if (!existing.is_active) {
    return { data: existing, alreadyRevoked: true };
  }

  const { data, error } = await service
    .from("assessment_managers")
    .update({
      is_active: false,
      revoked_by_email: user.email,
      revoked_at: new Date().toISOString(),
    })
    .eq("id", appointmentId)
    .eq("is_active", true)
    .select()
    .maybeSingle();

  if (error) {
    throwAssessmentAccessDatabaseError(error, "Revoking Assessment Manager appointment");
  }

  if (!data) {
    const { data: latest, error: latestError } = await service
      .from("assessment_managers")
      .select("id, is_active")
      .eq("id", appointmentId)
      .maybeSingle();

    if (latestError) {
      throwAssessmentAccessDatabaseError(
        latestError,
        "Checking Assessment Manager appointment status",
      );
    }

    if (!latest) {
      throw createError({
        statusCode: 404,
        statusMessage: "Assessment Manager appointment not found.",
      });
    }

    if (!latest.is_active) {
      return { data: latest, alreadyRevoked: true };
    }

    throw createError({
      statusCode: 409,
      statusMessage: "The Assessment Manager appointment could not be revoked. Please retry.",
    });
  }

  return { data, alreadyRevoked: false };
});
