<script setup>
  import { CACHE_KEYS } from '~/composables/useCacheInvalidation';

  definePageMeta({
    layout: "custom",
    middleware: ["auth", "student-only"],
  });

  const supabase = useSupabaseClient();
  const nuxtApp = useNuxtApp();
  const runtimeConfig = useRuntimeConfig();
  const tipsRead = ref(0);
  const googleAccessToken = ref(null);

  // Use cached fetch for student dashboard data
  const { data: dashboardData, status: dashboardStatus } = useFetch('/api/student/dashboard', {
    key: CACHE_KEYS.STUDENT_DASHBOARD,
    getCachedData(key) {
      return nuxtApp.payload.data[key] || nuxtApp.static.data[key]
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
    // Only run on client-side where localStorage is available
    if (import.meta.server) return null;

    const storedRefreshToken = window.localStorage.getItem("oauth_provider_refresh_token");
    if (!storedRefreshToken) return null;

    const response = await fetch("https://www.googleapis.com/oauth2/v3/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: runtimeConfig.public.googleClientId,
        client_secret: runtimeConfig.public.googleClientSecret,
        refresh_token: storedRefreshToken,
        grant_type: "refresh_token",
      }),
    });

    const dataGoogle = await response.json();
    googleAccessToken.value = dataGoogle.access_token;
    return dataGoogle.access_token;
  }

  // Watch the token, refresh if undefined - only on client side
  if (import.meta.client) {
    watch(
      googleAccessToken,
      async (newToken) => {
        if (!newToken) {
          try {
            await refreshGoogleToken();
          } catch (error) {
            console.error("Failed to refresh Google token", error);
          }
        }
      },
      { immediate: true }
    );
  }

  onMounted(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    googleAccessToken.value = session?.provider_token || null;
  });

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
        <div class="w-full justify-between items-start lg:items-center flex flex-col lg:flex-row">
          <StudentDashboardGreetings v-if="studentData.first_name" :first_name="studentData.first_name" />

          <div class="flex gap-8 translate-y-4 xl:translate-y-6">
                 <StudentDashboardStatCard
                  :value="studentData.points ?? 0"
                  label="Earned Points"
                  icon="i-lucide:star"
                />

          </div>
        </div>

        <UPageGrid class="grid-cols-1 sm:grid-cols-1 lg:grid-cols-2 mt-14 lg:gap-10">
          <div class="flex flex-col gap-1">            
            <StudentDashboardMeetingsDisplay :googleAccessToken="googleAccessToken" />

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
              </UPageGrid>
           </div>
        </UPageGrid>
        </div>
      </template>
  </UDashboardPanel>
</template>
