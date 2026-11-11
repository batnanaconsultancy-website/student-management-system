import { createError } from "h3";
import { serverSupabaseClient } from "#supabase/server";

export default defineEventHandler(async (event) => {
  try {
    const studentId = getRouterParam(event, "id");

    if (!studentId) {
      throw createError({
        statusCode: 400,
        statusMessage: "Student ID is required",
      });
    }

    const client = await serverSupabaseClient(event);

    const { data: rows, error } = await client.rpc(
      "get_assessment_student_attendance",
      { p_student_id: studentId },
    );

    if (error) {
      throw createError({
        statusCode:
          error.code === "P0002" ? 404 : error.code === "42501" ? 403 : 500,
        statusMessage: error.message || "Unable to load attendance summary",
      });
    }

    const summary = rows?.[0];

    if (!summary) {
      throw createError({
        statusCode: 404,
        statusMessage: "Student attendance summary not found",
      });
    }

    const calculatePoints = (percent, maximum) =>
      Number(((Number(percent || 0) / 100) * maximum).toFixed(2));

    const workshopsPoints = calculatePoints(summary.workshops_percent, 3);
    const mentoringPoints = calculatePoints(summary.mentoring_percent, 3);
    const standupsPoints = calculatePoints(summary.standups_percent, 1);

    const data = {
      cohortSize: Number(summary.cohort_size || 0),
      workshops: {
        value: Number(summary.workshops || 0),
        max: Number(summary.workshops_max || 0),
        percent: Number(summary.workshops_percent || 0),
        points: workshopsPoints,
      },
      standups: {
        value: Number(summary.standups || 0),
        max: Number(summary.standups_max || 0),
        percent: Number(summary.standups_percent || 0),
        points: standupsPoints,
      },
      mentoring: {
        value: Number(summary.mentoring || 0),
        max: Number(summary.mentoring_max || 0),
        percent: Number(summary.mentoring_percent || 0),
        points: mentoringPoints,
      },
      total: {
        value: Number(summary.overall || 0),
        max: Number(summary.overall_max || 0),
        percent: Number(summary.overall_percent || 0),
        points: Number(
          (workshopsPoints + mentoringPoints + standupsPoints).toFixed(2),
        ),
      },
    };

    return { data };
  } catch (err) {
    if (err.statusCode) throw err;

    console.error("Cohort attendance handler error:", err);
    throw createError({
      statusCode: 500,
      statusMessage: err?.message || "Internal server error",
    });
  }
});
