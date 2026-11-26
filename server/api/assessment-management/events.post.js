import { createError, readBody } from "h3";
import { requireBachelorAssessmentManagementAccess } from "~/server/utils/bachelorAssessmentManagementAuth";

function requiredText(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} is required.`,
    });
  }

  const result = value.trim();

  if (result.length > maxLength) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} cannot exceed ${maxLength} characters.`,
    });
  }

  return result;
}

function optionalText(value, field, maxLength) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be text.`,
    });
  }

  const result = value.trim();

  if (result.length > maxLength) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} cannot exceed ${maxLength} characters.`,
    });
  }

  return result || null;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

export default defineEventHandler(async (event) => {
  const access = await requireBachelorAssessmentManagementAccess(event);

  if (!access.isAdmin && !access.isAssessmentManager) {
    throw createError({
      statusCode: 403,
      statusMessage: "Only admins and active Assessment Managers can create Case Study Forum events.",
    });
  }

  const body = await readBody(event);

  const eventTitle = requiredText(body?.event_title, "Event title", 200);
  const eventDate = body?.event_date;

  if (!validDate(eventDate)) {
    throw createError({
      statusCode: 400,
      statusMessage: "A valid event date in YYYY-MM-DD format is required.",
    });
  }

  const eventReference = optionalText(
    body?.event_reference,
    "Event reference",
    1000,
  );

  const description = optionalText(
    body?.description,
    "Description",
    5000,
  );

  const now = new Date().toISOString();

  const { data, error } = await access.service
    .from("bachelor_case_study_forum_events")
    .insert({
      event_title: eventTitle,
      event_date: eventDate,
      event_reference: eventReference,
      description,
      created_by_email: access.user.email,
      updated_by_email: access.user.email,
      created_at: now,
      updated_at: now,
    })
    .select(`
      id,
      event_title,
      event_date,
      event_reference,
      description,
      created_by_email,
      created_at,
      updated_at
    `)
    .single();

  if (error?.code === "23505") {
    throw createError({
      statusCode: 409,
      statusMessage: "An event with this title and date already exists.",
    });
  }

  if (error) {
    console.error("Creating Case Study Forum event failed:", error.message);
    throw createError({
      statusCode: 500,
      statusMessage: "Unable to create the Case Study Forum event.",
    });
  }

  return { data };
});
