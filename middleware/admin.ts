import { defineNuxtRouteMiddleware, navigateTo } from "nuxt/app";

export default defineNuxtRouteMiddleware(async () => {
  const { role, getUser } = useAuth();

  // Ensure we have the latest user data and role.
  await getUser();

  if (role.value === "admin") {
    return;
  }

  if (role.value === "faculty") {
    return navigateTo("/faculty/dashboard");
  }

  if (role.value === "examiner") {
    return navigateTo("/examiner/dashboard");
  }

  if (role.value === "user") {
    return navigateTo("/students/dashboard");
  }

  return navigateTo("/");
});
