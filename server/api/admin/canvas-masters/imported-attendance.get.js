import { createError } from "h3";
import { serverSupabaseClient } from "#supabase/server";
import { requireCanvasMastersAdmin } from "~/server/utils/canvasMastersRoster";

const RECORD_LIMIT = 5000;

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event);

  // Authorize before reading any attendance data.
  await requireCanvasMastersAdmin(event, supabase);

  const [summaryResult, recordsResult, recordCountResult] = await Promise.all([
    supabase
      .from("canvas_masters_meet_attendance_summary")
      .select(
        "email, first_name, last_name, meetings_attended, total_duration_minutes, synced_at",
      )
      .order("meetings_attended", { ascending: false })
      .order("email", { ascending: true }),

    supabase
      .from("canvas_masters_attendance_records")
      .select(
        "meeting_id, meeting_at, email, first_name, last_name, duration_minutes, synced_at",
      )
      .order("meeting_at", { ascending: false })
      .order("email", { ascending: true })
      .limit(RECORD_LIMIT),

    supabase
      .from("canvas_masters_attendance_records")
      .select("meeting_id", { count: "exact", head: true }),
  ]);

  if (summaryResult.error || recordsResult.error || recordCountResult.error) {
    console.error("[Imported Masters Attendance] Database read failed:", {
      summaryError: summaryResult.error?.message || null,
      recordsError: recordsResult.error?.message || null,
      recordCountError: recordCountResult.error?.message || null,
    });

    throw createError({
      statusCode: 500,
      statusMessage:
        "Could not load imported Google Meet attendance. Check the migration and database permissions.",
    });
  }

  const summary = summaryResult.data || [];
  const records = recordsResult.data || [];
  const meetingIds = new Set(records.map((record) => record.meeting_id));

  return {
    readOnly: true,
    recordLimit: RECORD_LIMIT,
    recordLimitReached: records.length === RECORD_LIMIT,
    summary: {
      students: summary.length,
      attendanceRecords: recordCountResult.count ?? records.length,
      meetings: meetingIds.size,
      totalMeetingsAttended: summary.reduce(
        (total, student) => total + Number(student.meetings_attended || 0),
        0,
      ),
      totalDurationMinutes: summary.reduce(
        (total, student) => total + Number(student.total_duration_minutes || 0),
        0,
      ),
    },
    students: summary,
    records,
  };
});
