import { createError } from "h3";
import { serverSupabaseClient, serverSupabaseUser } from "#supabase/server";

export async function requireFaculty(event, supabase = null) {
  const client = supabase || (await serverSupabaseClient(event));

  const user = await serverSupabaseUser(event);

  if (!user?.email) {
    throw createError({
      statusCode: 401,
      statusMessage: "Not authenticated",
    });
  }

  const email = user.email.toLowerCase();

  const { data: faculty, error } = await client
    .from("faculty")
    .select("id, email, name, is_active")
    .eq("email", email)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message,
    });
  }

  if (!faculty) {
    throw createError({
      statusCode: 403,
      statusMessage: "Faculty access required",
    });
  }

  return {
    user,
    faculty,
  };
}
