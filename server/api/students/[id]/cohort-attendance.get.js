import { createError, getQuery } from "h3";
import {
  requireAssessmentAccessAdmin,
  requireAssessmentAccessUuid,
} from "~/server/utils/assessmentAccessAdmin";
import {
  calculateStudentPoints,
  getCurrentPeriodStart,
  getPeriodBounds,
} from "~/server/utils/bachelorAssessmentPoints";

const BACHELOR_PROGRAM_IDS = [
  "bd715dd5-dc5a-414a-98f9-660274fd60e0",
  "c266131f-8e5e-4f39-9711-54523d65ea24",
  "07bc935a-c743-4cab-b10c-a1d231eaf3e2",
];

function throwQueryError(error, operation) {
  console.error(`${operation} failed:`, error);

  throw createError({
    statusCode: 500,
    statusMessage: `Unable to load ${operation.toLowerCase()}.`,
  });
}

function mapRpcError(error, operation) {
  const statusCode =
    error.code === "P0002" ? 404 :
    error.code === "42501" ? 403 : 500;

  throw createError({
    statusCode,
    statusMessage:
      statusCode === 404
        ? "Student record not found."
        : statusCode === 403
          ? "You are not authorised to view this student's attendance."
          : `Unable to load ${operation}.`,
  });
}

