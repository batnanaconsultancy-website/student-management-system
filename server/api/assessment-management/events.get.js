import { createError } from "h3";
import { requireBachelorAssessmentManagementAccess } from "~/server/utils/bachelorAssessmentManagementAuth";

const PAGE_SIZE = 1000;
const ID_BATCH_SIZE = 200;

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

function chunkValues(values, size = ID_BATCH_SIZE) {
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

export default defineEventHandler(async (event) => {
  const access = await requireBachelorAssessmentManagementAccess(event);

  const events = await fetchAllPages(
    () =>
      access.service
        .from("bachelor_case_study_forum_events")
        .select(`
          id,
          event_title,
          event_date,
          event_reference,
          description,
          created_by_email,
          created_at,
          updated_at
        `)
        .order("event_date", { ascending: false })
        .order("event_title", { ascending: true }),
    "Loading Case Study Forum events",
  );

  const canManageEvents = access.isAdmin || access.isAssessmentManager;

  const permissions = {
    canCreateEvents: canManageEvents,
    canReviewRecords: canManageEvents,
    canDeleteEvents: canManageEvents,
    canSubmitRecords: true,
  };

  if (!events.length) {
    return { data: [], record_count: 0, permissions };
  }

  const eventIds = events.map((item) => item.id);
  const records = [];

  // A teaching faculty member with no active assignments must not
  // retrieve any student participation records.
  if (access.canViewAllBachelorStudents || access.studentIds.length > 0) {
    for (const eventIdBatch of chunkValues(eventIds)) {
      const batchRecords = await fetchAllPages(
        () => {
          let query = access.service
            .from("bachelor_case_study_forum_records")
            .select(`
              id,
              event_id,
              student_id,
              participation_role,
              evidence_reference,
              submission_note,
              points_awarded,
              verification_status,
              submitted_by_email,
              submitted_at,
              verified_by_email,
              verified_at,
              rejected_by_email,
              rejected_at,
              review_note,
              created_at,
              updated_at
            `)
            .in("event_id", eventIdBatch)
            .order("submitted_at", { ascending: false });

          if (!access.canViewAllBachelorStudents) {
            query = query.in("student_id", access.studentIds);
          }

          return query;
        },
        "Loading Case Study Forum participation records",
      );

      records.push(...batchRecords);
    }
  }

  // The database query already enforces the faculty assignment boundary.
  const visibleRecords = records;

  const studentIds = [
    ...new Set(visibleRecords.map((record) => record.student_id)),
  ];

  const studentsById = new Map();

  for (const studentIdBatch of chunkValues(studentIds)) {
    const { data, error } = await access.service
      .from("students")
      .select("id, email, first_name, last_name, program_id, cohort_id")
      .in("id", studentIdBatch);

    if (error) {
      console.error("Loading Case Study Forum students failed:", error.message);
      throw createError({
        statusCode: 500,
        statusMessage: "Unable to load participation student details.",
      });
    }

    for (const student of data || []) {
      studentsById.set(student.id, student);
    }
  }

  const recordsByEvent = new Map();

  for (const record of visibleRecords) {
    const student = studentsById.get(record.student_id);

    if (!student) continue;

    const enrichedRecord = {
      ...record,
      student: {
        id: student.id,
        name: [student.first_name, student.last_name]
          .filter(Boolean)
          .join(" ")
          .trim(),
        email: student.email,
        program_id: student.program_id,
        cohort_id: student.cohort_id,
      },
    };

    const current = recordsByEvent.get(record.event_id) || [];
    current.push(enrichedRecord);
    recordsByEvent.set(record.event_id, current);
  }

  return {
    data: events.map((item) => ({
      ...item,
      records: recordsByEvent.get(item.id) || [],
    })),
    record_count: visibleRecords.length,
    permissions,
  };
});
