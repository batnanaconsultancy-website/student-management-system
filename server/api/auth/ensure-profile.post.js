// server/api/auth/ensure-profile.post.ts
import { createError } from "h3";
import { serverSupabaseClient, serverSupabaseUser } from "#supabase/server";

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

    console.log("📧 Checking role for user:", user.email);

    // Check if user email exists in admin table
    const { data: adminRecord, error: adminError } = await client
      .from("admin")
      .select("email")
      .eq("email", user.email)
      .single();

    const role = adminRecord && !adminError ? "admin" : "user";
    console.log("👤 Role determined:", role);

    // If user doesn't have a student profile yet, create one
    if (role === "user") {
      const { data: studentRecord, error: studentError } = await client
        .from("students")
        .select("id")
        .eq("email", user.email)
        .single();

      if (studentError && studentError.code === "PGRST116") {
        // Student doesn't exist, create one
        console.log("📝 Creating student profile for:", user.email);
        const firstName =
          user.user_metadata?.full_name?.split(" ")[0] ||
          user.email.split("@")[0];
        const lastName =
          user.user_metadata?.full_name?.split(" ").slice(1).join(" ") ||
          "Student";

        const { error: insertError } = await client.from("students").insert({
          email: user.email,
          first_name: firstName,
          last_name: lastName,
          username: user.email.split("@")[0],
          account_status: "Active",
          is_active: true,
          role: "student",
        });

        if (insertError) {
          console.error("❌ Error creating student profile:", insertError);
        } else {
          console.log("✅ Student profile created");
        }
      }
    }

    return {
      success: true,
      role: role,
    };
  } catch (err) {
    console.error("❌ Role check error:", err);

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
