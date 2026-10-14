import { serverSupabaseClient } from "#supabase/server";
import { requireCanvasMastersAdmin } from "~/server/utils/canvasMastersRoster";
import { getMastersAttendancePreviewSnapshot } from "~/server/utils/mastersAttendancePreviewSnapshot";

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event);
  await requireCanvasMastersAdmin(event, supabase);

  // Compatibility endpoint: return saved data only; do not start a live scan.
  return getMastersAttendancePreviewSnapshot(supabase);
});
