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

const preview = ref<PreviewResponse | null>(null);
const loading = ref(false);
const errorMessage = ref("");

async function loadPreview() {
  if (loading.value) return;
  loading.value = true;
  errorMessage.value = "";

  try {
    preview.value = await $fetch<PreviewResponse>(
      "/api/admin/canvas-masters/attendance-preview",
    );
  } catch (error: any) {
    errorMessage.value =
      error?.data?.statusMessage ||
      error?.statusMessage ||
      "Could not load the attendance preview. Check the server configuration and logs.";
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
  await loadPreview();
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

const allAttendees = computed(() =>
  (preview.value?.reports ?? []).flatMap((report) =>
    (report.attendees ?? []).map((attendee) => ({
      ...attendee,
      reportStatus: report.status,
      reportDetail: report.detail ?? "",
    })),
  ),
);

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
            :label="preview ? 'Refresh Preview' : 'Load Preview'"
            icon="i-lucide-refresh-cw"
            color="primary"
            size="sm"
            :loading="loading"
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
          description="This page reads Google Meet report emails and linked attendance sheets. It does not modify the Canvas Masters roster or sync attendance."
          icon="i-lucide-eye"
        />

        <UAlert
          v-if="errorMessage"
          color="error"
          variant="subtle"
          title="Could not load attendance preview"
          :description="errorMessage"
        />

        <div
          v-if="loading && !preview"
          class="flex items-center gap-3 py-8 text-sm text-gray-500"
        >
          <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
          Reading Google Meet reports and attendance sheets. This may take a
          little while.
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
      </div>
    </template>
  </UDashboardPanel>
</template>
