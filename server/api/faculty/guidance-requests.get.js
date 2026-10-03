import { createError } from "h3";
import { serverSupabaseClient } from "#supabase/server";
import { requireFaculty } from "~/server/utils/facultyAuth";

export default defineEventHandler(async (event) => {
  const client = await serverSupabaseClient(event);

  await requireFaculty(event, client);

  const { data, error } = await client
    .from("guidance_requests")
    .select(
      `
      id,
      categories,
      message,
      status,
      created_at
    `,
    )
    .order("created_at", { ascending: false });

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message,
    });
  }

  return {
    data: data || [],
  };
});
