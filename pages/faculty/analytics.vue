<script setup lang="ts">
interface AttendanceMetrics {
  overall: number | null;
  workshop: number | null;
  standup: number | null;
  mentoring: number | null;
}

interface AttendanceTotals {
  overall: number | null;
  workshop: number | null;
  standup: number | null;
  mentoring: number | null;
}

interface AttendancePercentages {
  overall: number | null;
  workshop?: number | null;
  standup?: number | null;
  mentoring?: number | null;
}

interface AttendanceData {
  student_count: number;
  totals: AttendanceTotals;
  averages: AttendanceMetrics;
  percentages: AttendancePercentages;
}

interface CohortAnalytics {
  cohort_id: string | null;
  cohort_name: string;
  students_count: number;
  averages: AttendanceMetrics;
}

interface FacultyAttendanceResponse {
  data: AttendanceData | null;
}

interface FacultyCohortResponse {
  data: CohortAnalytics[];
}

definePageMeta({
  layout: "faculty" as any,
  middleware: ["faculty"] as any,
});

const {
  data: attendanceData,
  pending: attendancePending,
  error: attendanceError,
  refresh: refreshAttendance,
} = await useFetch<FacultyAttendanceResponse>("/api/faculty/attendance");

const {
  data: cohortData,
  pending: cohortPending,
  error: cohortError,
  refresh: refreshCohorts,
} = await useFetch<FacultyCohortResponse>("/api/faculty/attendance-by-cohort");

const attendance = computed(() => attendanceData.value?.data || null);

const cohorts = computed(() => cohortData.value?.data || []);

const pending = computed(() => attendancePending.value || cohortPending.value);

const error = computed(
  () => attendanceError.value || cohortError.value || null,
);

const refresh = async () => {
  await Promise.all([refreshAttendance(), refreshCohorts()]);
};

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
            <h1 class="text-xl font-semibold">Analytics</h1>
            <p class="text-sm text-muted">
              Aggregate academic activity and attendance analytics.
            </p>
          </div>
        </template>

        <template #right>
          <UButton
            icon="i-lucide-refresh-cw"
            variant="soft"
            :loading="pending"
            @click="refresh"
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
          title="Unable to load analytics"
          :description="error.message"
          icon="i-lucide-alert-circle"
          color="error"
          variant="soft"
        />

        <template v-if="attendance">
          <!-- Overall metrics -->
          <div>
            <h2 class="text-lg font-semibold">Overall</h2>
            <p class="mt-1 text-sm text-muted">
              Aggregate figures across the student population.
            </p>
          </div>

          <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <UCard>
              <p class="text-sm text-muted">Students</p>
              <p class="mt-1 text-2xl font-semibold">
                {{ formatNumber(attendance.student_count) }}
              </p>
            </UCard>

            <UCard>
              <p class="text-sm text-muted">Total Attendance</p>
              <p class="mt-1 text-2xl font-semibold">
                {{ formatNumber(attendance.totals.overall) }}
              </p>
            </UCard>

            <UCard>
              <p class="text-sm text-muted">Average Attendance / Student</p>
              <p class="mt-1 text-2xl font-semibold">
                {{ formatAverage(attendance.averages.overall) }}
              </p>
            </UCard>

            <UCard>
              <p class="text-sm text-muted">Relative Engagement</p>
              <p class="mt-1 text-2xl font-semibold">
                {{ formatPercent(attendance.percentages.overall) }}
              </p>
            </UCard>
          </div>

          <!-- Activity analytics -->
          <UCard>
            <template #header>
              <div>
                <h2 class="font-semibold">Activity Analytics</h2>
                <p class="text-sm text-muted">
                  Attendance totals and averages by activity.
                </p>
              </div>
            </template>

            <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div class="rounded-lg border border-default p-4">
                <div class="flex items-center gap-2">
                  <UIcon
                    name="i-lucide-presentation"
                    class="h-5 w-5 text-muted"
                  />
                  <p class="font-medium">Workshops</p>
                </div>

                <p class="mt-4 text-2xl font-semibold">
                  {{ formatNumber(attendance.totals.workshop) }}
                </p>

                <p class="text-sm text-muted">
                  {{ formatAverage(attendance.averages.workshop) }}
                  average per student
                </p>
              </div>

              <div class="rounded-lg border border-default p-4">
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-users" class="h-5 w-5 text-muted" />
                  <p class="font-medium">Stand-ups</p>
                </div>

                <p class="mt-4 text-2xl font-semibold">
                  {{ formatNumber(attendance.totals.standup) }}
                </p>

                <p class="text-sm text-muted">
                  {{ formatAverage(attendance.averages.standup) }}
                  average per student
                </p>
              </div>

              <div class="rounded-lg border border-default p-4">
                <div class="flex items-center gap-2">
                  <UIcon
                    name="i-lucide-message-circle"
                    class="h-5 w-5 text-muted"
                  />
                  <p class="font-medium">Mentoring</p>
                </div>

                <p class="mt-4 text-2xl font-semibold">
                  {{ formatNumber(attendance.totals.mentoring) }}
                </p>

                <p class="text-sm text-muted">
                  {{ formatAverage(attendance.averages.mentoring) }}
                  average per student
                </p>
              </div>
            </div>
          </UCard>

          <!-- Cohort analytics -->
          <UCard>
            <template #header>
              <div>
                <h2 class="font-semibold">Cohort Analytics</h2>
                <p class="text-sm text-muted">
                  Aggregate attendance by cohort. Individual student records are
                  not displayed.
                </p>
              </div>
            </template>

            <div v-if="cohorts.length" class="divide-y divide-default">
              <div
                v-for="cohort in cohorts"
                :key="cohort.cohort_id || cohort.cohort_name"
                class="py-5"
              >
                <div
                  class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p class="font-medium">
                      {{ cohort.cohort_name }}
                    </p>

                    <p class="text-sm text-muted">
                      {{ formatNumber(cohort.students_count) }}
                      students
                    </p>
                  </div>

                  <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
                    <div>
                      <p class="text-xs text-muted">Overall</p>
                      <p class="font-semibold">
                        {{ formatAverage(cohort.averages.overall) }}
                      </p>
                    </div>

                    <div>
                      <p class="text-xs text-muted">Workshops</p>
                      <p class="font-semibold">
                        {{ formatAverage(cohort.averages.workshop) }}
                      </p>
                    </div>

                    <div>
                      <p class="text-xs text-muted">Stand-ups</p>
                      <p class="font-semibold">
                        {{ formatAverage(cohort.averages.standup) }}
                      </p>
                    </div>

                    <div>
                      <p class="text-xs text-muted">Mentoring</p>
                      <p class="font-semibold">
                        {{ formatAverage(cohort.averages.mentoring) }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div
              v-else-if="!pending"
              class="py-8 text-center text-sm text-muted"
            >
              No cohort analytics are currently available.
            </div>
          </UCard>

          <UAlert
            title="Privacy"
            description="Faculty analytics are aggregate views. Student names, emails, usernames, and individual student records are not exposed."
            icon="i-lucide-shield-check"
            color="primary"
            variant="soft"
          />

          <UAlert
            title="About the attendance percentage"
            description="Relative engagement is calculated against the highest-attending student or cohort benchmark. It is not a percentage of scheduled sessions."
            icon="i-lucide-info"
            color="neutral"
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
