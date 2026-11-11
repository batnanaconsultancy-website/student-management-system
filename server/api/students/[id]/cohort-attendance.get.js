import { createError } from "h3";
import {
  requireAssessmentAccessAdmin,
  requireAssessmentAccessUuid,
} from "~/server/utils/assessmentAccessAdmin";
import { computeCohortAttendance } from "~/server/utils/cohortAttendance";

export default defineEventHandler(async (event) => {
  try {
    const studentId = getRouterParam(event, "id");

    if (!studentId) {
      throw createError({
        statusCode: 400,
        statusMessage: "Student ID is required",
      });
    }

    const { service } = await requireAssessmentAccessAdmin(event);
    requireAssessmentAccessUuid(studentId, "student ID");

    const { data: student, error } = await service
      .from("students")
      .select("id, cohort_id, workshops_attended, standup_attended, mentoring_attended")
      .eq("id", studentId)
      .single();

    if (error) {
      throw createError({
        statusCode: 404,
        statusMessage: error.message || "Student not found",
      });
    }

    const data = await computeCohortAttendance(service, student);
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
