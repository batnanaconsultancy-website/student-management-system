import { defineNuxtRouteMiddleware, navigateTo } from "nuxt/app";

export default defineNuxtRouteMiddleware(async () => {
  const { getUser, role } = useAuth();

  const supabaseUser = useSupabaseUser();

  if (!supabaseUser.value) {
    return navigateTo("/");
  }

  await getUser();

  if (role.value === "faculty") {
    return;
  }

  if (role.value === "admin") {
    return navigateTo("/admin/dashboard");
  }

  if (role.value === "examiner") {
    return navigateTo("/examiner/dashboard");
  }

  if (role.value === "user") {
    return navigateTo("/students/dashboard");
  }

  return navigateTo("/");
});
