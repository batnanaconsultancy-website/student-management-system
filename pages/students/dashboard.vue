<script setup>
  import { CACHE_KEYS } from '~/composables/useCacheInvalidation';

  definePageMeta({
    layout: "custom",
    middleware: ["auth", "student-only"],
  });

  const supabase = useSupabaseClient();
  const nuxtApp = useNuxtApp();
  const tipsRead = ref(0);
  const googleAccessToken = ref(null);

  // Use cached fetch for student dashboard data
  // Use an isolated request key and never reuse cached student data.
  const dashboardRequestId = useId();
  const { data: dashboardData, status: dashboardStatus } = useFetch('/api/student/dashboard', {
    key: `student-dashboard-${dashboardRequestId}`,
    getCachedData() {
      return undefined;
    }
  });

  // Computed loading state
  const isLoading = computed(() => dashboardStatus.value === 'pending');

  // Process dashboard data
  const studentData = computed(() => dashboardData.value?.data || {});
  const seasonProgressData = computed(() => studentData.value.season_progress || []);
  const allProgramSeasons = computed(() => studentData.value.all_program_seasons || []);
  const totalSeasons = computed(() => studentData.value.total_seasons || 0);
  const completedSeasons = computed(() => studentData.value.completed_seasons || 0);

  // Get current season name
  const currentSeasonName = computed(() => {
    if (!studentData.value.current_season_id || !allProgramSeasons.value.length) return 'N/A';
    const season = allProgramSeasons.value.find(s => s.id === studentData.value.current_season_id);
    return season?.name || 'N/A';
  });

  // Get expected season name
  const expectedSeasonName = computed(() => {
    if (!studentData.value.expected_season_id || !allProgramSeasons.value.length) return 'N/A';
    const season = allProgramSeasons.value.find(s => s.id === studentData.value.expected_season_id);
    return season?.name || 'N/A';
  });

  watch(tipsRead, (newVal) => {
    if (newVal >= 5) {
      // Trigger confetti animation
      useConfetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
      tipsRead.value = 0;
    }
  });

  async function refreshGoogleToken() {
    // Only run on client-side
    if (import.meta.server) return null;

    // The refresh token lives in an httpOnly cookie now (set at login by
    // /api/auth/store-google-refresh-token) -- this client code never
    // sees it, just asks the server to use it. See
    // server/api/auth/refresh-google-token.post.js for the full
    // rationale (both the client-secret fix and this localStorage fix).
    try {
      const dataGoogle = await $fetch("/api/auth/refresh-google-token", {
        method: "POST",
      });
      googleAccessToken.value = dataGoogle.access_token;
      return dataGoogle.access_token;
    } catch (error) {
      // 401 here just means no Google connection on file yet (or it's
      // been revoked) -- not an error worth surfacing loudly.
      return null;
    }
  }

  // Wait for the server response to identify the session before touching
  // Google credentials. Student View must never refresh the admin's token.
  const googleTokenInitStarted = ref(false);

  watch(
    () => studentData.value.is_student_view,
    async (isStudentView) => {
      if (
        !import.meta.client ||
        typeof isStudentView !== 'boolean' ||
        googleTokenInitStarted.value
      ) {
        return;
      }

      googleTokenInitStarted.value = true;

      if (isStudentView) {
        googleAccessToken.value = null;
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      googleAccessToken.value = session?.provider_token || null;

      if (!googleAccessToken.value) {
        await refreshGoogleToken();
      }
    },
    { immediate: true }
  );

  const isStudentView = computed(
    () => studentData.value.is_student_view === true
  );

  // Redirect when the server-issued Student View session expires.
  // Server-side API validation remains the actual security boundary.
  let studentViewExpiryTimer = null;

  watch(
    [
      () => studentData.value.is_student_view,
      () => studentData.value.student_view?.expires_at,
    ],
    ([studentViewFlag, expiresAt]) => {
      if (!import.meta.client) return;

      if (studentViewExpiryTimer !== null) {
        clearTimeout(studentViewExpiryTimer);
        studentViewExpiryTimer = null;
      }

      if (studentViewFlag !== true) return;

      const expiryTime = expiresAt ? Date.parse(expiresAt) : NaN;

      // Fail closed if the session is marked active but its expiry is missing
      // or invalid.
      if (!Number.isFinite(expiryTime)) {
        void navigateTo('/admin/dashboard', { replace: true });
        return;
      }

      const remainingMs = expiryTime - Date.now();

      if (remainingMs <= 0) {
        void navigateTo('/admin/dashboard', { replace: true });
        return;
      }

      studentViewExpiryTimer = setTimeout(() => {
        studentViewExpiryTimer = null;
        void navigateTo('/admin/dashboard', { replace: true });
      }, remainingMs);
    },
    { immediate: true }
  );

  onBeforeUnmount(() => {
    if (studentViewExpiryTimer !== null) {
      clearTimeout(studentViewExpiryTimer);
      studentViewExpiryTimer = null;
    }
  });

  const studentViewExitBusy = ref(false);
  const studentViewExitError = ref('');

  async function exitStudentView() {
    if (studentViewExitBusy.value) return;

    studentViewExitBusy.value = true;
    studentViewExitError.value = '';

    try {
      await $fetch('/api/admin/student-view/end', { method: 'POST' });
      await navigateTo('/admin/dashboard', { replace: true });
    } catch (error) {
      studentViewExitError.value =
        error?.data?.statusMessage ||
        error?.statusMessage ||
        'Unable to end Student View. Please try again.';
    } finally {
      studentViewExitBusy.value = false;
    }
  }

  function formatStudentViewExpiry(value) {
    if (!value) return 'Unknown';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleString();
  }

  // Format last_login as 'x days/hours/minutes ago'
  function formatLastLogin(dateString) {
    if (!dateString) return "N/A";
    const now = new Date();
    const last = new Date(dateString);
    const diffMs = now - last;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay > 0) return diffDay === 1 ? "1 d ago" : `${diffDay}d ago`;
    if (diffHour > 0) return diffHour === 1 ? "1 h ago" : `${diffHour}h ago`;
    if (diffMin > 0) return diffMin === 1 ? "1 min ago" : `${diffMin}min ago`;
    return "just now";
  }
