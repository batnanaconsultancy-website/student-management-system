<script setup lang="ts">
// pages/students/guidance.vue
// Lets a student flag one or more issue categories plus a short message.
// Every submission goes to the admin inbox (all admins can see it) and
// triggers a Slack + email notification server-side.
definePageMeta({
  layout: "custom",
  middleware: ["auth", "student-only"],
});

import { GUIDANCE_CATEGORIES, GUIDANCE_REQUEST_WORD_LIMIT } from "~/constants/options";
import { countWords } from "~/utils/wordCount";

const categoryItems = GUIDANCE_CATEGORIES.map((c) => ({ label: c, value: c }));

const selectedCategories = ref<string[]>([]);
const message = ref("");
const submitting = ref(false);
const submitError = ref<string | null>(null);
const submitSuccess = ref(false);

const wordCount = computed(() => countWords(message.value));
const overLimit = computed(() => wordCount.value > GUIDANCE_REQUEST_WORD_LIMIT);
const canSubmit = computed(
  () => selectedCategories.value.length > 0 && !overLimit.value && !submitting.value
);

const { data: historyData, refresh: refreshHistory, status: historyStatus } =
  useFetch("/api/student/guidance-requests");
const history = computed(() => historyData.value?.data || []);

async function submitRequest() {
  if (!canSubmit.value) return;
  submitting.value = true;
  submitError.value = null;
  submitSuccess.value = false;
  try {
    await $fetch("/api/student/guidance-requests", {
      method: "POST",
      body: {
        categories: selectedCategories.value,
        message: message.value.trim(),
      },
    });
    submitSuccess.value = true;
    selectedCategories.value = [];
    message.value = "";
    await refreshHistory();
  } catch (err: any) {
    submitError.value = err?.data?.statusMessage || err?.message || "Failed to submit request";
  } finally {
    submitting.value = false;
  }
}

function statusColor(status: string) {
  if (status === "Resolved") return "success";
  if (status === "In Progress") return "warning";
  return "neutral";
}

function formatDate(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
</script>

<template>
  <UDashboardPanel id="guidance">
    <template #header>
      <UDashboardNavbar title="Guidance & Request">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="max-w-3xl mx-auto w-full space-y-8 pb-10">
        <UCard>
          <template #header>
            <div>
              <h2 class="text-lg font-semibold text-highlighted">Submit a request</h2>
              <p class="text-sm text-muted mt-1">
                Select whatever applies -- you can pick more than one -- and add a short note if you'd like.
                This goes straight to the admin team.
              </p>
            </div>
          </template>

          <div class="space-y-5">
            <div class="space-y-2">
              <label class="text-sm font-medium text-highlighted">What's this about?</label>
              <USelectMenu
                v-model="selectedCategories"
                :items="categoryItems"
                value-key="value"
                multiple
                searchable
                placeholder="Select one or more categories"
                class="w-full"
                :ui="{ content: 'max-h-72 overflow-y-auto' }"
              />
            </div>

            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="text-sm font-medium text-highlighted">Tell us more (optional)</label>
                <span :class="['text-xs', overLimit ? 'text-error' : 'text-muted']">
                  {{ wordCount }} / {{ GUIDANCE_REQUEST_WORD_LIMIT }} words
                </span>
              </div>
              <UTextarea
                v-model="message"
                :rows="4"
                placeholder="Add any details that would help us understand your request..."
                class="w-full"
                :color="overLimit ? 'error' : undefined"
              />
              <p v-if="overLimit" class="text-xs text-error">
                Please keep this to {{ GUIDANCE_REQUEST_WORD_LIMIT }} words or fewer.
              </p>
            </div>

            <!-- Live preview -->
            <div
              v-if="selectedCategories.length > 0 || message.trim()"
              class="rounded-lg border border-default bg-elevated/40 p-4 space-y-2"
            >
              <p class="text-xs font-medium text-muted uppercase tracking-wide">Preview</p>
              <div v-if="selectedCategories.length > 0" class="flex flex-wrap gap-1.5">
                <UBadge
                  v-for="c in selectedCategories"
                  :key="c"
                  variant="subtle"
                  color="primary"
                  size="sm"
                >
                  {{ c }}
                </UBadge>
              </div>
              <p v-if="message.trim()" class="text-sm text-default whitespace-pre-wrap">{{ message }}</p>
            </div>

            <p v-if="submitError" class="text-sm text-error">{{ submitError }}</p>
            <p v-if="submitSuccess" class="text-sm text-success">
              Request submitted -- the admin team has been notified.
            </p>

            <div class="flex justify-end">
              <UButton :loading="submitting" :disabled="!canSubmit" @click="submitRequest">
                Submit request
              </UButton>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <h2 class="text-lg font-semibold text-highlighted">Your past requests</h2>
          </template>

          <div v-if="historyStatus === 'pending'" class="text-sm text-muted py-4 text-center">
            Loading...
          </div>
          <div v-else-if="history.length === 0" class="text-sm text-muted py-4 text-center">
            You haven't submitted any requests yet.
          </div>
          <ul v-else class="divide-y divide-default">
            <li v-for="req in history" :key="req.id" class="py-3 space-y-1.5">
              <div class="flex items-start justify-between gap-3">
                <div class="flex flex-wrap gap-1.5">
                  <UBadge v-for="c in req.categories" :key="c" variant="subtle" size="sm">
                    {{ c }}
                  </UBadge>
                </div>
                <UBadge :color="statusColor(req.status)" variant="subtle" size="sm" class="shrink-0">
                  {{ req.status }}
                </UBadge>
              </div>
              <p v-if="req.message" class="text-sm text-muted whitespace-pre-wrap">{{ req.message }}</p>
              <p class="text-xs text-muted/70">{{ formatDate(req.created_at) }}</p>
            </li>
          </ul>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
