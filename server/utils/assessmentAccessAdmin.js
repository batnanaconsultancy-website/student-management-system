import { createError } from "h3";
import {
  serverSupabaseClient,
  serverSupabaseServiceRole,
} from "#supabase/server";
import { requireFinalProjectAdmin } from "~/server/utils/finalProjectAuth";

export async function requireAssessmentAccessAdmin(event) {
  const userClient = await serverSupabaseClient(event);
  const user = await requireFinalProjectAdmin(event, userClient);
  const service = await serverSupabaseServiceRole(event);

  return { user, service };
}

export function requireAssessmentAccessUuid(value, label) {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: `A valid ${label} is required.`,
    });
  }

  return value;
}

export function throwAssessmentAccessDatabaseError(error, operation) {
  console.error(`${operation}:`, {
    message: error?.message,
    code: error?.code,
  });

  throw createError({
    statusCode: 500,
    statusMessage: `${operation} failed.`,
  });
}
