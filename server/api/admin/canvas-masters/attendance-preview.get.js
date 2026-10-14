import { serverSupabaseClient } from "#supabase/server";
import { requireCanvasMastersAdmin } from "~/server/utils/canvasMastersRoster";
import { getMastersAttendancePreviewJob } from "~/server/utils/mastersAttendancePreviewJob";

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event);
  await requireCanvasMastersAdmin(event, supabase);

  // This endpoint only returns process-local status/results. It never
  // waits for Google APIs.
  return getMastersAttendancePreviewJob();
});
