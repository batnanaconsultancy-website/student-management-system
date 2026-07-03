<script setup>
  import { computed } from "vue";
  import { CACHE_KEYS } from '~/composables/useCacheInvalidation';

  // Page that cannot be accessed without authentication and has logic to log-out a user.
  definePageMeta({
    layout: "default",
    middleware: ["admin"], 
  });

  const nuxtApp = useNuxtApp();

  // Use cached fetch for snapshot data
  const { data: snapshotData, status: snapshotStatus } = useFetch('/api/snapshot', {
    key: CACHE_KEYS.SNAPSHOT,
    getCachedData(key) {
      return nuxtApp.payload.data[key] || nuxtApp.static.data[key]
    }
  });

  // Use cached fetch for students data
  const { data: studentsData, status: studentsStatus, refresh: refreshStudents } = useFetch('/api/dashboard-students', {
    key: CACHE_KEYS.DASHBOARD_STUDENTS,
    getCachedData(key) {
      return nuxtApp.payload.data[key] || nuxtApp.static.data[key]
    }
  });

  // Computed loading state
  const loading = computed(() =>
    snapshotStatus.value === 'pending' || studentsStatus.value === 'pending'
  );

  // Process snapshot data
  const snapshotChange = computed(() => {
    const res = snapshotData.value;
    return res?.data?.value ?? res?.data ?? res ?? null;
  });

  // Process students data for the table
  const data = computed(() => {
    const students = studentsData.value?.data || [];
    return students.map((s) => ({
      id: s.id,
      status: s.status || "Unknown",
      name: `${s.first_name} ${s.last_name}`,
      email: s.email,
      program: s.programs?.name || "",
      username: s.username || "",
      cohort: s.cohorts?.name || "",
      accountStatus: s.account_status || 'Active',
      points_assigned: s.points_assigned || 0,
      profileImgUrl: s.profile_image_url || "",
    }));
  });

  // Filter to only include active students for stats
  const activeStudents = computed(() => {
    return data.value.filter(student =>
      student.accountStatus === 'Active'
    );
  });

  // Scraper health — last run time + stale warning
  const { data: scraperHealth } = useFetch('/api/scraper-health')

  const lastScrapeDisplay = computed(() => {
    const t = scraperHealth.value?.lastScrapeTime
    if (!t) return 'Never'
    const d = new Date(t)
    return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  })

  const scraperStale = computed(() => scraperHealth.value?.scrapeStale ?? false)

  // Function to force refresh (used by StudentsTable @refresh-data event)
  const fetchStudents = async () => {
    // Clear the cache first so getCachedData returns nothing
    delete nuxtApp.payload.data[CACHE_KEYS.DASHBOARD_STUDENTS];
    // Then refresh to get fresh data
    await refreshStudents();
  };
</script>

<template>
     <UDashboardPanel id="home">
        <template #header>
            <UDashboardNavbar title="Dashboard" >
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
            <template #right>
                <NotificationBell />
            </template>
            </UDashboardNavbar>
        </template>

        <template #body>
            <!-- Scraper health banner — only shows when pipeline is stale -->
            <UAlert
              v-if="scraperStale"
              color="warning"
              variant="subtle"
              icon="i-lucide-triangle-alert"
              class="mb-4 mx-4 mt-4"
              title="Data pipeline may be stale"
              :description="`Last successful data update: ${lastScrapeDisplay}. The daily scraper may have failed — check GitHub Actions for details.`"
            />
            <!-- Last run info (always visible, subtle) -->
            <div v-else class="flex items-center gap-1.5 px-4 pt-3 pb-1 text-xs text-muted">
              <UIcon name="i-lucide-check-circle" class="text-success size-3.5" />
              <span>Data last updated: {{ lastScrapeDisplay }}</span>
            </div>

            <UPageGrid class="lg:grid-cols-4 gap-4 sm:gap-6 lg:gap-px">
              <StudentStatCard
                title="STUDENTS"
                :count="activeStudents.length"
                icon="i-pajamas:users"
                icon-color="info"
                :change="snapshotChange?.total_change"
                rounded-class="rounded-lg xl:rounded-none xl:rounded-l-lg lg:rounded-r-none"
              />

              <StudentStatCard
                title="ON TRACK"
                :count="activeStudents.filter((item) => item.status === 'On Track').length"
                icon="i-pajamas:partner-verified"
                icon-color="success"
                :change="snapshotChange?.on_track_change"
                :percent-change="snapshotChange?.on_track_pct_change"
                rounded-class="rounded-lg xl:rounded-none lg:rounded-none"
              />

              <StudentStatCard
                title="MONITOR"
                :count="activeStudents.filter((item) => item.status === 'Monitor').length"
                icon="i-pajamas:warning"
                icon-color="warning"
                :change="snapshotChange?.monitor_change"
                :invert-colors="true"
                :percent-change="snapshotChange?.monitor_pct_change"
                rounded-class="rounded-lg xl:rounded-none xl:rounded-r-none lg:rounded-none"
              />

              <StudentStatCard
                title="AT RISK"
                :count="activeStudents.filter((item) => item.status === 'At Risk').length"
                icon="i-pajamas:status-alert"
                icon-color="error"
                :invert-colors="true"
                :change="snapshotChange?.at_risk_change"
                :percent-change="snapshotChange?.at_risk_pct_change"
                rounded-class="rounded-lg xl:rounded-r-lg lg:rounded-r-lg lg:rounded-l-none"
              />
            </UPageGrid>
       

            <StudentsTable
              :data="data"
              :loading="loading"
              @refresh-data="fetchStudents"
            />
        </template>
    </UDashboardPanel>
</template>
