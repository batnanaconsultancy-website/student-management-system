import { createError } from "h3";
import {
  requireAssessmentAccessAdmin,
  requireAssessmentAccessUuid,
} from "~/server/utils/assessmentAccessAdmin";

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

    const { data: projectCompletions, error } = await service
      .from("student_project_completion")
      .select(`
        *,
        projects(id, name, description, duration_days)
      `)
      .eq("student_id", studentId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching project completions:", error);
      throw createError({
        statusCode: 500,
        statusMessage: error.message || "Failed to fetch project completions",
      });
    }

    return { data: projectCompletions || [] };
  } catch (err) {
    console.error("Project completions handler error:", err);

    if (err.statusCode) throw err;

    throw createError({
      statusCode: 500,
      statusMessage: err?.message || "Internal server error",
    });
  }
});
