import { createError } from "h3";
import { isSeasonCompleted } from "~/server/utils/seasonCompletion";
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

    const { data: studentData, error: studentError } = await service
      .from("students")
      .select("cohort_id, program_id")
      .eq("id", studentId)
      .single();

    if (studentError || !studentData) {
      console.error("Error fetching student data:", studentError);
      throw createError({
        statusCode: 404,
        statusMessage: studentError?.message || "Student not found",
      });
    }

    const { data: allSeasons, error: seasonsError } = await service
      .from("seasons")
      .select("id, name, order_in_program")
      .eq("program_id", studentData.program_id)
      .order("order_in_program", { ascending: true });

    if (seasonsError) {
      console.error("Error fetching all seasons:", seasonsError);
      throw createError({
        statusCode: 500,
        statusMessage: seasonsError.message || "Failed to fetch seasons",
      });
    }

    const { data: progressData, error: progressError } = await service
      .from("student_season_progress")
      .select("*")
      .eq("student_id", studentId);

    if (progressError) {
      console.error("Error fetching season progress:", progressError);
      throw createError({
        statusCode: 500,
        statusMessage: progressError.message || "Failed to fetch season progress",
      });
    }

    const { data: cohortSeasonsData, error: cohortSeasonsError } = await service
      .from("program_cohort_seasons")
      .select("season_id, start_date, end_date")
      .eq("cohort_id", studentData.cohort_id)
      .eq("program_id", studentData.program_id);

    if (cohortSeasonsError) {
      console.error("Error fetching cohort seasons:", cohortSeasonsError);
    }

    const mergedData = allSeasons?.map((season) => {
      const progress = progressData?.find((item) => item.season_id === season.id);
      const cohortSeason = cohortSeasonsData?.find(
        (item) => item.season_id === season.id,
      );

      return {
        id: progress?.id || `placeholder-${season.id}`,
        student_id: studentId,
        season_id: season.id,
        progress_percentage: progress?.progress_percentage || 0,
        is_completed: isSeasonCompleted(
          progress?.progress_percentage,
          progress?.is_completed,
        ),
        completion_date: progress?.completion_date || null,
        created_at: progress?.created_at || null,
        updated_at: progress?.updated_at || null,
        seasons: season,
        program_cohort_seasons: cohortSeason || null,
      };
    });

    return { data: mergedData || [] };
  } catch (err) {
    console.error("Season progress handler error:", err);

    if (err.statusCode) throw err;

    throw createError({
      statusCode: 500,
      statusMessage: err?.message || "Internal server error",
    });
  }
});
