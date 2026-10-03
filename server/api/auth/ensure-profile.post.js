import { createError } from "h3";
import { serverSupabaseClient, serverSupabaseUser } from "#supabase/server";
import { shareCalendarWithEmail } from "~/server/utils/googleCalendar";

export default defineEventHandler(async (event) => {
  try {
    const client = await serverSupabaseClient(event);
    const user = await serverSupabaseUser(event);

    if (!user) {
      throw createError({
        statusCode: 401,
        statusMessage: "Not authenticated",
      });
    }

    const email = (user.email || "").toLowerCase();

    console.log("Checking role for user:", email);

    // These are independent capabilities.
    //
    // A person may be:
    // - admin
    // - faculty
    // - examiner
    // - admin + examiner
    // - faculty + examiner
    // - admin + faculty + examiner
    const [adminResult, facultyResult, examinerResult] = await Promise.all([
      client
        .from("admin")
        .select("email")
        .eq("email", user.email)
        .maybeSingle(),

      client
        .from("faculty")
        .select("id, name, email, is_active")
        .eq("email", email)
        .eq("is_active", true)
        .maybeSingle(),

      client
        .from("examiners")
        .select("id, name")
        .eq("email", email)
        .eq("is_active", true)
        .maybeSingle(),
    ]);

    const isAdminUser = Boolean(adminResult.data && !adminResult.error);

    const isFacultyUser = Boolean(facultyResult.data && !facultyResult.error);

    const isExaminerUser = Boolean(
      examinerResult.data && !examinerResult.error,
    );

    // Primary role.
    //
    // Admin takes priority.
    // Faculty is the normal staff role.
    // Examiner-only accounts are temporarily supported so that
    // existing examiner accounts continue working while we migrate
    // them into Faculty.
    let role = "user";

    if (isAdminUser) {
      role = "admin";
    } else if (isFacultyUser) {
      role = "faculty";
    } else if (isExaminerUser) {
      role = "examiner";
    }

    console.log(
      "Role determined:",
      role,
      "isFaculty:",
      isFacultyUser,
      "isExaminer:",
      isExaminerUser,
    );

    // Keep the existing calendar behavior.
    shareCalendarWithEmail(user.email).catch((err) => {
      console.error(
        "Calendar share failed for",
        user.email,
        err?.message || err,
      );
    });

    return {
      success: true,
      role,

      // Independent capabilities.
      isFaculty: isFacultyUser,
      isExaminer: isExaminerUser,

      facultyProfile: isFacultyUser
        ? {
            id: facultyResult.data.id,
            name: facultyResult.data.name,
            email: facultyResult.data.email,
            is_active: facultyResult.data.is_active,
          }
        : null,

      examinerProfile: isExaminerUser
        ? {
            id: examinerResult.data.id,
            name: examinerResult.data.name,
          }
        : null,
    };
  } catch (err) {
    console.error("Role check error:", err);

    if (err.statusCode) {
      throw err;
    }

    return {
      success: false,
      error: err?.message || "Internal server error",
    };
  }
});
