<script setup lang="ts">
definePageMeta({
  layout: "default",
  middleware: ["admin"],
});

interface AttendanceAttendee {
  sourceRow: number;
  firstName: string;
  lastName: string;
  studentName: string;
  studentEmail: string;
  durationMinutes: number | null;
  timeJoined: string;
  timeExited: string;
  valid: boolean;
  meetingAt: string | null;
  meetingId: string;
  sourceReport: string;
}

interface AttendanceReport {
  subject: string;
  meetingAt: string | null;
  timestamp?: number;
  spreadsheetId?: string;
  spreadsheetTitle?: string;
  attendeeRows?: number;
  emailRows?: number;
  attendees?: AttendanceAttendee[];
  status: string;
  detail?: string;
}

interface PreviewResponse {
  readOnly: boolean;
  cutoff: string;
  summary: {
    gmailMessagesFound: number;
    eligibleReportEmails: number;
    skippedBeforeCutoff: number;
    unparseableMeetingTimes: number;
    attendanceLinksNotFound: number;
    uniqueSpreadsheetIdsFound: number;
    successfullyReadSpreadsheets: number;
    nonEmptyAttendeeRows: number;
    rowsContainingEmail: number;
    errors: number;
  };
  reports: AttendanceReport[];
}

interface PreviewJobResponse {
  status: "idle" | "running" | "completed" | "completed_with_errors" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  cachedAt: string | null;
  preview: PreviewResponse | null;
}

interface ImportedAttendanceStudent {
  email: string;
  first_name: string | null;
  last_name: string | null;
  meetings_attended: number;
  total_duration_minutes: number | string;
  synced_at: string;
}

interface ImportedAttendanceRecord {
  meeting_id: string;
  meeting_at: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  duration_minutes: number | string;
  synced_at: string;
}

interface ImportedAttendanceResponse {
  readOnly: boolean;
  recordLimit: number;
  recordLimitReached: boolean;
  summary: {
    students: number;
    attendanceRecords: number;
    meetings: number;
    totalMeetingsAttended: number;
    totalDurationMinutes: number;
  };
  students: ImportedAttendanceStudent[];
  records: ImportedAttendanceRecord[];
}

const preview = ref<PreviewResponse | null>(null);
const scanStatus = ref<PreviewJobResponse["status"]>("idle");
const loading = ref(false);
const errorMessage = ref("");

const importedAttendance = ref<ImportedAttendanceResponse | null>(null);
const importedAttendanceLoading = ref(false);
const importedAttendanceError = ref("");

async function loadImportedAttendance() {
  if (importedAttendanceLoading.value) return;
  importedAttendanceLoading.value = true;
  importedAttendanceError.value = "";

  try {
    importedAttendance.value = await $fetch<ImportedAttendanceResponse>(
      "/api/admin/canvas-masters/imported-attendance",
    );
  } catch (error: any) {
    importedAttendanceError.value =
      error?.data?.statusMessage ||
      error?.statusMessage ||
      "Could not load imported attendance. Verify the database migration and permissions.";
  } finally {
    importedAttendanceLoading.value = false;
  }
}

async function loadPreview() {
  if (loading.value) return;
  loading.value = true;

  try {
    const result = await $fetch<PreviewJobResponse>(
      "/api/admin/canvas-masters/attendance-preview",
    );

    scanStatus.value = result.status;

    if (result.preview) {
      preview.value = result.preview;
    }

    errorMessage.value =
      result.status === "failed"
        ? result.errorMessage || "The attendance preview scan failed."
        : result.status === "completed_with_errors"
          ? "The scan completed, but some reports could not be processed. Review the report statuses and details below."
          : "";
  } catch (error: any) {
    errorMessage.value =
      error?.data?.statusMessage ||
      error?.statusMessage ||
      "Could not load the attendance preview status. Check the server logs.";
  } finally {
    loading.value = false;
  }
}

