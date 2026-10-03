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

    console.log("Checking capabilities for user:", email);

    /*
     * Capability model:
     *
     * Faculty = active Faculty record.
     *
     * Admin = active/registered Admin record.
     *
     * Examiner = active Faculty member whose staff_type is
     * "teaching" AND who has an active Examiner record.
     *
     * Admin, Faculty and Examiner are therefore capabilities
     * that can coexist for the same user.
     */
    const [adminResult, facultyResult, examinerResult] = await Promise.all([
      client
        .from("admin")
        .select("email")
        .eq("email", user.email)
        .maybeSingle(),

      client
        .from("faculty")
        .select("id, name, email, is_active, staff_type")
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

    const facultyRecord =
      facultyResult.data && !facultyResult.error ? facultyResult.data : null;

    const examinerRecord =
      examinerResult.data && !examinerResult.error ? examinerResult.data : null;

    const isFacultyUser = Boolean(facultyRecord);

    /*
     * Examiner capability requires:
     *
     *   1. Active Faculty membership
     *   2. Teaching staff type
     *   3. Active Examiner record
     */
    const isTeachingFaculty = facultyRecord?.staff_type === "teaching";

    const isExaminerUser =
      Boolean(examinerRecord) && Boolean(facultyRecord) && isTeachingFaculty;

    /*
     * Determine the initial dashboard.
     *
     * Admin remains the default when available, preserving the
     * current behavior for existing Admin users such as Henry.
     */
    let role = "user";

    if (isAdminUser) {
      role = "admin";
    } else if (isFacultyUser) {
      role = "faculty";
    } else if (isExaminerUser) {
      role = "examiner";
    }

    console.log("Capabilities determined:", {
      role,
      isAdmin: isAdminUser,
      isFaculty: isFacultyUser,
      staffType: facultyRecord?.staff_type || null,
      isExaminer: isExaminerUser,
    });

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

      // Capabilities.
      isAdmin: isAdminUser,
      isFaculty: isFacultyUser,
      isExaminer: isExaminerUser,

      facultyProfile: isFacultyUser
        ? {
            id: facultyRecord.id,
            name: facultyRecord.name,
            email: facultyRecord.email,
            is_active: facultyRecord.is_active,
            staff_type: facultyRecord.staff_type,
          }
        : null,

      examinerProfile: isExaminerUser
        ? {
            id: examinerRecord.id,
            name: examinerRecord.name,
          }
        : null,
    };
  } catch (err) {
    console.error("Role/capability check error:", err);

    if (err.statusCode) {
      throw err;
    }

    return {
      success: false,
      error: err?.message || "Internal server error",
    };
  }
});
