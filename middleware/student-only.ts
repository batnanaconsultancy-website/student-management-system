import { defineNuxtRouteMiddleware, navigateTo } from "nuxt/app";

export default defineNuxtRouteMiddleware(async () => {
  const { role, getUser } = useAuth();

  // Ensure we have the latest user data and role.
  await getUser();

  console.log("Student-only middleware - current role:", role.value);

  // Only ordinary student/user accounts may continue.
  if (role.value === "user") {
    return;
  }

  // Redirect staff and legacy examiner accounts to their
  // appropriate primary dashboard.
  if (role.value === "admin") {
    return navigateTo("/admin/dashboard");
  }

  if (role.value === "faculty") {
    return navigateTo("/faculty/dashboard");
  }

  if (role.value === "examiner") {
    return navigateTo("/examiner/dashboard");
  }

  return navigateTo("/");
});
