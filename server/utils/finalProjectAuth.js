import { createError } from "h3";
import { serverSupabaseUser } from "#supabase/server";

// server/utils/finalProjectAuth.js
//
// Auth helpers for the Final Project Assessment module's API
// endpoints.
//
// Capability model:
//   - Admin = admin table membership
//   - Faculty = active faculty table membership
//   - Examiner = active teaching Faculty + active examiner record
//
// Admin and Examiner are independent capabilities layered on top
// of the Faculty model. An Admin who is also an Examiner can still
// use Examiner-facing endpoints.

// Any admin has full access to every Final Project Assessment record.
export async function requireFinalProjectAdmin(event, supabase) {
  const user = await serverSupabaseUser(event);

  if (!user?.email) {
    throw createError({
      statusCode: 401,
      statusMessage: "Not authenticated",
    });
  }

  const { data: adminRow, error: adminError } = await supabase
    .from("admin")
    .select("email")
    .eq("email", user.email)
    .maybeSingle();

  if (adminError) {
    throw createError({
      statusCode: 500,
      statusMessage: adminError.message,
    });
  }

  if (!adminRow) {
    throw createError({
      statusCode: 403,
      statusMessage: "Admin access required",
    });
  }

  return user;
}

// Resolves the caller's Examiner record.
//
// Examiner access requires:
//   1. An active Faculty record
//   2. Faculty staff_type = "teaching"
//   3. An active Examiner record
//
// This preserves the existing Examiner workflow while enforcing
// the new Faculty-based capability model.
export async function requireExaminer(event, supabase) {
  const user = await serverSupabaseUser(event);

  if (!user?.email) {
    throw createError({
      statusCode: 401,
      statusMessage: "Not authenticated",
    });
  }

  const email = user.email.toLowerCase();

  const [facultyResult, examinerResult] = await Promise.all([
    supabase
      .from("faculty")
      .select("id, email, name, is_active, staff_type")
      .eq("email", email)
      .eq("is_active", true)
      .maybeSingle(),

    supabase
      .from("examiners")
      .select("id, email, name")
      .eq("email", email)
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  if (facultyResult.error) {
    throw createError({
      statusCode: 500,
      statusMessage: facultyResult.error.message,
    });
  }

  if (examinerResult.error) {
    throw createError({
      statusCode: 500,
      statusMessage: examinerResult.error.message,
    });
  }

  const faculty = facultyResult.data;
  const examiner = examinerResult.data;

  if (!faculty || faculty.staff_type !== "teaching" || !examiner) {
    throw createError({
      statusCode: 403,
      statusMessage: "Examiner access requires teaching Faculty status",
    });
  }

  return {
    user,
    examiner,
  };
}

// Resolves the caller's Examiner record AND verifies they're
// authorized for one specific submission.
//
// The examiner must:
//   - be an active teaching Faculty member
//   - have an active Examiner record
//   - be assigned to the submission
//
// Returns:
//   { user, examiner, submission, assignment }
export async function requireExaminerForSubmission(
  event,
  supabase,
  submissionId,
) {
  const { user, examiner } = await requireExaminer(event, supabase);

  const { data: submission, error: submissionError } = await supabase
    .from("final_project_submissions")
    .select(
      "*, final_project_assignments ( *, students ( id, first_name, last_name, email, program_id, cohort_id ) )",
    )
    .eq("id", submissionId)
    .maybeSingle();

  if (submissionError) {
    throw createError({
      statusCode: 500,
      statusMessage: submissionError.message,
    });
  }

  if (!submission) {
    throw createError({
      statusCode: 404,
      statusMessage: "Assessment not found",
    });
  }

  const assignment = submission.final_project_assignments;

  const { data: link, error: linkError } = await supabase
    .from("final_project_assignment_examiners")
    .select("id")
    .eq("assignment_id", assignment.id)
    .eq("examiner_id", examiner.id)
    .maybeSingle();

  if (linkError) {
    throw createError({
      statusCode: 500,
      statusMessage: linkError.message,
    });
  }

  if (!link) {
    throw createError({
      statusCode: 403,
      statusMessage: "You are not assigned as an examiner for this student",
    });
  }

  // The assessment must be activated by an Admin before an
  // assigned Examiner can access it.
  if (!assignment.assessment_activated && submission.status === "ASSIGNED") {
    throw createError({
      statusCode: 403,
      statusMessage: "This assessment has not been activated by the admin yet",
    });
  }

  return {
    user,
    examiner,
    submission,
    assignment,
  };
}

// Allows either:
//   - an Admin
//   - an active teaching Faculty member with an active Examiner record
//
// For Examiner callers, this helper establishes Examiner identity.
// Assignment-level authorization remains handled separately where
// required by the endpoint/database policies.
export async function requireFinalProjectAdminOrExaminer(event, supabase) {
  const user = await serverSupabaseUser(event);

  if (!user?.email) {
    throw createError({
      statusCode: 401,
      statusMessage: "Not authenticated",
    });
  }

  const email = user.email.toLowerCase();

  const [adminResult, facultyResult, examinerResult] = await Promise.all([
    supabase
      .from("admin")
      .select("email")
      .eq("email", user.email)
      .maybeSingle(),

    supabase
      .from("faculty")
      .select("id, email, name, is_active, staff_type")
      .eq("email", email)
      .eq("is_active", true)
      .maybeSingle(),

    supabase
      .from("examiners")
      .select("id, email, name")
      .eq("email", email)
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  if (adminResult.error) {
    throw createError({
      statusCode: 500,
      statusMessage: adminResult.error.message,
    });
  }

  if (facultyResult.error) {
    throw createError({
      statusCode: 500,
      statusMessage: facultyResult.error.message,
    });
  }

  if (examinerResult.error) {
    throw createError({
      statusCode: 500,
      statusMessage: examinerResult.error.message,
    });
  }

  const isAdminUser = Boolean(adminResult.data);

  const faculty = facultyResult.data;
  const examiner = examinerResult.data;

  const isTeachingFaculty =
    Boolean(faculty) && faculty.staff_type === "teaching";

  const validExaminer = isTeachingFaculty && Boolean(examiner);

  if (!isAdminUser && !validExaminer) {
    throw createError({
      statusCode: 403,
      statusMessage: "Admin or teaching Faculty Examiner access required",
    });
  }

  return {
    user,
    isAdmin: isAdminUser,
    examiner: validExaminer ? examiner : null,
  };
}