</script>

<template>
    <UDashboardPanel id="home">
      <template #header>
          <UDashboardNavbar title="Dashboard" >
              <template #leading>
                  <UDashboardSidebarCollapse />
              </template>
          </UDashboardNavbar>
      </template>

      <template #body>
        <!-- Loading Skeletons -->
        <div v-if="isLoading">
          <div class="w-full justify-between items-center flex mb-14">
            <div class="space-y-2">
              <USkeleton class="h-8 w-64" />
              <USkeleton class="h-4 w-48" />
            </div>

            <div class="flex gap-8 translate-y-6">
              <USkeleton class="h-24 w-32" v-for="n in 3" :key="n" />
            </div>
          </div>

          <UPageGrid class="h-full grid-cols-1 sm:grid-cols-1 lg:grid-cols-2 gap-10">
            <div class="flex flex-col gap-4">
              <USkeleton class="h-64 w-full" />
              <USkeleton class="h-48 w-full" />
            </div>

            <div class="flex flex-col gap-4">
              <USkeleton class="h-48 w-full" />
              <div class="grid grid-cols-2 gap-4">
                <USkeleton class="h-24 w-full" v-for="n in 6" :key="n" />
              </div>
            </div>
          </UPageGrid>
        </div>

        <!-- Actual Content -->
        <div v-else class="flex flex-col h-full 2xl:justify-between">
        <UAlert
          v-if="isStudentView"
          color="warning"
          variant="subtle"
          icon="i-lucide-eye"
          title="Student View — Read Only"
          description="You are viewing this dashboard as an administrator. Student changes and write actions are disabled."
          class="mb-6"
        >
          <template #description>
            <div class="space-y-2">
              <p>
                Student:
                <strong>{{ studentData.first_name }} {{ studentData.last_name }}</strong>
                <span v-if="studentData.email"> ({{ studentData.email }})</span>
              </p>
              <p>Reason: {{ studentData.student_view?.reason || 'Not provided' }}</p>
              <p>Session expires: {{ formatStudentViewExpiry(studentData.student_view?.expires_at) }}</p>
              <p v-if="studentViewExitError" class="text-red-600">
                {{ studentViewExitError }}
              </p>
              <UButton
                color="warning"
                variant="solid"
                :loading="studentViewExitBusy"
                :disabled="studentViewExitBusy"
                @click="exitStudentView"
              >
                Exit Student View
              </UButton>
            </div>
          </template>
        </UAlert>

        <div class="w-full justify-between items-start lg:items-center flex flex-col lg:flex-row">
          <StudentDashboardGreetings v-if="studentData.first_name" :first_name="studentData.first_name" />

          <div class="flex gap-8 translate-y-4 xl:translate-y-6">
                 <StudentDashboardStatCard
                  :value="studentData.points_assigned ?? 0"
                  label="Earned Points"
                  icon="i-lucide:star"
                />

          </div>
        </div>

        <UPageGrid class="grid-cols-1 sm:grid-cols-1 lg:grid-cols-2 mt-14 lg:gap-10">
          <div class="flex flex-col gap-1">            
            <StudentDashboardMeetingsDisplay
              :googleAccessToken="googleAccessToken"
              :studentView="isStudentView"
            />

            <StudentDashboardDeadlinesCard />
          </div>
           
           <div class="flex flex-col justify-between 2xl:gap-4">
              <StudentDashboardProgress
                v-if="studentData"
                :status="studentData.status"
                :progress="studentData.progress"
                :completedSeasons="completedSeasons"
                :totalSeasons="totalSeasons"
                :seasons="seasonProgressData"
              />

              <UPageGrid class="grid-cols-2 lg:grid-cols-2 gap-3 2xl:gap-4">
                
                <StudentDashboardStatCard
                    :value="currentSeasonName"
                    label="Current Season"
                    icon="i-pajamas:planning"
                    styles=" 2xl:min-h-[100px] lg:min-h-[80px]"
                />
                
                <StudentDashboardStatCard
                  :value="expectedSeasonName"
                  label="Expected Season"
                  icon="i-pajamas:timer"
                  styles=" 2xl:min-h-[100px] lg:min-h-[80px]"
                />

                   <StudentDashboardStatCard
                  :value="studentData.exercises_completed"
                  label="Exercises Completed"
                  icon="i-pajamas:issue-type-requirements"
                  styles=" 2xl:min-h-[100px] lg:min-h-[80px]"
                />
                   <StudentDashboardStatCard
                  :value="studentData.completed_projects"
                  label="Projects Completed"
                  icon="i-pajamas:monitor"
                  styles=" 2xl:min-h-[100px] lg:min-h-[80px]"
                />
                   <StudentDashboardStatCard
                  :value="studentData.points ?? 0"
                  label="Qwasar Points"
                  icon="i-pajamas:work-item-feature"
                  styles=" 2xl:min-h-[100px] lg:min-h-[80px]"
                />
                   <StudentDashboardStatCard
                  :value="formatLastLogin(studentData.last_login)"
                  label="Last Login"
                  icon="i-pajamas:hourglass"
                  styles="2xl:min-h-[100px] lg:min-h-[80px]"
                />
                   <StudentDashboardStatCard
                  :value="studentData.workshops_attended ?? 0"
                  :percentage="`${studentData.cohort_attendance?.workshops?.percent ?? 0}%`"
                  label="Workshops Attended"
                  icon="i-pajamas:live-preview"
                  styles="2xl:min-h-[100px] lg:min-h-[80px]"
                />
                   <StudentDashboardStatCard
                  :value="studentData.standup_attended ?? 0"
                  :percentage="`${studentData.cohort_attendance?.standups?.percent ?? 0}%`"
                  label="Stand-ups Attended"
                  icon="i-pajamas:comment-lines"
                  styles="2xl:min-h-[100px] lg:min-h-[80px]"
                />
                   <StudentDashboardStatCard
                  :value="studentData.mentoring_attended ?? 0"
                  :percentage="`${studentData.cohort_attendance?.mentoring?.percent ?? 0}%`"
                  label="Mentoring Attended"
                  icon="i-pajamas:comment"
                  styles="2xl:min-h-[100px] lg:min-h-[80px]"
                />
              </UPageGrid>
           </div>
        </UPageGrid>
        </div>
      </template>
  </UDashboardPanel>
</template>
