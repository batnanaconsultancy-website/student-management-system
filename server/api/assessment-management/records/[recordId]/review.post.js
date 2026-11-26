import { createError, getRouterParam, readBody } from "h3";
import { requireBachelorAssessmentManagementAccess } from "~/server/utils/bachelorAssessmentManagementAuth";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default defineEventHandler(async (event) => {
  const access = await requireBachelorAssessmentManagementAccess(event);

  if (!access.isAdmin && !access.isAssessmentManager) {
    throw createError({
      statusCode: 403,
      statusMessage: "Only admins and active Assessment Managers can review participation records.",
    });
  }

  const recordId = getRouterParam(event, "recordId");

  if (typeof recordId !== "string" || !UUID_PATTERN.test(recordId)) {
    throw createError({
      statusCode: 400,
      statusMessage: "A valid participation record ID is required.",
    });
  }

  const body = await readBody(event);
  const decision = body?.decision;

  if (!["verified", "rejected"].includes(decision)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Decision must be verified or rejected.",
    });
  }

  const reviewNote =
    body?.review_note === undefined || body?.review_note === null
      ? null
      : typeof body.review_note === "string"
        ? body.review_note.trim() || null
        : null;

  if (
    body?.review_note !== undefined &&
    body?.review_note !== null &&
    typeof body.review_note !== "string"
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: "Review note must be text.",
    });
  }

  if (reviewNote && reviewNote.length > 2000) {
    throw createError({
      statusCode: 400,
      statusMessage: "Review note cannot exceed 2,000 characters.",
    });
  }

  const now = new Date().toISOString();

  const reviewFields =
    decision === "verified"
      ? {
          verification_status: "verified",
          verified_by_email: access.user.email,
          verified_at: now,
          rejected_by_email: null,
          rejected_at: null,
        }
      : {
          verification_status: "rejected",
          rejected_by_email: access.user.email,
          rejected_at: now,
          verified_by_email: null,
          verified_at: null,
        };

  const { data, error } = await access.service
    .from("bachelor_case_study_forum_records")
    .update({
      ...reviewFields,
      review_note: reviewNote,
      updated_by_email: access.user.email,
      updated_at: now,
    })
    .eq("id", recordId)
    .eq("verification_status", "pending")
    .select(`
      id,
      event_id,
      student_id,
      participation_role,
      evidence_reference,
      submission_note,
      points_awarded,
      verification_status,
      submitted_by_email,
      submitted_at,
      verified_by_email,
      verified_at,
      rejected_by_email,
      rejected_at,
      review_note,
      updated_by_email,
      updated_at
    `)
    .maybeSingle();

  if (error) {
    console.error("Reviewing Case Study Forum record failed:", error.message);
    throw createError({
      statusCode: 500,
      statusMessage: "Unable to review the Case Study Forum participation record.",
    });
  }

  if (!data) {
    throw createError({
      statusCode: 409,
      statusMessage: "This record does not exist or has already been reviewed.",
    });
  }

  return { data };
});
