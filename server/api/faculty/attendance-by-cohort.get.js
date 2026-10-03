import { createError } from "h3";
import { serverSupabaseClient } from "#supabase/server";
import { requireFaculty } from "~/server/utils/facultyAuth";

export default defineEventHandler(async (event) => {
  const client = await serverSupabaseClient(event);

  await requireFaculty(event, client);

  const { data: students, error: studentsError } = await client.from("students")
    .select(`
      cohort_id,
      workshops_attended,
      standup_attended,
      mentoring_attended
    `);

  if (studentsError) {
    throw createError({
      statusCode: 500,
      statusMessage: studentsError.message,
    });
  }

  const { data: cohorts, error: cohortsError } = await client
    .from("cohorts")
    .select("id, name");

  if (cohortsError) {
    throw createError({
      statusCode: 500,
      statusMessage: cohortsError.message,
    });
  }

  const cohortNames = new Map(
    (cohorts || []).map((cohort) => [cohort.id, cohort.name]),
  );

  const groups = new Map();

  for (const student of students || []) {
    const cohortId = student.cohort_id || null;
    const cohortName = cohortNames.get(cohortId) || "Unknown Cohort";

    const key = cohortId || "unknown";

    if (!groups.has(key)) {
      groups.set(key, {
        cohort_id: cohortId,
        cohort_name: cohortName,
        students_count: 0,
        workshop_total: 0,
        standup_total: 0,
        mentoring_total: 0,
        overall_total: 0,
        workshop_max: 0,
        standup_max: 0,
        mentoring_max: 0,
        overall_max: 0,
      });
    }

    const group = groups.get(key);

    const workshop = Number(student.workshops_attended || 0);
    const standup = Number(student.standup_attended || 0);
    const mentoring = Number(student.mentoring_attended || 0);
    const overall = workshop + standup + mentoring;

    group.students_count += 1;

    group.workshop_total += workshop;
    group.standup_total += standup;
    group.mentoring_total += mentoring;
    group.overall_total += overall;

    group.workshop_max = Math.max(group.workshop_max, workshop);
    group.standup_max = Math.max(group.standup_max, standup);
    group.mentoring_max = Math.max(group.mentoring_max, mentoring);
    group.overall_max = Math.max(group.overall_max, overall);
  }

  const average = (value, count) =>
    count > 0 ? Math.round((value / count) * 100) / 100 : 0;

  const pctOfMax = (value, max) => {
    if (!max || max <= 0) return 0;

    return Math.round((value / max) * 10000) / 100;
  };

  const data = Array.from(groups.values())
    .map((group) => ({
      cohort_id: group.cohort_id,
      cohort_name: group.cohort_name,
      students_count: group.students_count,

      attended: {
        overall: group.overall_total,
        workshop: group.workshop_total,
        standup: group.standup_total,
        mentoring: group.mentoring_total,
      },

      averages: {
        overall: average(group.overall_total, group.students_count),
        workshop: average(group.workshop_total, group.students_count),
        standup: average(group.standup_total, group.students_count),
        mentoring: average(group.mentoring_total, group.students_count),
      },

      percentages: {
        overall: pctOfMax(
          group.overall_total / group.students_count,
          group.overall_max,
        ),
        workshop: pctOfMax(
          group.workshop_total / group.students_count,
          group.workshop_max,
        ),
        standup: pctOfMax(
          group.standup_total / group.students_count,
          group.standup_max,
        ),
        mentoring: pctOfMax(
          group.mentoring_total / group.students_count,
          group.mentoring_max,
        ),
      },

      top_attendee: {
        overall: group.overall_max,
        workshop: group.workshop_max,
        standup: group.standup_max,
        mentoring: group.mentoring_max,
      },
    }))
    .sort((a, b) => a.cohort_name.localeCompare(b.cohort_name));

  return {
    data,
  };
});
