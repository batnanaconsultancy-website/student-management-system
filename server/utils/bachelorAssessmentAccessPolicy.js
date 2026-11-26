// Pure authorization policy shared by Bachelor Assessment Management.
//
// An active Assessment Manager appointment grants all-Bachelor access,
// regardless of staff_type, provided the faculty account is active.
// Otherwise, only active teaching faculty qualify for assigned-student access.

export function resolveBachelorAssessmentFacultyAccess(
  faculty,
  managerAppointment,
) {
  if (!faculty || faculty.is_active !== true) {
    return "denied";
  }

  if (managerAppointment) {
    return "assessment_manager";
  }

  if (faculty.staff_type === "teaching") {
    return "teaching_faculty";
  }

  return "denied";
}
