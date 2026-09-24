<script setup lang="ts">
// Page on which authentication will be performed.
definePageMeta({
  layout: false,
  middleware: ["guest"],
});

import { useAuth } from "../composables/useAuth";

const { signInWithGoogle } = useAuth();

const colorMode = useColorMode();
colorMode.preference = "light";
const supabase = useSupabaseClient();
const route = useRoute();
const isErrorVisible = ref(false);

supabase.auth.onAuthStateChange((event, session) => {
  // The refresh token is handed to the server to store as an httpOnly
  // cookie (see server/api/auth/store-google-refresh-token.post.js)
  // instead of localStorage -- localStorage is readable by any script
  // running on the page, which made this long-lived token a target for
  // XSS-based theft. An httpOnly cookie is invisible to JS entirely.
  if (session && session.provider_refresh_token) {
    $fetch("/api/auth/store-google-refresh-token", {
      method: "POST",
      body: { refreshToken: session.provider_refresh_token },
    }).catch((err) => console.error("Failed to store Google refresh token", err));
  }
  if (event === "SIGNED_OUT") {
    $fetch("/api/auth/clear-google-tokens", { method: "POST" }).catch(() => {});
  }

  // After authentication success, redirect to dashboard
  if (event === "SIGNED_IN" && session) {
    console.log("User successfully signed in, redirecting to dashboard...");
    navigateTo("/students/dashboard");
  }
});

const signInWithOAuth = async () => {
  const { data, error } = await signInWithGoogle();

  if (error) {
    console.log("Authentication error:", error);
    navigateTo("/?error=domain");
  } else {
    console.log("OAuth initiated successfully");
    // Note: After OAuth redirect, the user will be automatically set via the auth state change
  }
};

watch(
  () => route,
  () => {
    if (route.query.error === "domain") {
      isErrorVisible.value = true;
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex h-screen flex-col items-center justify-center gap-6">
    <UAlert
      v-if="isErrorVisible"
      color="neutral"
      variant="subtle"
      title="Authentication Error"
      description="Please use your university email address to sign in."
      icon="i-lucide-circle-alert"
      class="absolute top-4 w-[35%]"
      :close="{
        color: 'error',
        variant: 'outline',
        class: 'rounded-full cursor-pointer',
        onClick: () => {
          isErrorVisible = false;
        },
      }"
    />
    <div class="flex flex-col items-center justify-center gap-2">
      <UIcon name="i-lucide-user" class="size-8" />
      <h1 class="text-highlighted text-xl font-semibold text-pretty">Login</h1>
      <p class="text-muted text-base text-pretty">
        Enter your credentials to access your account.
      </p>
    </div>
    <div class="flex w-[35%] items-center justify-center">
      <UButton
        @click="signInWithOAuth"
        class="flex w-full cursor-pointer items-center justify-center"
        icon="i-simple-icons-google"
        color="neutral"
        variant="outline"
        >Google</UButton
      >
    </div>
  </div>
</template>
