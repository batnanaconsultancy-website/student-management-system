import { createError, getQuery } from "h3";
import {
  requireAssessmentAccessAdmin,
  throwAssessmentAccessDatabaseError,
} from "~/server/utils/assessmentAccessAdmin";

export default defineEventHandler(async (event) => {
  const { service } = await requireAssessmentAccessAdmin(event);
  const query = getQuery(event);
  const includeInactive = query.includeInactive === "true";

  let assignmentQuery = service
    .from("faculty_student_assignments")
    .select(`
      id,
      faculty_id,
      student_id,
      assigned_by_email,
      assigned_at,
      is_active,
      deactivated_by_email,
      deactivated_at,
      notes
    `)
    .order("assigned_at", { ascending: false })
    .limit(2000);

  if (!includeInactive) {
    assignmentQuery = assignmentQuery.eq("is_active", true);
  }

  const { data: assignments, error } = await assignmentQuery;

  if (error) {
    throwAssessmentAccessDatabaseError(error, "Loading faculty assignments");
  }

  const facultyIds = [...new Set((assignments || []).map((row) => row.faculty_id))];
  const studentIds = [...new Set((assignments || []).map((row) => row.student_id))];

  const [facultyResult, studentResult] = await Promise.all([
    facultyIds.length
      ? service
          .from("faculty")
          .select("id, name, email, staff_type, is_active")
          .in("id", facultyIds)
      : Promise.resolve({ data: [], error: null }),

    studentIds.length
      ? service
          .from("students")
          .select("id, email, first_name, last_name, program_id, cohort_id")
          .in("id", studentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (facultyResult.error) {
    throwAssessmentAccessDatabaseError(facultyResult.error, "Loading faculty details");
  }

  if (studentResult.error) {
    throwAssessmentAccessDatabaseError(studentResult.error, "Loading student details");
  }

  const facultyById = new Map((facultyResult.data || []).map((row) => [row.id, row]));
  const studentById = new Map((studentResult.data || []).map((row) => [row.id, row]));

  return {
    data: (assignments || []).map((row) => {
      const student = studentById.get(row.student_id);

      return {
        ...row,
        faculty: facultyById.get(row.faculty_id) || null,
        student: student
          ? {
              ...student,
              name: [student.first_name, student.last_name]
                .filter(Boolean)
                .join(" ")
                .trim(),
            }
          : null,
      };
    }),
  };
});
