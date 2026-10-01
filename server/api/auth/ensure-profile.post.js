import { createError } from "h3";
import { serverSupabaseClient, serverSupabaseUser } from "#supabase/server";
import { shareCalendarWithEmail } from "~/server/utils/googleCalendar";

export default defineEventHandler(async (event) => {
  try {
    const client = await serverSupabaseClient(event);
    const user = await serverSupabaseUser(event);

    // Check if user is authenticated
    if (!user) {
      throw createError({
        statusCode: 401,
        statusMessage: "Not authenticated",
      });
    }

    console.log("Checking role for user:", user.email);

    // Admin and examiner are checked independently -- someone can be
    // both at once (see useAuth.ts / the Final Project Assessment
    // migration for the full explanation).
    const [adminResult, examinerResult] = await Promise.all([
      client.from("admin").select("email").eq("email", user.email).maybeSingle(),
      client.from("examiners").select("id").eq("email", (user.email || "").toLowerCase()).eq("is_active", true).maybeSingle(),
    ]);

    const isAdminUser = Boolean(adminResult.data && !adminResult.error);
    const isExaminerUser = Boolean(examinerResult.data && !examinerResult.error);

    // Primary role for redirect purposes. A pure examiner (not an
    // admin) gets their own role so they land on the examiner area
    // instead of the student dashboard, which assumes a student record.
    let role = "user";
    if (isAdminUser) role = "admin";
    else if (isExaminerUser) role = "examiner";

    console.log("Role determined:", role, "isExaminer:", isExaminerUser);

    // Fire-and-forget: make sure this person's Google account has access
    // to the shared meetings calendar. Cheap/idempotent (a no-op if they
    // already have access), and never blocks or fails the login/role
    // check if Google isn't reachable or isn't configured yet.
    shareCalendarWithEmail(user.email).catch((err) => {
      console.error("Calendar share failed for", user.email, err?.message || err);
    });

    return {
      success: true,
      role: role,
      // Independent of `role` -- true even when role === 'admin', for
      // an admin who is also an examiner.
      isExaminer: isExaminerUser,
    };
  } catch (err) {
    console.error("Role check error:", err);

    // If it's already a createError, rethrow it
    if (err.statusCode) {
      throw err;
    }

    // Otherwise wrap it
    return {
      success: false,
      error: err?.message || "Internal server error",
    };
  }
});
