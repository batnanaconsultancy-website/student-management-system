import { createError, readBody } from "h3";
import {
  requireAssessmentAccessAdmin,
  requireAssessmentAccessUuid,
  throwAssessmentAccessDatabaseError,
} from "~/server/utils/assessmentAccessAdmin";

export default defineEventHandler(async (event) => {
  const { user, service } = await requireAssessmentAccessAdmin(event);
  const body = await readBody(event);
  const facultyId = requireAssessmentAccessUuid(body?.facultyId, "faculty ID");
  const notes =
    typeof body?.notes === "string" ? body.notes.trim() : null;

  if (notes && notes.length > 1000) {
    throw createError({
      statusCode: 400,
      statusMessage: "Appointment notes cannot exceed 1,000 characters.",
    });
  }

  const { data: faculty, error: facultyError } = await service
    .from("faculty")
    .select("id, email, name, staff_type, is_active")
    .eq("id", facultyId)
    .maybeSingle();

  if (facultyError) {
    throwAssessmentAccessDatabaseError(facultyError, "Validating faculty");
  }

  if (!faculty || !faculty.is_active || faculty.staff_type !== "teaching") {
    throw createError({
      statusCode: 400,
      statusMessage: "Only active teaching faculty can be appointed Assessment Managers.",
    });
  }

  const { data: existing, error: existingError } = await service
    .from("assessment_managers")
    .select("id, faculty_id, is_active, appointed_at")
    .eq("faculty_id", facultyId)
    .eq("is_active", true)
    .maybeSingle();

  if (existingError) {
    throwAssessmentAccessDatabaseError(existingError, "Checking existing appointment");
  }

  if (existing) {
    return {
      data: existing,
      alreadyAppointed: true,
    };
  }

  const { data, error } = await service
    .from("assessment_managers")
    .insert({
      faculty_id: facultyId,
      appointed_by_email: user.email,
      notes,
      is_active: true,
    })
    .select()
    .single();

  if (error?.code === "23505") {
    throw createError({
      statusCode: 409,
      statusMessage: "This faculty member already has an active Assessment Manager appointment.",
    });
  }

  if (error) {
    throwAssessmentAccessDatabaseError(error, "Appointing Assessment Manager");
  }

  return { data, alreadyAppointed: false };
});
