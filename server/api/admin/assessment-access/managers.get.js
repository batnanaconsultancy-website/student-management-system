import {
  requireAssessmentAccessAdmin,
  throwAssessmentAccessDatabaseError,
} from "~/server/utils/assessmentAccessAdmin";

export default defineEventHandler(async (event) => {
  const { service } = await requireAssessmentAccessAdmin(event);

  const [managerResult, facultyResult] = await Promise.all([
    service
      .from("assessment_managers")
      .select(`
        id,
        faculty_id,
        appointed_by_email,
        appointed_at,
        is_active,
        revoked_by_email,
        revoked_at,
        notes
      `)
      .order("appointed_at", { ascending: false })
      .limit(500),

    service
      .from("faculty")
      .select("id, name, email, staff_type, is_active")
      .order("name", { ascending: true }),
  ]);

  if (managerResult.error) {
    throwAssessmentAccessDatabaseError(
      managerResult.error,
      "Loading Assessment Manager appointments",
    );
  }

  if (facultyResult.error) {
    throwAssessmentAccessDatabaseError(facultyResult.error, "Loading faculty");
  }

  const facultyById = new Map(
    (facultyResult.data || []).map((row) => [row.id, row]),
  );

  return {
    data: (managerResult.data || []).map((row) => ({
      ...row,
      faculty: facultyById.get(row.faculty_id) || null,
    })),
    faculty: facultyResult.data || [],
  };
});
