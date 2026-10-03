<script setup lang="ts">
definePageMeta({
  layout: "faculty",
  middleware: ["faculty"],
});

const { data, pending, error, refresh } = await useFetch(
  "/api/faculty/attendance",
);

const attendance = computed(() => data.value?.data || null);

const formatNumber = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "0";
  return Number(value).toLocaleString();
};

const formatAverage = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "0";
  return Number(value).toFixed(2);
};

const formatPercent = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "0%";
  return `${Number(value).toFixed(1)}%`;
};
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar>
        <template #left>
          <div>
            <h1 class="text-xl font-semibold">Attendance</h1>
            <p class="text-sm text-muted">
              Aggregate attendance information across the student population.
            </p>
          </div>
        </template>

        <template #right>
          <UButton
            icon="i-lucide-refresh-cw"
            variant="soft"
            :loading="pending"
            @click="refresh()"
          >
            Refresh
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-6">
        <UAlert
          v-if="error"
          title="Unable to load attendance"
          :description="error.message"
          icon="i-lucide-alert-circle"
          color="error"
          variant="soft"
        />

        <template v-if="attendance">
          <!-- Summary -->
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <UCard>
              <div class="flex items-center gap-3">
                <div
                  class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10"
                >
                  <UIcon name="i-lucide-users" class="h-5 w-5 text-primary" />
                </div>

                <div>
                  <p class="text-sm text-muted">Students</p>
                  <p class="text-2xl font-semibold">
                    {{ formatNumber(attendance.student_count) }}
                  </p>
                </div>
              </div>
            </UCard>

            <UCard>
              <div class="flex items-center gap-3">
                <div
                  class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10"
                >
                  <UIcon
                    name="i-lucide-calendar-check"
                    class="h-5 w-5 text-primary"
                  />
                </div>

                <div>
                  <p class="text-sm text-muted">Total Attendance</p>
                  <p class="text-2xl font-semibold">
                    {{ formatNumber(attendance.totals.overall) }}
                  </p>
                </div>
              </div>
            </UCard>

            <UCard>
              <div class="flex items-center gap-3">
                <div
                  class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10"
                >
                  <UIcon
                    name="i-lucide-bar-chart-3"
                    class="h-5 w-5 text-primary"
                  />
                </div>

                <div>
                  <p class="text-sm text-muted">Average / Student</p>
                  <p class="text-2xl font-semibold">
                    {{ formatAverage(attendance.averages.overall) }}
                  </p>
                </div>
              </div>
            </UCard>

            <UCard>
              <div class="flex items-center gap-3">
                <div
                  class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10"
                >
                  <UIcon name="i-lucide-percent" class="h-5 w-5 text-primary" />
                </div>

                <div>
                  <p class="text-sm text-muted">Relative Attendance</p>
                  <p class="text-2xl font-semibold">
                    {{ formatPercent(attendance.percentages.overall) }}
                  </p>
                </div>
              </div>
            </UCard>
          </div>

          <!-- Attendance by activity -->
          <UCard>
            <template #header>
              <div>
                <h2 class="font-semibold">Attendance by Activity</h2>
                <p class="text-sm text-muted">
                  Aggregate attendance across the three tracked activity types.
                </p>
              </div>
            </template>

            <div class="divide-y divide-default">
              <div class="flex items-center justify-between py-4">
                <div class="flex items-center gap-3">
                  <UIcon
                    name="i-lucide-presentation"
                    class="h-5 w-5 text-muted"
                  />

                  <div>
                    <p class="font-medium">Workshops</p>
                    <p class="text-sm text-muted">
                      Average:
                      {{ formatAverage(attendance.averages.workshop) }}
                      per student
                    </p>
                  </div>
                </div>

                <div class="text-right">
                  <p class="font-semibold">
                    {{ formatNumber(attendance.totals.workshop) }}
                  </p>
                  <p class="text-sm text-muted">
                    {{ formatPercent(attendance.percentages.workshop) }}
                  </p>
                </div>
              </div>

              <div class="flex items-center justify-between py-4">
                <div class="flex items-center gap-3">
                  <UIcon name="i-lucide-users" class="h-5 w-5 text-muted" />

                  <div>
                    <p class="font-medium">Stand-ups</p>
                    <p class="text-sm text-muted">
                      Average:
                      {{ formatAverage(attendance.averages.standup) }}
                      per student
                    </p>
                  </div>
                </div>

                <div class="text-right">
                  <p class="font-semibold">
                    {{ formatNumber(attendance.totals.standup) }}
                  </p>
                  <p class="text-sm text-muted">
                    {{ formatPercent(attendance.percentages.standup) }}
                  </p>
                </div>
              </div>

              <div class="flex items-center justify-between py-4">
                <div class="flex items-center gap-3">
                  <UIcon
                    name="i-lucide-message-circle"
                    class="h-5 w-5 text-muted"
                  />

                  <div>
                    <p class="font-medium">Mentoring</p>
                    <p class="text-sm text-muted">
                      Average:
                      {{ formatAverage(attendance.averages.mentoring) }}
                      per student
                    </p>
                  </div>
                </div>

                <div class="text-right">
                  <p class="font-semibold">
                    {{ formatNumber(attendance.totals.mentoring) }}
                  </p>
                  <p class="text-sm text-muted">
                    {{ formatPercent(attendance.percentages.mentoring) }}
                  </p>
                </div>
              </div>
            </div>
          </UCard>

          <!-- Explanation -->
          <UAlert
            title="About the attendance percentage"
            description="The percentage is relative engagement compared with the highest-attending student. It is not the percentage of scheduled sessions attended because the system does not currently maintain a reliable expected-session count."
            icon="i-lucide-info"
            color="primary"
            variant="soft"
          />
        </template>

        <div v-else-if="pending" class="flex items-center justify-center py-12">
          <UIcon name="i-lucide-loader-circle" class="h-6 w-6 animate-spin" />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
