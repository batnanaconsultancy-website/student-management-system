import { defineNuxtRouteMiddleware, navigateTo } from "nuxt/app";

// Gates /examiner/* routes.
//
// Examiner is a capability available to teaching Faculty members.
// A user may therefore have multiple dashboards:
//
//   Admin + Faculty + Examiner
//   Admin + Faculty
//   Faculty + Examiner
//   Faculty only
//
// The user must actively select "Examiner" before entering
// /examiner/* routes.

export default defineNuxtRouteMiddleware(async () => {
  const { role, isExaminer, getUser } = useAuth();

  // Refresh the user's capabilities.
  await getUser();

  // Examiner routes require BOTH:
  // 1. An active Examiner capability
  // 2. Examiner selected as the active dashboard
  if (isExaminer.value && role.value === "examiner") {
    return;
  }

  // Otherwise return the user to the dashboard they currently selected.
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
