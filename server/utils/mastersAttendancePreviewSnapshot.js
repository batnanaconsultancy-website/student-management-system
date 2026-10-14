import { createError } from "h3";

export async function getMastersAttendancePreviewSnapshot(supabase) {
  const { data, error } = await supabase
    .from("canvas_masters_attendance_preview")
    .select(
      "preview,last_successful_scan_at,last_attempt_at,last_attempt_status,last_error"
    )
    .eq("snapshot_key", "latest")
    .maybeSingle();

  if (error) {
    console.error("Failed to load Masters Attendance Preview:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Could not load the saved attendance preview.",
    });
  }

  const storedStatus = data?.last_attempt_status ?? "never_run";
  const status = storedStatus === "never_run" ? "idle" : storedStatus;
  const attemptAt = data?.last_attempt_at ?? null;

  return {
    status,
    startedAt: status === "running" ? attemptAt : null,
    finishedAt: status !== "running" && status !== "idle" ? attemptAt : null,
    errorMessage: data?.last_error ?? null,
    cachedAt: data?.last_successful_scan_at ?? null,
    preview: data?.preview ?? null,
  };
}
