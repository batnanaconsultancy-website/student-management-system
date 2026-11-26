import { requireBachelorAssessmentManagementAccess } from "~/server/utils/bachelorAssessmentManagementAuth";

export default defineEventHandler(async (event) => {
  const access = await requireBachelorAssessmentManagementAccess(event);

  return {
    authorized: true,
    isAdmin: access.isAdmin,
    isAssessmentManager: access.isAssessmentManager,
    canViewAllBachelorStudents: access.canViewAllBachelorStudents,
    canCreateEvents: access.isAdmin || access.isAssessmentManager,
    canReviewRecords: access.isAdmin || access.isAssessmentManager,
    canSubmitRecords: true,
  };
});
