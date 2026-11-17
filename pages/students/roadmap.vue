<script setup lang="ts">
import { CACHE_KEYS } from "~/composables/useCacheInvalidation";

definePageMeta({
  layout: "custom",
  middleware: ["auth", "student-only"],
});

interface RoadmapProject {
  id: string;
  name: string;
  is_completed: boolean;
}

interface RoadmapSeason {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_completed: boolean;
  completion_date: string | null;
  progress_percentage: string | number | null;
  description: string | null;
  projects: RoadmapProject[];
  completed_project_count: number;
  remaining_project_count: number;
}

interface RoadmapResponse {
  data: RoadmapSeason[];
}

const nuxtApp = useNuxtApp();

const { data: roadmapData, status: roadmapStatus } = useFetch<RoadmapResponse>(
  "/api/student/roadmap",
  {
    key: CACHE_KEYS.STUDENT_ROADMAP,
    getCachedData(key) {
      return (
        (nuxtApp.payload.data[key] as RoadmapResponse | undefined) ||
        (nuxtApp.static.data[key] as RoadmapResponse | undefined)
      );
    },
  },
);

const loading = computed(() => roadmapStatus.value === "pending");

const seasons = computed<RoadmapSeason[]>(() => {
  return roadmapData.value?.data ?? [];
});

const colors: string[] = [
  "bg-blue-500",
  "bg-purple-500",
  "bg-pink-500",
  "bg-indigo-500",
  "bg-green-500",
  "bg-yellow-500",
  "bg-red-500",
  "bg-teal-500",
  "bg-orange-500",
  "bg-cyan-500",
];

const getSeasonColor = (index: number): string => {
  return colors[index % colors.length] ?? "bg-blue-500";
};

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const getProgressValue = (progress: string | number | null): number => {
  if (progress === null || progress === undefined) {
    return 0;
  }

  const value = typeof progress === "number" ? progress : parseFloat(progress);

  return Number.isFinite(value) ? value : 0;
};
</script>

<template>
  <UDashboardPanel id="roadmap">
    <template #header>
      <UDashboardNavbar title="Roadmap">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <!-- Loading State -->
      <div v-if="loading" class="flex justify-center items-center h-64">
        <USkeleton class="h-12 w-12" :ui="{ rounded: 'rounded-full' }" />
      </div>

      <!-- Seasons Grid -->
      <div
        v-else
        class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
      >
        <UCard
          v-for="(season, index) in seasons"
          :key="season.id"
          :ui="{
            header: '!p-1 border-none',
            body: '!px-4 !py-1',
          }"
          class="overflow-hidden hover:shadow-lg transition-shadow duration-300"
        >
          <!-- Header with season color -->
          <template #header>
            <div
              :class="[
                getSeasonColor(index),
                'h-34 w-full rounded-lg flex justify-end items-start',
              ]"
            >
              <UBadge
                v-if="season.is_completed"
                variant="solid"
                color="neutral"
                size="sm"
                label="Completed"
                class="m-2"
              />

              <UBadge
                v-else
                variant="solid"
                color="neutral"
                size="sm"
                label="In Progress"
                class="m-2"
              />
            </div>
          </template>

          <!-- Body -->
          <div class="space-y-4">
            <h3 class="text-highlighted font-bold text-lg">
              {{ season.name }}
            </h3>

            <!-- Dates -->
            <div class="space-y-2 text-sm">
              <div class="flex items-center justify-between">
                <span class="text-muted">Start Date:</span>

                <span class="font-medium text-gray-900 dark:text-gray-100">
                  {{ formatDate(season.start_date) }}
                </span>
              </div>

              <div class="flex items-center justify-between">
                <span class="text-muted">End Date:</span>

                <span class="font-medium text-gray-900 dark:text-gray-100">
                  {{ formatDate(season.end_date) }}
                </span>
              </div>

              <div class="pt-2 space-y-1">
                <div class="flex items-center justify-between">
                  <span class="text-muted">Season Progress:</span>
                  <span class="font-medium">
                    {{ getProgressValue(season.progress_percentage) }}%
                  </span>
                </div>
                <UProgress
                  :model-value="getProgressValue(season.progress_percentage)"
                />
              </div>

              <div
                v-if="season.is_completed && season.completion_date"
                class="flex items-center justify-between pt-1"
              >
                <span class="text-muted">Completed on:</span>
                <span class="font-medium">
                  {{ formatDate(season.completion_date) }}
                </span>
              </div>
            </div>

            <!-- Projects Collapsible -->
            <UCollapsible class="pt-2">
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                class="w-full justify-between group"
              >
                <span class="flex items-center gap-2">
                  <span class="text-muted text-sm font-medium"> Projects </span>

                  <UBadge size="xs" color="neutral" variant="subtle">
                    {{ season.completed_project_count }}/{{ season.projects.length }}
                  </UBadge>
                </span>
                <span class="text-xs text-muted">
                  {{ season.completed_project_count }} completed ·
                  {{ season.remaining_project_count }} remaining
                </span>

                <UIcon
                  name="i-lucide-chevron-down"
                  class="size-4 text-muted transition-transform group-data-[state=open]:rotate-180"
                />
              </UButton>

              <template #content>
                <p
                  v-if="season.projects.length === 0"
                  class="mt-2 text-sm text-muted"
                >
                  No projects are currently assigned to this season.
                </p>

                <ul v-else class="mt-2 space-y-2 pl-2">
                  <li
                    v-for="project in season.projects"
                    :key="project.id"
                    class="flex items-center justify-between gap-3 text-sm"
                  >
                    <span class="flex items-center gap-2 min-w-0">
                      <UIcon
                        v-if="project.is_completed"
                        name="i-lucide-circle-check"
                        class="text-green-500 shrink-0 size-4"
                      />
                      <UIcon
                        v-else
                        name="i-lucide-circle"
                        class="text-muted shrink-0 size-4"
                      />
                      <span
                        :class="
                          project.is_completed
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-gray-700 dark:text-gray-300'
                        "
                      >
                        {{ project.name }}
                      </span>
                    </span>

                    <UBadge
                      :color="project.is_completed ? 'success' : 'warning'"
                      variant="subtle"
                      size="xs"
                    >
                      {{ project.is_completed ? "Completed" : "Remaining" }}
                    </UBadge>
                  </li>
                </ul>
              </template>
            </UCollapsible>

            <!-- Description -->
            <p v-if="season.description" class="text-sm text-muted pt-2">
              {{ season.description }}
            </p>
          </div>
        </UCard>
      </div>

      <!-- Empty State -->
      <div v-if="!loading && seasons.length === 0" class="text-center py-12">
        <p class="text-gray-500 dark:text-gray-400">
          No seasons found for your program.
        </p>
      </div>
    </template>
  </UDashboardPanel>
</template>