const summaryCards = computed(() => {
  const summary = preview.value?.summary;
  if (!summary) return [];

  return [
    {
      label: "Gmail messages found",
      value: summary.gmailMessagesFound,
    },
    {
      label: "Reports in preview",
      value: summary.eligibleReportEmails,
    },
    {
      label: "Spreadsheets read",
      value: `${summary.successfullyReadSpreadsheets} / ${summary.uniqueSpreadsheetIdsFound}`,
    },
    {
      label: "Attendance rows",
      value: summary.nonEmptyAttendeeRows,
    },
    {
      label: "Rows containing email",
      value: summary.rowsContainingEmail,
    },
    {
      label: "Before cutoff",
      value: summary.skippedBeforeCutoff,
    },
    {
      label: "Unparsed meeting times",
      value: summary.unparseableMeetingTimes,
    },
    {
      label: "Missing attendance links",
      value: summary.attendanceLinksNotFound,
    },
  ];
});

function statusColor(status: string) {
  if (status === "OK") return "success";
  if (status.includes("ERROR")) return "error";
  return "warning";
}

interface AttendanceReviewRow extends AttendanceAttendee {
  reportStatus: string;
  reportDetail: string;
}

// onMounted(loadPreview)
onMounted(async () => {
  restoreReviewState();
  await Promise.allSettled([loadPreview(), loadImportedAttendance()]);
});

const searchQuery = ref("");
const meetingFilter = ref("all");
const reviewFilter = ref("all");

// const selectedRecordKeys = ref<string[]>([]);

const REVIEW_STORAGE_KEY = "masters-attendance-review-v1";

interface SavedReviewState {
  selectedRecordKeys: string[];
  searchQuery: string;
  meetingFilter: string;
  reviewFilter: string;
}

const selectedRecordKeys = ref<string[]>([]);
const restoringReviewState = ref(false);
const reviewStateRestored = ref(false);

function saveReviewState() {
  if (import.meta.server || restoringReviewState.value) return;

  const state: SavedReviewState = {
    selectedRecordKeys: selectedRecordKeys.value,
    searchQuery: searchQuery.value,
    meetingFilter: meetingFilter.value,
    reviewFilter: reviewFilter.value,
  };

  try {
    localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Could not save attendance review state:", error);
  }
}

function restoreReviewState() {
  if (import.meta.server) return;

  restoringReviewState.value = true;

  try {
    const saved = localStorage.getItem(REVIEW_STORAGE_KEY);

    if (saved) {
      const state = JSON.parse(saved) as Partial<SavedReviewState>;

      selectedRecordKeys.value = Array.isArray(state.selectedRecordKeys)
        ? state.selectedRecordKeys.filter(
            (key): key is string => typeof key === "string",
          )
        : [];

      searchQuery.value =
        typeof state.searchQuery === "string" ? state.searchQuery : "";

      meetingFilter.value =
        typeof state.meetingFilter === "string" ? state.meetingFilter : "all";

      reviewFilter.value =
        typeof state.reviewFilter === "string" ? state.reviewFilter : "all";
    }
  } catch (error) {
    console.warn("Could not restore attendance review state:", error);
  } finally {
    restoringReviewState.value = false;
    reviewStateRestored.value = true;
  }
}

watch(
  [selectedRecordKeys, searchQuery, meetingFilter, reviewFilter],
  saveReviewState,
  { deep: true },
);

function clearSavedReviewState() {
  selectedRecordKeys.value = [];
  searchQuery.value = "";
  meetingFilter.value = "all";
  reviewFilter.value = "all";

  if (!import.meta.server) {
    localStorage.removeItem(REVIEW_STORAGE_KEY);
  }
}

function recordKey(attendee: AttendanceAttendee) {
  return [
    attendee.meetingId,
    attendee.studentEmail.trim().toLowerCase(),
    attendee.sourceRow,
  ].join("::");
}

function isSelected(attendee: AttendanceAttendee) {
  return selectedRecordKeys.value.includes(recordKey(attendee));
}

function toggleRecord(attendee: AttendanceAttendee, checked: boolean) {
  const key = recordKey(attendee);

  if (checked) {
    if (!selectedRecordKeys.value.includes(key)) {
      selectedRecordKeys.value.push(key);
    }
  } else {
    selectedRecordKeys.value = selectedRecordKeys.value.filter(
      (selectedKey) => selectedKey !== key,
    );
  }
}

