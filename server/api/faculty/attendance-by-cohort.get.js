import { createError } from "h3";
import { serverSupabaseClient } from "#supabase/server";
import { requireFaculty } from "~/server/utils/facultyAuth";

export default defineEventHandler(async (event) => {
  const client = await serverSupabaseClient(event);

  await requireFaculty(event, client);

  const { data: cohorts, error } = await client.rpc(
    "get_accessible_attendance_by_cohort",
  );

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message,
    });
  }

  const average = (value, count) =>
    count > 0 ? Math.round((value / count) * 100) / 100 : 0;

  const pctOfMax = (value, max) => {
    if (!max || max <= 0) return 0;

    return Math.round((value / max) * 10000) / 100;
  };

  const data = (cohorts || [])
    .map((cohort) => {
      const studentsCount = Number(cohort.students_count || 0);

      const overallTotal = Number(cohort.overall_total || 0);
      const workshopTotal = Number(cohort.workshop_total || 0);
      const standupTotal = Number(cohort.standup_total || 0);
      const mentoringTotal = Number(cohort.mentoring_total || 0);

      const overallMax = Number(cohort.overall_max || 0);
      const workshopMax = Number(cohort.workshop_max || 0);
      const standupMax = Number(cohort.standup_max || 0);
      const mentoringMax = Number(cohort.mentoring_max || 0);

      return {
        cohort_id: cohort.cohort_id || null,
        cohort_name: cohort.cohort_name || "Unknown Cohort",
        students_count: studentsCount,

        attended: {
          overall: overallTotal,
          workshop: workshopTotal,
          standup: standupTotal,
          mentoring: mentoringTotal,
        },

        averages: {
          overall: average(overallTotal, studentsCount),
          workshop: average(workshopTotal, studentsCount),
          standup: average(standupTotal, studentsCount),
          mentoring: average(mentoringTotal, studentsCount),
        },

        percentages: {
          overall: pctOfMax(
            overallTotal / studentsCount,
            overallMax,
          ),
          workshop: pctOfMax(
            workshopTotal / studentsCount,
            workshopMax,
          ),
          standup: pctOfMax(
            standupTotal / studentsCount,
            standupMax,
          ),
          mentoring: pctOfMax(
            mentoringTotal / studentsCount,
            mentoringMax,
          ),
        },

        top_attendee: {
          overall: overallMax,
          workshop: workshopMax,
          standup: standupMax,
          mentoring: mentoringMax,
        },
      };
    })
    .sort((a, b) => a.cohort_name.localeCompare(b.cohort_name));

  return { data };
});
