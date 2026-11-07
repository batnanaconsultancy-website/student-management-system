import { createError, readBody } from "h3";
import {
  requireAssessmentAccessAdmin,
  requireAssessmentAccessUuid,
  throwAssessmentAccessDatabaseError,
} from "~/server/utils/assessmentAccessAdmin";

export default defineEventHandler(async (event) => {
  const { user, service } = await requireAssessmentAccessAdmin(event);
  const body = await readBody(event);
  const assignmentId = requireAssessmentAccessUuid(
    body?.assignmentId,
    "assignment ID",
  );

  const { data: existing, error: lookupError } = await service
    .from("faculty_student_assignments")
    .select("id, is_active")
    .eq("id", assignmentId)
    .maybeSingle();

  if (lookupError) {
    throwAssessmentAccessDatabaseError(lookupError, "Finding faculty assignment");
  }

  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: "Faculty assignment not found.",
    });
  }

  if (!existing.is_active) {
    return { data: existing, alreadyDeactivated: true };
  }

  const { data, error } = await service
    .from("faculty_student_assignments")
    .update({
      is_active: false,
      deactivated_by_email: user.email,
      deactivated_at: new Date().toISOString(),
    })
    .eq("id", assignmentId)
    .eq("is_active", true)
    .select()
    .maybeSingle();

  if (error) {
    throwAssessmentAccessDatabaseError(error, "Deactivating faculty assignment");
  }

  if (!data) {
    const { data: latest, error: latestError } = await service
      .from("faculty_student_assignments")
      .select("id, is_active")
      .eq("id", assignmentId)
      .maybeSingle();

    if (latestError) {
      throwAssessmentAccessDatabaseError(
        latestError,
        "Checking faculty assignment status",
      );
    }

    if (!latest) {
      throw createError({
        statusCode: 404,
        statusMessage: "Faculty assignment not found.",
      });
    }

    if (!latest.is_active) {
      return { data: latest, alreadyDeactivated: true };
    }

    throw createError({
      statusCode: 409,
      statusMessage: "The faculty assignment could not be deactivated. Please retry.",
    });
  }

  return { data, alreadyDeactivated: false };
});