const selectedCount = computed(() => selectedRecordKeys.value.length);

function toggleVisibleRecords(checked: boolean) {
  const visibleKeys = filteredAttendees.value.map(recordKey);

  if (checked) {
    selectedRecordKeys.value = [
      ...new Set([...selectedRecordKeys.value, ...visibleKeys]),
    ];
  } else {
    selectedRecordKeys.value = selectedRecordKeys.value.filter(
      (key) => !visibleKeys.includes(key),
    );
  }
}

const allVisibleSelected = computed(
  () =>
    filteredAttendees.value.length > 0 &&
    filteredAttendees.value.every(isSelected),
);

const allAttendees = computed(() => {
  const seen = new Set<string>();

  return (preview.value?.reports ?? []).flatMap((report) =>
    (report.attendees ?? [])
      .map((attendee) => ({
        ...attendee,
        reportStatus: report.status,
        reportDetail: report.detail ?? "",
      }))
      .filter((attendee) => {
        const key = recordKey(attendee);

        if (seen.has(key)) return false;

        seen.add(key);
        return true;
      }),
  );
});

function isLikelyBot(attendee: AttendanceAttendee) {
  const identity =
    `${attendee.studentName} ${attendee.studentEmail}`.toLowerCase();
  return /transkriptor|read.ai|spiky scribe|meeting assistant|notetaker|note taker|bot[_-]/i.test(
    identity,
  );
}

function reviewReason(attendee: AttendanceReviewRow) {
  if (attendee.reportStatus !== "OK") return "Source report needs attention";
  if (!attendee.valid) return "Invalid email or duration";
  if (isLikelyBot(attendee)) return "Possible meeting bot";
  if (attendee.durationMinutes === null || attendee.durationMinutes <= 0)
    return "Missing or zero duration";
  if (attendee.durationMinutes < 10) return "Very short attendance";
  return "";
}

const meetingOptions = computed(() => {
  const dates = [
    ...new Set(
      allAttendees.value
        .map((attendee) => attendee.meetingAt)
        .filter((date): date is string => Boolean(date)),
    ),
  ];

  return dates.map((date) => ({
    label: date,
    value: date,
  }));
});

const filteredAttendees = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();

  return allAttendees.value.filter((attendee) => {
    const matchesSearch =
      !query ||
      attendee.studentName.toLowerCase().includes(query) ||
      attendee.studentEmail.toLowerCase().includes(query);

    const matchesMeeting =
      meetingFilter.value === "all" ||
      attendee.meetingAt === meetingFilter.value;

    const reason = reviewReason(attendee);
    const matchesReview =
      reviewFilter.value === "all" ||
      (reviewFilter.value === "review" && Boolean(reason)) ||
      (reviewFilter.value === "clean" && !reason);

    return matchesSearch && matchesMeeting && matchesReview;
  });
});

// Keep loading manual until the review screen has been verified.
</script>

