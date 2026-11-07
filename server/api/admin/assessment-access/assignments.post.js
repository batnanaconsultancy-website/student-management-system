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
  const studentId = requireAssessmentAccessUuid(body?.studentId, "student ID");
  const notes =
    typeof body?.notes === "string" ? body.notes.trim() : null;

  if (notes && notes.length > 1000) {
    throw createError({
      statusCode: 400,
      statusMessage: "Assignment notes cannot exceed 1,000 characters.",
    });
  }

  const [facultyResult, studentResult, existingResult] = await Promise.all([
    service
      .from("faculty")
      .select("id, email, name, staff_type, is_active")
      .eq("id", facultyId)
      .maybeSingle(),

    service
      .from("students")
      .select("id, email, first_name, last_name, program_id, cohort_id, is_active")
      .eq("id", studentId)
      .maybeSingle(),

    service
      .from("faculty_student_assignments")
      .select("id, faculty_id, student_id, is_active, assigned_at")
      .eq("faculty_id", facultyId)
      .eq("student_id", studentId)
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  if (facultyResult.error) {
    throwAssessmentAccessDatabaseError(facultyResult.error, "Validating faculty");
  }

  if (studentResult.error) {
    throwAssessmentAccessDatabaseError(studentResult.error, "Validating student");
  }

  if (existingResult.error) {
    throwAssessmentAccessDatabaseError(existingResult.error, "Checking existing assignment");
  }

  const faculty = facultyResult.data;
  const student = studentResult.data;

  if (!faculty || !faculty.is_active || faculty.staff_type !== "teaching") {
    throw createError({
      statusCode: 400,
      statusMessage: "Select an active teaching faculty member.",
    });
  }

  if (!student || student.is_active !== true) {
    throw createError({
      statusCode: 400,
      statusMessage: "Select an existing active student.",
    });
  }

  if (existingResult.data) {
    return {
      data: existingResult.data,
      alreadyAssigned: true,
    };
  }

  const { data, error } = await service
    .from("faculty_student_assignments")
    .insert({
      faculty_id: facultyId,
      student_id: studentId,
      assigned_by_email: user.email,
      notes,
      is_active: true,
    })
    .select()
    .single();

  if (error?.code === "23505") {
    throw createError({
      statusCode: 409,
      statusMessage: "This faculty member is already assigned to this student.",
    });
  }

  if (error) {
    throwAssessmentAccessDatabaseError(error, "Creating faculty assignment");
  }

  return { data, alreadyAssigned: false };
});
