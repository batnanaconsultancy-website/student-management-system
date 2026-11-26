import { createError, getQuery } from "h3";
import { requireBachelorAssessmentManagementAccess } from "~/server/utils/bachelorAssessmentManagementAuth";
import {
  POINTS_TARGET,
  calculateStudentPoints,
  getCurrentPeriodStart,
  getPeriodBounds,
} from "~/server/utils/bachelorAssessmentPoints";

const BACHELOR_PROGRAM_IDS = [
  "bd715dd5-dc5a-414a-98f9-660274fd60e0",
  "c266131f-8e5e-4f39-9711-54523d65ea24",
  "07bc935a-c743-4cab-b10c-a1d231eaf3e2",
];

const PAGE_SIZE = 1000;
const ID_BATCH_SIZE = 200;
function chunkValues(values, size = ID_BATCH_SIZE) {
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

async function fetchAllPages(buildQuery, operation) {
  const rows = [];
  let offset = 0;

  while (true) {
    const { data, error } = await buildQuery().range(
      offset,
      offset + PAGE_SIZE - 1,
    );

    if (error) {
      console.error(`${operation} failed:`, error.message);
      throw createError({
        statusCode: 500,
        statusMessage: `Unable to load ${operation.toLowerCase()}.`,
      });
    }

    rows.push(...(data || []));

    if (!data || data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

export default defineEventHandler(async (event) => {
  const access = await requireBachelorAssessmentManagementAccess(event);
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

  const period = getPeriodBounds(
    requestedStart || getCurrentPeriodStart(),
  );

  // Restrict teaching faculty student retrieval at the database query.
  // Admins and active Assessment Managers retain access to all Bachelor students.
  const canLoadStudents =
    access.canViewAllBachelorStudents ||
    (access.studentIds || []).length > 0;

  const students = canLoadStudents
    ? await fetchAllPages(
        () => {
          let studentQuery = access.service
            .from("students")
            .select(`
              id,
              email,
              first_name,
              last_name,
              program_id,
              cohort_id,
              programs ( name ),
              cohorts ( name )
            `)
            .in("program_id", BACHELOR_PROGRAM_IDS)
            .order("id", { ascending: true });

          if (!access.canViewAllBachelorStudents) {
            studentQuery = studentQuery.in(
              "id",
              access.studentIds,
            );
          }

          return studentQuery;
        },
        "Loading Bachelor students",
      )
    : [];

  const visibleStudents = students;

  const studentIds = visibleStudents.map((student) => student.id);

  const attendanceByStudent = new Map();
  const forumByStudent = new Map();
  const allTimeAttendanceByStudent = new Map();

  if (studentIds.length) {
    const attendanceRows = [];

    for (const studentIdBatch of chunkValues(studentIds)) {
      const batchRows = await fetchAllPages(
        () =>
          access.service
            .from("bachelor_attendance_records")
            .select("id, student_id, points_awarded, session_date")
            .eq("eligibility_status", "eligible")
            .in("program_id", BACHELOR_PROGRAM_IDS)
            .in("student_id", studentIdBatch)
            .order("id", { ascending: true }),
        "Loading eligible attendance points",
      );

      attendanceRows.push(...batchRows);
    }

    for (const row of attendanceRows) {
      const points = Number(row.points_awarded || 0);

      // All-time eligible attendance points.
      allTimeAttendanceByStudent.set(
        row.student_id,
        (allTimeAttendanceByStudent.get(row.student_id) || 0) + points,
      );

      // Attendance points within the selected semester only.
      if (
        row.session_date >= period.startDate &&
        row.session_date < period.endExclusive
      ) {
        attendanceByStudent.set(
          row.student_id,
          (attendanceByStudent.get(row.student_id) || 0) + points,
        );
      }
    }

    const forumEvents = await fetchAllPages(
      () =>
        access.service
          .from("bachelor_case_study_forum_events")
          .select("id")
          .gte("event_date", period.startDate)
          .lt("event_date", period.endExclusive)
          .order("id", { ascending: true }),
      "Loading Case Study Forum events",
    );

    const eventIds = forumEvents.map((row) => row.id);

    if (eventIds.length) {
      for (const eventIdBatch of chunkValues(eventIds)) {
        for (const studentIdBatch of chunkValues(studentIds)) {
          const forumRows = await fetchAllPages(
            () =>
              access.service
                .from("bachelor_case_study_forum_records")
                .select(
                  "id, student_id, participation_role, points_awarded",
                )
                .eq("verification_status", "verified")
                .in("event_id", eventIdBatch)
                .in("student_id", studentIdBatch)
                .order("id", { ascending: true }),
            "Loading verified Case Study Forum points",
          );

          for (const row of forumRows) {
            const current = forumByStudent.get(row.student_id) || {
              points: 0,
              presenterCount: 0,
              participantCount: 0,
            };

            current.points += Number(row.points_awarded || 0);

            if (row.participation_role === "presenter") {
              current.presenterCount += 1;
            } else if (row.participation_role === "participant") {
              current.participantCount += 1;
            }

            forumByStudent.set(row.student_id, current);
          }
        }
      }
    }
  }

  const data = visibleStudents
    .map((student) => {
      const forum = forumByStudent.get(student.id) || {
        points: 0,
        presenterCount: 0,
        participantCount: 0,
      };

      const points = calculateStudentPoints(
        attendanceByStudent.get(student.id) || 0,
        forum,
      );

      return {
        student_id: student.id,
        name: [student.first_name, student.last_name]
          .filter(Boolean)
          .join(" ")
          .trim(),
        email: student.email,
        program_id: student.program_id,
        program: student.programs?.name || "",
        cohort_id: student.cohort_id,
        cohort: student.cohorts?.name || "",
        all_time_attendance_points:
          allTimeAttendanceByStudent.get(student.id) || 0,
        ...points,
      };
    })
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        (a.email || "").localeCompare(b.email || ""),
    );

  return {
    period,
    target_points: POINTS_TARGET,
    student_count: data.length,
    target_met_count: data.filter((row) => row.target_met).length,
    target_not_met_count: data.filter((row) => !row.target_met).length,
    data,
  };
});
