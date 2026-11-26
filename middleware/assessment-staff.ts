import { defineNuxtRouteMiddleware, navigateTo } from "nuxt/app";

export default defineNuxtRouteMiddleware(async () => {
  const { getUser, availableRoles } = useAuth();
  const user = await getUser();

  if (!user) {
    return navigateTo("/");
  }

  // Admin membership is already established by the shared auth composable.
  if (availableRoles.value.includes("admin")) {
    return;
  }

  // The server checks active Faculty membership and the active
  // Assessment Manager appointment. Do not infer this capability
  // from a client-side role or staff_type field.
  try {
    await $fetch("/api/assessment-management/access");
    return;
  } catch (error) {
    const statusCode =
      error?.statusCode ||
      error?.status ||
      error?.response?.status;

    if (statusCode !== 401 && statusCode !== 403) {
      throw error;
    }
  }

  if (availableRoles.value.includes("faculty")) {
    return navigateTo("/faculty/dashboard");
  }

  if (availableRoles.value.includes("examiner")) {
    return navigateTo("/examiner/dashboard");
  }

  if (availableRoles.value.includes("user")) {
    return navigateTo("/students/dashboard");
  }

  return navigateTo("/");
});