export default defineEventHandler(async (event) => {
  try {
    const studentId = getRouterParam(event, "id");

    if (!studentId) {
      throw createError({
        statusCode: 400,
        statusMessage: "Student ID is required.",
      });
    }

    // Authorise the admin before using the service-role client.
    const { service } = await requireAssessmentAccessAdmin(event);
    requireAssessmentAccessUuid(studentId, "student ID");

    const query = getQuery(event);
    const requestedStart = query.periodStart;

    if (
      requestedStart !== undefined &&
      typeof requestedStart !== "string"
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: "periodStart must be a single date value.",
      });
    }

    const currentPeriodStart = getCurrentPeriodStart();
    const period = getPeriodBounds(
      requestedStart || currentPeriodStart,
    );

    // Match the admin reporting-period selector: April 2023 onward,
    // through the current Amsterdam reporting period only.
    if (
      period.startDate < "2023-04-01" ||
      period.startDate > currentPeriodStart
    ) {
      throw createError({
        statusCode: 400,
        statusMessage:
          "The reporting period must be between April 2023 and the current period.",
      });
    }

    // Resolve exactly the student selected on the admin details page.
    const { data: student, error: studentError } = await service
      .from("students")
      .select("id, program_id")
      .eq("id", studentId)
      .maybeSingle();

    if (studentError) {
      throwQueryError(studentError, "Loading student");
    }

    if (!student) {
      throw createError({
        statusCode: 404,
        statusMessage: "Student record not found.",
      });
    }

    const isBachelor = BACHELOR_PROGRAM_IDS.includes(student.program_id);

    // These RPCs return one student's attendance summary and audit.
    // The service-role calls are made only after the admin check above.
    const [attendanceResult, auditResult] = await Promise.all([
      service.rpc("get_assessment_student_attendance_v2", {
        p_student_id: studentId,
      }),
      service.rpc("get_assessment_student_attendance_audit", {
        p_student_id: studentId,
      }),
    ]);

    if (attendanceResult.error) {
      mapRpcError(attendanceResult.error, "attendance summary");
    }

    if (auditResult.error) {
      mapRpcError(auditResult.error, "attendance audit");
    }

    const summary = attendanceResult.data?.[0];
    const auditSummary = auditResult.data?.[0];

    if (!summary || !auditSummary) {
      throw createError({
        statusCode: 500,
        statusMessage: "Student attendance data returned no result.",
      });
    }

    let lowStakes = null;

    if (isBachelor) {
      // Only eligible ledger records belonging to this selected student
      // and this reporting period contribute attendance points.
      const { data: attendanceRows, error: attendanceError } = await service
        .from("bachelor_attendance_records")
        .select("points_awarded, session_date")
        .eq("student_id", studentId)
        .eq("program_id", student.program_id)
        .eq("eligibility_status", "eligible")
        .gte("session_date", period.startDate)
        .lt("session_date", period.endExclusive);

      if (attendanceError) {
        throwQueryError(attendanceError, "Loading eligible attendance points");
      }

      const attendancePoints = (attendanceRows || []).reduce(
        (total, row) => total + Number(row.points_awarded || 0),
        0,
      );

      // Resolve events in the selected six-month period.
      const { data: forumEvents, error: eventsError } = await service
        .from("bachelor_case_study_forum_events")
        .select("id")
        .gte("event_date", period.startDate)
        .lt("event_date", period.endExclusive);

      if (eventsError) {
        throwQueryError(eventsError, "Loading Case Study Forum events");
      }

      const eventIds = (forumEvents || []).map((row) => row.id);
      let forum = {
        points: 0,
        presenterCount: 0,
        participantCount: 0,
      };

      if (eventIds.length) {
        // Deliberately constrain this query to the selected student.
        // Pending and rejected records are excluded.
        const { data: forumRows, error: forumError } = await service
          .from("bachelor_case_study_forum_records")
          .select("participation_role, points_awarded")
          .eq("student_id", studentId)
          .eq("verification_status", "verified")
          .in("event_id", eventIds);

        if (forumError) {
          throwQueryError(forumError, "Loading verified Case Study Forum points");
        }

        forum = (forumRows || []).reduce(
          (totals, row) => {
            totals.points += Number(row.points_awarded || 0);

            if (row.participation_role === "presenter") {
              totals.presenterCount += 1;
            } else if (row.participation_role === "participant") {
              totals.participantCount += 1;
            }

            return totals;
          },
          forum,
        );
      }

      lowStakes = {
        period,
        ...calculateStudentPoints(attendancePoints, forum),
      };
    }

    const toNumber = (value) => Number(value ?? 0);
    const toNullableNumber = (value) =>
      value == null ? null : Number(value);

    const usesLedger = Boolean(summary.uses_ledger);

    const attendance = {
      uses_ledger: usesLedger,
      cohort_size: toNumber(summary.cohort_size),

      workshops: {
        count: toNumber(summary.workshops),
        max: toNumber(summary.workshops_max),
        percent: toNumber(summary.workshops_percent),
      },
      mentoring: {
        count: toNumber(summary.mentoring),
        max: toNumber(summary.mentoring_max),
        percent: toNumber(summary.mentoring_percent),
      },
      standups: {
        count: toNumber(summary.standups),
        max: toNumber(summary.standups_max),
        percent: toNumber(summary.standups_percent),
      },
      squad_meetings: {
        count: toNumber(summary.squad_meetings),
        max: toNumber(summary.squad_meetings_max),
        percent: toNumber(summary.squad_meetings_percent),
      },
      overall: {
        count: toNumber(summary.overall),
        max: toNumber(summary.overall_max),
        percent: toNumber(summary.overall_percent),
      },

      // This is the authoritative all-time eligible attendance ledger total.
      actual_points: toNullableNumber(summary.actual_points),

      reporting_date: summary.reporting_date || null,
      calendar_coverage_status: summary.calendar_coverage_status || null,

      // Scheduled attendance is independent of cohort-relative percentages
      // and the six-month 140-point target.
      scheduled: {
        workshops: {
          attended: toNullableNumber(summary.scheduled_workshops_attended),
          total: toNullableNumber(summary.scheduled_workshops_total),
          percent: toNullableNumber(summary.scheduled_workshops_percent),
        },
        mentoring: {
          attended: toNullableNumber(summary.scheduled_mentoring_attended),
          total: toNullableNumber(summary.scheduled_mentoring_total),
          percent: toNullableNumber(summary.scheduled_mentoring_percent),
        },
        standups: {
          attended: toNullableNumber(summary.scheduled_standups_attended),
          total: toNullableNumber(summary.scheduled_standups_total),
          percent: toNullableNumber(summary.scheduled_standups_percent),
        },
        squad_meetings: {
          attended: toNullableNumber(summary.scheduled_squad_meetings_attended),
          total: toNullableNumber(summary.scheduled_squad_meetings_total),
          percent: toNullableNumber(summary.scheduled_squad_meetings_percent),
        },
      },
    };

    return {
      student_id: studentId,
      program_id: student.program_id,
      period,
      low_stakes: lowStakes,
      attendance,
      audit: {
        uses_ledger: Boolean(auditSummary.uses_ledger),
        unverified_total: Number(auditSummary.unverified_total || 0),
        unverified_by_reason: Array.isArray(auditSummary.unverified_by_reason)
          ? auditSummary.unverified_by_reason
          : [],
      },
    };
  } catch (error) {
    if (error.statusCode) throw error;

    console.error("Individual student attendance handler error:", error);

    throw createError({
      statusCode: 500,
      statusMessage: error?.message || "Internal server error.",
    });
  }
});
