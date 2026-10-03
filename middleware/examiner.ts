import { defineNuxtRouteMiddleware, navigateTo } from "nuxt/app";

// Gates /examiner/* routes.
//
// Examiner is an independent capability.
// A user can therefore be:
//   admin + examiner
//   faculty + examiner
//   examiner-only (temporary legacy support)
//
// Ordinary Faculty members are NOT examiners and cannot enter
// examiner routes.
export default defineNuxtRouteMiddleware(async () => {
  const { role, isExaminer, getUser } = useAuth();

  // Ensure we have the latest user, faculty and examiner data.
  await getUser();

  if (isExaminer.value) {
    return;
  }

  // Send the user back to the appropriate area.
  if (role.value === "admin") {
    return navigateTo("/admin/dashboard");
  }

  if (role.value === "faculty") {
    return navigateTo("/faculty/dashboard");
  }

  if (role.value === "user") {
    return navigateTo("/students/dashboard");
  }

  return navigateTo("/");
});
