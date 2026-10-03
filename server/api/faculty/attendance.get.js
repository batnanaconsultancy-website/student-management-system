import { createError } from "h3";
import { serverSupabaseClient } from "#supabase/server";
import { requireFaculty } from "~/server/utils/facultyAuth";

export default defineEventHandler(async (event) => {
  const client = await serverSupabaseClient(event);

  await requireFaculty(event, client);

  const { data: students, error } = await client.from("students").select(`
      workshops_attended,
      standup_attended,
      mentoring_attended
    `);

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message,
    });
  }

  const rows = students || [];
  const studentCount = rows.length;

  const workshopTotal = rows.reduce(
    (sum, s) => sum + Number(s.workshops_attended || 0),
    0,
  );

  const standupTotal = rows.reduce(
    (sum, s) => sum + Number(s.standup_attended || 0),
    0,
  );

  const mentoringTotal = rows.reduce(
    (sum, s) => sum + Number(s.mentoring_attended || 0),
    0,
  );

  const overallTotal = workshopTotal + standupTotal + mentoringTotal;

  const average = (value) =>
    studentCount > 0 ? Math.round((value / studentCount) * 100) / 100 : null;

  let overallMax = 0;
  let workshopMax = 0;
  let standupMax = 0;
  let mentoringMax = 0;

  const perStudent = rows.map((s) => {
    const workshop = Number(s.workshops_attended || 0);
    const standup = Number(s.standup_attended || 0);
    const mentoring = Number(s.mentoring_attended || 0);
    const overall = workshop + standup + mentoring;

    overallMax = Math.max(overallMax, overall);
    workshopMax = Math.max(workshopMax, workshop);
    standupMax = Math.max(standupMax, standup);
    mentoringMax = Math.max(mentoringMax, mentoring);

    return {
      workshop,
      standup,
      mentoring,
      overall,
    };
  });

  const pctOfMax = (value, max) => {
    if (!max || max <= 0) return 0;
    return Math.round((value / max) * 10000) / 100;
  };

  let overallPctSum = 0;
  let workshopPctSum = 0;
  let standupPctSum = 0;
  let mentoringPctSum = 0;

  for (const student of perStudent) {
    overallPctSum += pctOfMax(student.overall, overallMax);
    workshopPctSum += pctOfMax(student.workshop, workshopMax);
    standupPctSum += pctOfMax(student.standup, standupMax);
    mentoringPctSum += pctOfMax(student.mentoring, mentoringMax);
  }

  const averagePct = (sum) =>
    studentCount > 0 ? Math.round((sum / studentCount) * 100) / 100 : null;

  return {
    data: {
      student_count: studentCount,

      totals: {
        overall: overallTotal,
        workshop: workshopTotal,
        standup: standupTotal,
        mentoring: mentoringTotal,
      },

      averages: {
        overall: average(overallTotal),
        workshop: average(workshopTotal),
        standup: average(standupTotal),
        mentoring: average(mentoringTotal),
      },

      percentages: {
        overall: averagePct(overallPctSum),
        workshop: averagePct(workshopPctSum),
        standup: averagePct(standupPctSum),
        mentoring: averagePct(mentoringPctSum),
      },

      top_attendee: {
        overall: overallMax,
        workshop: workshopMax,
        standup: standupMax,
        mentoring: mentoringMax,
      },
    },
  };
});
