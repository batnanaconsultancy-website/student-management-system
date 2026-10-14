import { serverSupabaseClient } from "#supabase/server";
import { requireCanvasMastersAdmin } from "~/server/utils/canvasMastersRoster";
import { startMastersAttendancePreviewJob } from "~/server/utils/mastersAttendancePreviewJob";

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event);
  await requireCanvasMastersAdmin(event, supabase);

  // Start the read-only scan and return immediately.
  return startMastersAttendancePreviewJob();
});
