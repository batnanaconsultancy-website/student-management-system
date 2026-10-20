<script setup>
  import { computed, ref } from "vue";
  import NotificationBell from "~/components/admin/NotificationBell.vue";
  import { CACHE_KEYS } from '~/composables/useCacheInvalidation';

  // Page that cannot be accessed without authentication and has logic to log-out a user.
  definePageMeta({
    layout: "default",
    middleware: ["admin"], 
  });

  const nuxtApp = useNuxtApp();
  const bulkStatusModalOpen = ref(false);

  const studentViewSearchTerm = ref("");
  const studentViewResults = ref([]);
  const studentViewSelectedStudent = ref(null);
  const studentViewSearchBusy = ref(false);
  const studentViewStartBusy = ref(false);
  const studentViewError = ref("");
  const studentViewReason = ref("");
  const studentViewAuthorized = ref(false);
  const studentViewActiveSession = ref(null);
  const studentViewEndBusy = ref(false);

  function studentViewErrorMessage(error, fallback) {
    return error?.data?.statusMessage || error?.statusMessage || fallback;
  }

  async function loadStudentViewStatus() {
    try {
      const result = await $fetch("/api/admin/student-view/status", {
        headers: { "Cache-Control": "no-cache" },
      });
      studentViewActiveSession.value = result?.active ? result.session : null;
    } catch (error) {
      studentViewError.value = studentViewErrorMessage(
        error,
        "Unable to check Student View session status."
      );
    }
  }

  onMounted(loadStudentViewStatus);

  async function searchStudentViewStudents() {
    const term = studentViewSearchTerm.value.trim();
    studentViewError.value = "";
    studentViewSelectedStudent.value = null;
    studentViewResults.value = [];

    if (term.length < 2) {
      studentViewError.value = "Enter at least two characters of the student's email.";
      return;
    }

    studentViewSearchBusy.value = true;
    try {
      const result = await $fetch("/api/admin/student-view/search", {
        query: { q: term },
      });
      studentViewResults.value = result?.data || [];
      if (!studentViewResults.value.length) {
        studentViewError.value = "No matching student email was found.";
      }
    } catch (error) {
      studentViewError.value = studentViewErrorMessage(
        error,
        "Student search failed. Please try again."
      );
    } finally {
      studentViewSearchBusy.value = false;
    }
  }

  function selectStudentForView(student) {
    studentViewSelectedStudent.value = student;
    studentViewError.value = "";
    studentViewAuthorized.value = false;
  }

  async function startStudentView() {
    const student = studentViewSelectedStudent.value;
    const reason = studentViewReason.value.trim();

    if (!student) {
      studentViewError.value = "Search for and select a student first.";
      return;
    }
    if (reason.length < 10) {
      studentViewError.value = "Enter a troubleshooting reason of at least 10 characters.";
      return;
    }
    if (!studentViewAuthorized.value) {
      studentViewError.value = "Confirm that the student has verbally authorized this session.";
      return;
    }

    studentViewStartBusy.value = true;
    studentViewError.value = "";

    try {
      await $fetch("/api/admin/student-view/start", {
        method: "POST",
        body: {
          student_email: student.email,
          reason,
          student_authorized: true,
        },
      });
      await navigateTo("/students/dashboard");
    } catch (error) {
      studentViewError.value = studentViewErrorMessage(
        error,
        "Unable to start Student View."
      );
      await loadStudentViewStatus();
    } finally {
      studentViewStartBusy.value = false;
    }
  }

  async function endStudentViewFromAdmin() {
    studentViewEndBusy.value = true;
    studentViewError.value = "";

    try {
      await $fetch("/api/admin/student-view/end", { method: "POST" });
      studentViewActiveSession.value = null;
      studentViewSelectedStudent.value = null;
      studentViewReason.value = "";
      studentViewAuthorized.value = false;
      await loadStudentViewStatus();
    } catch (error) {
      studentViewError.value = studentViewErrorMessage(
        error,
        "Unable to end Student View. Please try again."
      );
    } finally {
      studentViewEndBusy.value = false;
    }
  }

  async function resumeStudentView() {
    await navigateTo("/students/dashboard");
  }

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
      studentClass: s.student_class || 'Regular',
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

            <section class="mx-4 my-4 space-y-4 rounded-xl border border-default p-4">
              <div>
                <h2 class="text-lg font-semibold">Student View</h2>
                <p class="text-sm text-muted">
                  Open a student's dashboard for authorized, read-only troubleshooting.
                  Sessions expire after 10 minutes and are audited.
                </p>
              </div>

              <UAlert
                v-if="studentViewError"
                color="error"
                variant="subtle"
                icon="i-lucide-circle-alert"
                :description="studentViewError"
              />

              <div v-if="studentViewActiveSession" class="space-y-3">
                <UAlert
                  color="warning"
                  variant="subtle"
                  icon="i-lucide-eye"
                  title="A Student View session is active"
                  :description="`${studentViewActiveSession.student_name || studentViewActiveSession.student_email} · Expires ${new Date(studentViewActiveSession.expires_at).toLocaleString()}`"
                />
                <div class="flex flex-wrap gap-2">
                  <UButton icon="i-lucide-eye" @click="resumeStudentView">
                    Return to Student View
                  </UButton>
                  <UButton
                    color="neutral"
                    variant="outline"
                    icon="i-lucide-log-out"
                    :loading="studentViewEndBusy"
                    @click="endStudentViewFromAdmin"
                  >
                    End Session
                  </UButton>
                </div>
              </div>

              <div v-else class="space-y-4">
                <form
                  class="flex flex-col gap-2 sm:flex-row"
                  @submit.prevent="searchStudentViewStudents"
                >
                  <UInput
                    v-model="studentViewSearchTerm"
                    type="text"
                    placeholder="Search by student's email"
                    autocomplete="off"
                    class="flex-1"
                  />
                  <UButton
                    type="submit"
                    icon="i-lucide-search"
                    :loading="studentViewSearchBusy"
                  >
                    Search students
                  </UButton>
                </form>

                <div v-if="studentViewResults.length" class="space-y-2">
                  <p class="text-sm font-medium">Select the correct student</p>
                  <button
                    v-for="student in studentViewResults"
                    :key="student.id"
                    type="button"
                    class="flex w-full flex-col rounded-lg border p-3 text-left transition-colors hover:bg-elevated"
                    :class="studentViewSelectedStudent?.id === student.id ? 'border-primary bg-elevated' : 'border-default'"
                    @click="selectStudentForView(student)"
                  >
                    <span class="font-medium">{{ student.name || "Student" }}</span>
                    <span class="text-sm text-muted">{{ student.email }}</span>
                  </button>
                </div>

                <div v-if="studentViewSelectedStudent" class="space-y-3 rounded-lg bg-elevated p-3">
                  <p class="text-sm">
                    Selected student:
                    <strong>{{ studentViewSelectedStudent.name || "Student" }}</strong>
                    ({{ studentViewSelectedStudent.email }})
                  </p>

                  <UTextarea
                    v-model="studentViewReason"
                    :rows="3"
                    placeholder="Reason for troubleshooting (at least 10 characters)"
                  />

                  <UCheckbox
                    v-model="studentViewAuthorized"
                    label="The student has verbally authorized this troubleshooting session."
                  />

                  <p class="text-xs text-muted">
                    Student View is read-only. Do not proceed without the student's authorization.
                  </p>

                  <UButton
                    icon="i-lucide-eye"
                    :loading="studentViewStartBusy"
                    :disabled="!studentViewAuthorized || studentViewReason.trim().length < 10"
                    @click="startStudentView"
                  >
                    Start Student View
                  </UButton>
                </div>
              </div>
            </section>

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

            <div class="flex justify-end mb-2">
              <UButton
                icon="i-lucide-users-round"
                color="neutral"
                variant="outline"
                @click="bulkStatusModalOpen = true"
              >
                Bulk Change Status
              </UButton>
            </div>

            <StudentsTable
              :data="data"
              :loading="loading"
              @refresh-data="fetchStudents"
            />

            <AdminBulkStatusChangeModal
              v-model:open="bulkStatusModalOpen"
              :students="data"
              @updated="fetchStudents"
            />
        </template>
    </UDashboardPanel>
</template>
