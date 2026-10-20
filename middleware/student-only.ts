import { defineNuxtRouteMiddleware, navigateTo } from "nuxt/app";

export default defineNuxtRouteMiddleware(async () => {
  const { role, getUser } = useAuth();

  await getUser();

  // Ordinary student accounts retain their existing access.
  if (role.value === "user") {
    return;
  }

  // Administrators may use this page only while the server confirms
  // their own active, unexpired Student View session.
  if (role.value === "admin") {
    try {
      const requestFetch = useRequestFetch();
      const status = await requestFetch("/api/admin/student-view/status");

      if (status?.active === true) {
        return;
      }
    } catch {
      // Fail closed if the session cannot be verified.
    }

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
