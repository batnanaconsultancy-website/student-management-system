<script setup>
definePageMeta({
  layout: "custom",
  middleware: ["auth", "student-only"],
});

// The external AI Mentor (Anam AI) experience.
// Swap this for an env var (e.g. runtimeConfig.public.aiMentorUrl) if you'd
// rather not hardcode it.
const AI_MENTOR_URL = "https://render-version.onrender.com/";

const iframeLoaded = ref(false);
const iframeFailed = ref(false);
const loadTimeout = ref(null);

function handleIframeLoad() {
  iframeLoaded.value = true;
  if (loadTimeout.value) clearTimeout(loadTimeout.value);
}

function handleIframeError() {
  iframeFailed.value = true;
  if (loadTimeout.value) clearTimeout(loadTimeout.value);
}

function openInNewTab() {
  window.open(AI_MENTOR_URL, "_blank", "noopener,noreferrer");
}

onMounted(() => {
  // Some sites that block iframing (X-Frame-Options / CSP frame-ancestors)
  // never fire `load` or `error` on the iframe — the browser just shows a
  // blank/refused frame. A short timeout lets us offer the fallback link
  // even when no error event arrives.
  loadTimeout.value = setTimeout(() => {
    if (!iframeLoaded.value) {
      iframeFailed.value = true;
    }
  }, 8000);
});

onBeforeUnmount(() => {
  if (loadTimeout.value) clearTimeout(loadTimeout.value);
});
</script>

<template>
  <UDashboardPanel id="ai-mentor">
    <template #header>
      <UDashboardNavbar title="AI Mentor">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="relative h-full w-full">
        <!-- Loading state -->
        <div
          v-if="!iframeLoaded && !iframeFailed"
          class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-default"
        >
          <UIcon
            name="i-lucide-bot"
            class="size-10 animate-pulse text-primary"
          />
          <p class="text-sm text-muted">Connecting to your AI Mentor…</p>
        </div>

        <!-- Fallback if the site refuses to load inside the iframe -->
        <div
          v-else-if="iframeFailed"
          class="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center"
        >
          <UIcon name="i-lucide-bot" class="size-12 text-muted" />
          <div>
            <p class="text-base font-medium text-highlighted">
              AI Mentor couldn't load here
            </p>
            <p class="mt-1 text-sm text-muted">
              It looks like the AI Mentor can't be embedded directly. You can
              open it in a new tab instead — your camera and microphone will
              work normally there.
            </p>
          </div>
          <UButton icon="i-lucide-external-link" @click="openInNewTab">
            Open AI Mentor
          </UButton>
        </div>

        <!-- Embedded AI Mentor -->
        <iframe
          v-show="!iframeFailed"
          :src="AI_MENTOR_URL"
          class="h-full w-full border-0"
          allow="camera; microphone; autoplay; clipboard-write"
          referrerpolicy="no-referrer-when-downgrade"
          title="AI Mentor"
          @load="handleIframeLoad"
          @error="handleIframeError"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