<template>
  <UDashboardPanel id="masters-attendance-preview">
    <template #header>
      <UDashboardNavbar title="Masters Attendance Preview">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            to="/admin/canvas-masters"
            label="Back to Canvas Masters"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="subtle"
            size="sm"
          />
          <UButton
            :label="loading ? 'Refreshing…' : 'Refresh Preview'"
            icon="i-lucide-refresh-cw"
            color="primary"
            size="sm"
            :loading="loading"
            :disabled="loading"
            @click="loadPreview"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-6">
        <UAlert
          color="info"
          variant="subtle"
          title="Read-only preview"
          description="This page displays the most recently saved preview from the daily Google Meet attendance scan. Refresh reloads the saved snapshot; it does not trigger a Google scan or change the Canvas Masters roster."
          icon="i-lucide-eye"
        />

        <UAlert
          v-if="errorMessage && scanStatus !== 'completed_with_errors'"
          color="error"
          variant="subtle"
          title="Could not load attendance preview"
          :description="errorMessage"
        />

        <UAlert
          v-if="scanStatus === 'completed_with_errors'"
          color="warning"
          variant="subtle"
          title="Preview completed with errors"
          description="Some reports could not be processed. Review each report's status and details before using this attendance data."
          icon="i-lucide-alert-triangle"
        />

        <div
          v-if="scanStatus === 'running' && !preview"
          class="flex items-center gap-3 py-8 text-sm text-gray-500"
        >
          <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
          The scheduled attendance scan is running. The last successful
          preview remains available until the new scan completes.
        </div>

        <template v-if="preview">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <UCard v-for="card in summaryCards" :key="card.label">
              <p class="text-sm text-gray-500">{{ card.label }}</p>
              <p class="mt-2 text-2xl font-semibold">
                {{ card.value }}
              </p>
            </UCard>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 class="text-lg font-semibold">Meeting reports</h2>
              <p class="text-sm text-gray-500">
                Cutoff:
                {{
                  new Date(preview.cutoff).toLocaleString("en-GB", {
                    timeZone: "Europe/Amsterdam",
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                }}
                (Amsterdam time)
              </p>
            </div>
            <p class="text-sm text-gray-500">
              {{ preview.reports.length }} reports displayed
            </p>
          </div>

          <div
            class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800"
          >
            <table
              class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800"
            >
              <thead class="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th class="px-4 py-3 text-left font-semibold">
                    Meeting date
                  </th>
                  <th class="px-4 py-3 text-left font-semibold">
                    Email subject
                  </th>
                  <th class="px-4 py-3 text-left font-semibold">
                    Attendance spreadsheet
                  </th>
                  <th class="px-4 py-3 text-right font-semibold">
                    Attendee rows
                  </th>
                  <th class="px-4 py-3 text-right font-semibold">Email rows</th>
                  <th class="px-4 py-3 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 dark:divide-gray-800">
                <tr
                  v-for="(report, index) in preview.reports"
                  :key="`${report.subject}-${report.meetingAt}-${index}`"
                >
                  <td class="whitespace-nowrap px-4 py-3">
                    {{ report.meetingAt || "Unknown" }}
                  </td>
                  <td class="min-w-64 px-4 py-3">
                    {{ report.subject }}
                  </td>
                  <td class="min-w-48 px-4 py-3">
                    {{ report.spreadsheetTitle || "Not available" }}
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums">
                    {{ report.attendeeRows ?? "—" }}
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums">
                    {{ report.emailRows ?? "—" }}
                  </td>
                  <td class="min-w-48 px-4 py-3">
                    <UBadge
                      :color="statusColor(report.status)"
                      variant="subtle"
                    >
                      {{ report.status }}
                    </UBadge>
                    <p v-if="report.detail" class="mt-1 text-xs text-gray-500">
                      {{ report.detail }}
                    </p>
                  </td>
                </tr>
                <tr v-if="preview.reports.length === 0">
                  <td colspan="6" class="px-4 py-8 text-center text-gray-500">
                    No reports were found for the configured cutoff.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p class="text-xs text-gray-500">
            Counts are calculated from non-empty rows in each sheet's Attendees
            tab, excluding its header row. No attendee names or email addresses
            are displayed.
          </p>

          <section class="space-y-4">
            <div>
              <h2 class="text-lg font-semibold">
                Individual attendance records
              </h2>
              <p class="text-sm text-gray-500">
                {{ filteredAttendees.length }} records shown out of
                {{ allAttendees.length }}. Review flags are suggestions, not
                final attendance decisions.
              </p>
              <p class="text-sm font-medium">
                {{ selectedCount }} attendance records selected
              </p>

              <UButton
                color="neutral"
                variant="outline"
                size="sm"
                @click="clearSavedReviewState"
              >
                Clear saved review
              </UButton>
            </div>

            <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
              <UInput
                v-model="searchQuery"
                placeholder="Search student name or email"
                icon="i-lucide-search"
                aria-label="Search attendees"
              />

              <USelect
                v-model="meetingFilter"
                :items="[
                  { label: 'All meetings', value: 'all' },
                  ...meetingOptions,
                ]"
                aria-label="Filter by meeting"
              />

              <USelect
                v-model="reviewFilter"
                :items="[
                  { label: 'All records', value: 'all' },
                  { label: 'Needs review', value: 'review' },
                  { label: 'No automatic flags', value: 'clean' },
                ]"
                aria-label="Filter by review status"
              />
            </div>

            <div
              class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800"
            >
              <table
                class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800"
              >
                <thead class="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th class="px-3 py-3 text-left font-semibold">
                      <input
                        type="checkbox"
                        :checked="allVisibleSelected"
                        aria-label="Select all visible attendance records"
                        @change="
                          toggleVisibleRecords(
                            ($event.target as HTMLInputElement).checked,
                          )
                        "
                      />
                    </th>
                    <th class="px-3 py-3 text-left font-semibold">Meeting</th>
                    <th class="px-3 py-3 text-left font-semibold">Name</th>
                    <th class="px-3 py-3 text-left font-semibold">Email</th>
                    <th class="px-3 py-3 text-right font-semibold">Minutes</th>
                    <th class="px-3 py-3 text-left font-semibold">Joined</th>
                    <th class="px-3 py-3 text-left font-semibold">Exited</th>
                    <th class="px-3 py-3 text-left font-semibold">Review</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200 dark:divide-gray-800">
                  <tr
                    v-for="(attendee, index) in filteredAttendees"
                    :key="`${attendee.meetingId}-${attendee.studentEmail}-${attendee.sourceRow}-${index}`"
                  >
                    <td class="px-3 py-3">
                      <input
                        type="checkbox"
                        :checked="isSelected(attendee)"
                        :aria-label="`Select attendance for ${attendee.studentName}`"
                        @change="
                          toggleRecord(
                            attendee,
                            ($event.target as HTMLInputElement).checked,
                          )
                        "
                      />
                    </td>

                    <td class="whitespace-nowrap px-3 py-3">
                      {{ attendee.meetingAt || "Unknown" }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-3">
                      {{ attendee.studentName || "Unknown" }}
                    </td>
                    <td class="px-3 py-3">
                      {{ attendee.studentEmail || "Missing" }}
                    </td>
                    <td class="px-3 py-3 text-right tabular-nums">
                      {{ attendee.durationMinutes ?? "—" }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-3">
                      {{ attendee.timeJoined || "—" }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-3">
                      {{ attendee.timeExited || "—" }}
                    </td>
                    <td class="min-w-48 px-3 py-3">
                      <UBadge
                        :color="reviewReason(attendee) ? 'warning' : 'success'"
                        variant="subtle"
                      >
                        {{ reviewReason(attendee) || "No automatic flags" }}
                      </UBadge>
                    </td>
                  </tr>
                  <tr v-if="filteredAttendees.length === 0">
                    <td colspan="8" class="px-3 py-8 text-center text-gray-500">
                      No attendance records match these filters.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </template>
        <section
          class="space-y-4 border-t border-gray-200 pt-6 dark:border-gray-800"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="text-lg font-semibold">
                Imported Google Meet Attendance
              </h2>
              <p class="text-sm text-gray-500">
                Attendance already saved in the dedicated database tables.
              </p>
            </div>
            <UButton
              :label="
                importedAttendance
                  ? 'Refresh Imported Data'
                  : 'Load Imported Data'
              "
              icon="i-lucide-refresh-cw"
              color="primary"
              variant="outline"
              size="sm"
              :loading="importedAttendanceLoading"
              @click="loadImportedAttendance"
            />
          </div>

          <UAlert
            color="info"
            variant="subtle"
            title="Separate and read-only"
            description="These totals come from the imported Google Meet attendance tables. This dashboard does not merge data into or modify the existing Canvas Masters roster."
            icon="i-lucide-database"
          />

          <UAlert
            v-if="importedAttendanceError"
            color="error"
            variant="subtle"
            title="Could not load imported attendance"
            :description="importedAttendanceError"
          />

          <div
            v-if="importedAttendanceLoading && !importedAttendance"
            class="py-6 text-sm text-gray-500"
          >
            Loading imported attendance from the database...
          </div>

          <template v-if="importedAttendance">
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <UCard>
                <p class="text-sm text-gray-500">Students</p>
                <p class="mt-2 text-2xl font-semibold">
                  {{ importedAttendance.summary.students.toLocaleString() }}
                </p>
              </UCard>
              <UCard>
                <p class="text-sm text-gray-500">
                  Meetings in displayed records
                </p>
                <p class="mt-2 text-2xl font-semibold">
                  {{ importedAttendance.summary.meetings.toLocaleString() }}
                </p>
              </UCard>
              <UCard>
                <p class="text-sm text-gray-500">Attendance records</p>
                <p class="mt-2 text-2xl font-semibold">
                  {{
                    importedAttendance.summary.attendanceRecords.toLocaleString()
                  }}
                </p>
              </UCard>
              <UCard>
                <p class="text-sm text-gray-500">Total attendance duration</p>
                <p class="mt-2 text-2xl font-semibold">
                  {{
                    Math.round(
                      importedAttendance.summary.totalDurationMinutes,
                    ).toLocaleString()
                  }}
                  min
                </p>
              </UCard>
            </div>

            <UAlert
              v-if="importedAttendance.recordLimitReached"
              color="warning"
              variant="subtle"
              title="Record display limit reached"
              :description="
                'Showing the first ' +
                importedAttendance.recordLimit.toLocaleString() +
                ' meeting records. The record table may not include every stored record.'
              "
            />

            <section class="space-y-3">
              <h3 class="font-semibold">Student attendance totals</h3>
              <div
                class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800"
              >
                <table
                  class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800"
                >
                  <thead class="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th class="px-3 py-3 text-left font-medium">Student</th>
                      <th class="px-3 py-3 text-left font-medium">Email</th>
                      <th class="px-3 py-3 text-right font-medium">Meetings</th>
                      <th class="px-3 py-3 text-right font-medium">
                        Duration (min)
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200 dark:divide-gray-800">
                    <tr
                      v-for="student in importedAttendance.students"
                      :key="student.email"
                    >
                      <td class="px-3 py-3">
                        {{
                          [student.first_name, student.last_name]
                            .filter(Boolean)
                            .join(" ") || "—"
                        }}
                      </td>
                      <td class="px-3 py-3">{{ student.email }}</td>
                      <td class="px-3 py-3 text-right">
                        {{ student.meetings_attended }}
                      </td>
                      <td class="px-3 py-3 text-right">
                        {{
                          Number(
                            student.total_duration_minutes,
                          ).toLocaleString()
                        }}
                      </td>
                    </tr>
                    <tr v-if="importedAttendance.students.length === 0">
                      <td
                        colspan="4"
                        class="px-3 py-6 text-center text-gray-500"
                      >
                        No imported student totals found.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section class="space-y-3">
              <h3 class="font-semibold">Individual meeting records</h3>
              <div
                class="max-h-96 overflow-auto rounded-lg border border-gray-200 dark:border-gray-800"
              >
                <table
                  class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800"
                >
                  <thead class="sticky top-0 bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th class="px-3 py-3 text-left font-medium">
                        Meeting date
                      </th>
                      <th class="px-3 py-3 text-left font-medium">Student</th>
                      <th class="px-3 py-3 text-left font-medium">Email</th>
                      <th class="px-3 py-3 text-right font-medium">
                        Duration (min)
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200 dark:divide-gray-800">
                    <tr
                      v-for="record in importedAttendance.records"
                      :key="record.meeting_id + ':' + record.email"
                    >
                      <td class="whitespace-nowrap px-3 py-3">
                        {{ new Date(record.meeting_at).toLocaleString() }}
                      </td>
                      <td class="px-3 py-3">
                        {{
                          [record.first_name, record.last_name]
                            .filter(Boolean)
                            .join(" ") || "—"
                        }}
                      </td>
                      <td class="px-3 py-3">{{ record.email }}</td>
                      <td class="px-3 py-3 text-right">
                        {{ Number(record.duration_minutes).toLocaleString() }}
                      </td>
                    </tr>
                    <tr v-if="importedAttendance.records.length === 0">
                      <td
                        colspan="4"
                        class="px-3 py-6 text-center text-gray-500"
                      >
                        No imported meeting records found.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </template>
        </section>
      </div>
    </template>
  </UDashboardPanel>
</template>
