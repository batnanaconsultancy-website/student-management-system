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

    // Check if user email exists in admin table (simplified - just check existence)
    const { data: adminRecord, error: adminError } = await client
      .from("admin")
      .select("email")
      .eq("email", user.email)
      .single();

    // Determine role: if email exists in admin table, they're admin; otherwise student/user
    const role = adminRecord && !adminError ? "admin" : "user";

    console.log("Role determined:", role);

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
