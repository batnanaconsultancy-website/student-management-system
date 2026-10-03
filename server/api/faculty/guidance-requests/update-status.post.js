import { createError, readBody } from "h3";
import { serverSupabaseClient } from "#supabase/server";
import { requireFaculty } from "~/server/utils/facultyAuth";

const VALID_STATUSES = ["New", "In Progress", "Resolved"];

export default defineEventHandler(async (event) => {
  const client = await serverSupabaseClient(event);

  await requireFaculty(event, client);

  const body = await readBody(event);
  const { id, status } = body || {};

  if (!id || !status || !VALID_STATUSES.includes(status)) {
    throw createError({
      statusCode: 400,
      statusMessage: `id and a valid status (${VALID_STATUSES.join(", ")}) are required`,
    });
  }

  const { data, error } = await client
    .from("guidance_requests")
    .update({ status })
    .eq("id", id)
    .select("id, status")
    .single();

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message,
    });
  }

  return {
    success: true,
    data,
  };
});
