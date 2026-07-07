<script setup lang="ts">
// pages/students/extra-tracks.vue
// Shows the logged-in student their own extra-course tracking records:
// which season, what counted toward their progress, and what their
// extra-track attempt was (kept for the record, not double-counted).
definePageMeta({
  layout: "custom",
  middleware: ["auth", "student-only"],
});

const { data, status } = useFetch("/api/student/duplicate-tracks");

const rows = computed(() => data.value?.data || []);
const loading = computed(() => status.value === "pending");

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
  <UDashboardPanel id="extraTracks">
    <template #header>
      <UDashboardNavbar title="Extra Tracks">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="max-w-3xl mx-auto w-full">
        <p class="text-muted text-[15px] text-pretty mb-4">
          If you're tracking an extra season or course alongside your main
          program, both are shown here. Only the higher-progress one counts
          toward your official status -- the other is kept here for your own
          reference.
        </p>

        <div v-if="loading" class="text-center text-sm text-muted py-8">
          Loading...
        </div>

        <div
          v-else-if="rows.length === 0"
          class="text-center text-sm text-muted py-8"
        >
          <UIcon
            name="i-lucide-layers"
            class="size-6 mx-auto mb-2 text-dimmed"
          />
          You're not tracking any extra courses right now.
        </div>

        <UCard
          v-else
          v-for="row in rows"
          :key="row.id"
          variant="subtle"
          class="mb-3"
        >
          <div class="flex items-center justify-between mb-2">
            <p class="font-medium text-highlighted">{{ row.season_name }}</p>
            <span class="text-xs text-dimmed"
              >Updated {{ formatDate(row.scraped_at) }}</span
            >
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <p class="text-xs text-muted mb-1">
                Counted toward your progress
              </p>
              <p class="text-sm text-highlighted">{{ row.kept_raw_label }}</p>
              <UBadge color="success" variant="subtle" class="mt-1"
                >{{ row.kept_progress_percentage }}%</UBadge
              >
            </div>
            <div>
              <p class="text-xs text-muted mb-1">Extra track (not counted)</p>
              <p class="text-sm text-highlighted">
                {{ row.discarded_raw_label }}
              </p>
              <UBadge color="neutral" variant="subtle" class="mt-1"
                >{{ row.discarded_progress_percentage }}%</UBadge
              >
            </div>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
