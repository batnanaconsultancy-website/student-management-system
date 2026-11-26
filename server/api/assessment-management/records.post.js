import { createError, readBody } from "h3";
import { requireBachelorAssessmentManagementAccess } from "~/server/utils/bachelorAssessmentManagementAuth";

const BACHELOR_PROGRAM_IDS = [
  "bd715dd5-dc5a-414a-98f9-660274fd60e0",
  "c266131f-8e5e-4f39-9711-54523d65ea24",
  "07bc935a-c743-4cab-b10c-a1d231eaf3e2",
];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value, field) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: `A valid ${field} is required.`,
    });
  }

  return value;
}

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

export default defineEventHandler(async (event) => {
  const access = await requireBachelorAssessmentManagementAccess(event);
  const body = await readBody(event);

  const eventId = requireUuid(body?.event_id, "event ID");
  const studentId = requireUuid(body?.student_id, "student ID");

  const participationRole = body?.participation_role;

  if (!["presenter", "participant"].includes(participationRole)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Participation role must be presenter or participant.",
    });
  }

  const evidenceReference = requiredText(
    body?.evidence_reference,
    "Evidence reference",
    2000,
  );

  const submissionNote = optionalText(
    body?.submission_note,
    "Submission note",
    2000,
  );

  // Faculty access is restricted to their currently active assignments.
  if (
    !access.canViewAllBachelorStudents &&
    !(access.studentIds || []).includes(studentId)
  ) {
    throw createError({
      statusCode: 403,
      statusMessage: "You may submit participation records only for students currently assigned to you.",
    });
  }

  const [eventResult, studentResult] = await Promise.all([
    access.service
      .from("bachelor_case_study_forum_events")
      .select("id, event_title, event_date")
      .eq("id", eventId)
      .maybeSingle(),

    access.service
      .from("students")
      .select("id, email, first_name, last_name, program_id")
      .eq("id", studentId)
      .maybeSingle(),
  ]);

  if (eventResult.error) {
    console.error("Validating Case Study Forum event failed:", eventResult.error.message);
    throw createError({
      statusCode: 500,
      statusMessage: "Unable to validate the Case Study Forum event.",
    });
  }

  if (studentResult.error) {
    console.error("Validating Case Study Forum student failed:", studentResult.error.message);
    throw createError({
      statusCode: 500,
      statusMessage: "Unable to validate the student.",
    });
  }

  if (!eventResult.data) {
    throw createError({
      statusCode: 404,
      statusMessage: "Case Study Forum event not found.",
    });
  }

  const student = studentResult.data;

  if (
    !student ||
    !BACHELOR_PROGRAM_IDS.includes(student.program_id)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: "Participation records can only be submitted for students in the three Bachelor programmes.",
    });
  }

  const now = new Date().toISOString();

  const { data, error } = await access.service
    .from("bachelor_case_study_forum_records")
    .insert({
      event_id: eventId,
      student_id: studentId,
      participation_role: participationRole,
      evidence_reference: evidenceReference,
      submission_note: submissionNote,
      verification_status: "pending",
      submitted_by_email: access.user.email,
      submitted_at: now,
      updated_by_email: access.user.email,
      created_at: now,
      updated_at: now,
    })
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
      created_at,
      updated_at
    `)
    .single();

  if (error?.code === "23505") {
    throw createError({
      statusCode: 409,
      statusMessage: "A participation record already exists for this student and event.",
    });
  }

  if (error) {
    console.error("Submitting Case Study Forum participation failed:", error.message);
    throw createError({
      statusCode: 500,
      statusMessage: "Unable to submit the Case Study Forum participation record.",
    });
  }

  return {
    data: {
      ...data,
      student: {
        id: student.id,
        name: [student.first_name, student.last_name]
          .filter(Boolean)
          .join(" ")
          .trim(),
        email: student.email,
      },
      event: eventResult.data,
    },
  };
});
