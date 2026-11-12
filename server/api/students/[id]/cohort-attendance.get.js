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

    const [attendanceResult, auditResult] = await Promise.all([
      client.rpc(
        "get_assessment_student_attendance",
        { p_student_id: studentId },
      ),
      client.rpc(
        "get_assessment_student_attendance_audit",
        { p_student_id: studentId },
      ),
    ]);

    const { data: rows, error } = attendanceResult;

    if (error) {
      throw createError({
        statusCode:
          error.code === "P0002" ? 404 : error.code === "42501" ? 403 : 500,
        statusMessage: error.message || "Unable to load attendance summary",
      });
    }

    if (auditResult.error) {
      throw createError({
        statusCode:
          auditResult.error.code === "P0002"
            ? 404
            : auditResult.error.code === "42501"
              ? 403
              : 500,
        statusMessage:
          auditResult.error.message || "Unable to load attendance audit",
      });
    }

    const summary = rows?.[0];
    const auditSummary = auditResult.data?.[0];

    if (!auditSummary) {
      throw createError({
        statusCode: 500,
        statusMessage: "Student attendance audit returned no data",
      });
    }

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
      audit: {
        uses_ledger: Boolean(auditSummary?.uses_ledger),
        legacy: {
          workshops: auditSummary?.legacy_workshops == null
            ? null
            : Number(auditSummary.legacy_workshops),
          mentoring: auditSummary?.legacy_mentoring == null
            ? null
            : Number(auditSummary.legacy_mentoring),
          standups: auditSummary?.legacy_standups == null
            ? null
            : Number(auditSummary.legacy_standups),
        },
        unverified_total: Number(auditSummary?.unverified_total || 0),
        unverified_by_reason: Array.isArray(auditSummary?.unverified_by_reason)
          ? auditSummary.unverified_by_reason
          : [],
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
