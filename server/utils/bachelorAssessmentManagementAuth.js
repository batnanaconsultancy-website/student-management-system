import { createError } from "h3";
import { resolveBachelorAssessmentFacultyAccess } from "./bachelorAssessmentAccessPolicy.js";
import {
  serverSupabaseServiceRole,
  serverSupabaseUser,
} from "#supabase/server";

const ASSIGNMENT_PAGE_SIZE = 1000;

// Server-side authorization for the Bachelor Assessment Management APIs.
//
// Admins and active Assessment Managers can access every Bachelor student.
// Other active teaching Faculty members are restricted to active assignments.
// Examiner capability alone does not grant access.
export async function requireBachelorAssessmentManagementAccess(event) {
  let user;

  try {
    user = await serverSupabaseUser(event);
  } catch (error) {
    if (error?.message === "Auth session missing!") {
      throw createError({
        statusCode: 401,
        statusMessage: "Not authenticated",
      });
    }

    throw error;
  }

  if (!user?.email) {
    throw createError({
      statusCode: 401,
      statusMessage: "Not authenticated",
    });
  }

  const email = user.email.trim().toLowerCase();
  const service = await serverSupabaseServiceRole(event);

  // Keep admin membership consistent with the existing final-project
  // authorization helper, which uses an exact email match.
  const { data: adminRow, error: adminError } = await service
    .from("admin")
    .select("email")
    .eq("email", user.email)
    .maybeSingle();

  if (adminError) {
    console.error(
      "Bachelor assessment admin authorization failed:",
      adminError.message,
    );
    throw createError({
      statusCode: 500,
      statusMessage: "Unable to verify assessment management access.",
    });
  }

  if (adminRow) {
    return {
      user,
      service,
      isAdmin: true,
      isAssessmentManager: false,
      faculty: null,
      canViewAllBachelorStudents: true,
      studentIds: null,
    };
  }

  const { data: faculty, error: facultyError } = await service
    .from("faculty")
    .select("id, email, is_active, staff_type")
    .ilike("email", email)
    .maybeSingle();

  if (facultyError) {
    console.error(
      "Bachelor assessment faculty authorization failed:",
      facultyError.message,
    );
    throw createError({
      statusCode: 500,
      statusMessage: "Unable to verify assessment management access.",
    });
  }

  // Reject missing or inactive faculty before querying appointments.
  if (!faculty || faculty.is_active !== true) {
    throw createError({
      statusCode: 403,
      statusMessage: "Active Faculty access is required.",
    });
  }

  // An active Assessment Manager appointment grants the wider capability.
  // The faculty account must still be active, but its current staff_type
  // does not revoke an existing appointment.
  const { data: managerAppointment, error: managerError } = await service
    .from("assessment_managers")
    .select("id")
    .eq("faculty_id", faculty.id)
    .eq("is_active", true)
    .maybeSingle();

  if (managerError) {
    console.error(
      "Assessment Manager authorization failed:",
      managerError.message,
    );
    throw createError({
      statusCode: 500,
      statusMessage: "Unable to verify Assessment Manager access.",
    });
  }

  const facultyAccess = resolveBachelorAssessmentFacultyAccess(
    faculty,
    managerAppointment,
  );

  if (facultyAccess === "denied") {
    throw createError({
      statusCode: 403,
      statusMessage: "Active teaching Faculty or Assessment Manager access is required.",
    });
  }

  if (facultyAccess === "assessment_manager") {
    return {
      user,
      service,
      isAdmin: false,
      isAssessmentManager: true,
      faculty,
      canViewAllBachelorStudents: true,
      studentIds: null,
    };
  }

  // Fetch every active assignment in pages. Supabase commonly limits a
  // response to 1,000 rows, so a single unpaged query is insufficient.
  const studentIds = [];
  let offset = 0;

  while (true) {
    const { data: assignments, error: assignmentsError } = await service
      .from("faculty_student_assignments")
      .select("student_id")
      .eq("faculty_id", faculty.id)
      .eq("is_active", true)
      .order("student_id", { ascending: true })
      .range(offset, offset + ASSIGNMENT_PAGE_SIZE - 1);

    if (assignmentsError) {
      console.error(
        "Faculty student assignment lookup failed:",
        assignmentsError.message,
      );
      throw createError({
        statusCode: 500,
        statusMessage: "Unable to verify faculty student assignments.",
      });
    }

    studentIds.push(...(assignments || []).map((row) => row.student_id));

    if (!assignments || assignments.length < ASSIGNMENT_PAGE_SIZE) {
      break;
    }

    offset += ASSIGNMENT_PAGE_SIZE;
  }

  return {
    user,
    service,
    isAdmin: false,
    isAssessmentManager: false,
    faculty,
    canViewAllBachelorStudents: false,
    studentIds: [...new Set(studentIds)],
  };
}
