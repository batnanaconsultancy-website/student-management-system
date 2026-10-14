import { serverSupabaseClient } from "#supabase/server";
import { requireCanvasMastersAdmin } from "~/server/utils/canvasMastersRoster";
import { getMastersAttendancePreviewSnapshot } from "~/server/utils/mastersAttendancePreviewSnapshot";

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event);
  await requireCanvasMastersAdmin(event, supabase);

  // Read the latest saved snapshot only. Never contact Google APIs here.
  return getMastersAttendancePreviewSnapshot(supabase);
});
