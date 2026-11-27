<script setup>
const props = defineProps({
  student: {
    type: Object,
    required: true,
  },
})

const attendance = ref(null)
const loading = ref(true)
const error = ref(null)
const selectedPeriod = ref('')

function amsterdamToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function currentPeriodStart() {
  const [year, month] = amsterdamToday().split('-').map(Number)

  if (month >= 4 && month <= 9) return `${year}-04-01`
  if (month >= 10) return `${year}-10-01`
  return `${year - 1}-10-01`
}

function nextPeriodStart(start) {
  const [year, month] = start.split('-').map(Number)
  return month === 4
    ? `${year}-10-01`
    : `${year + 1}-04-01`
}

function periodLabel(start) {
  const [year, month] = start.split('-').map(Number)
  return month === 4
    ? `1 April – 30 September ${year}`
    : `1 October ${year} – 31 March ${year + 1}`
}

const periodOptions = computed(() => {
  const options = []
  const currentPeriod = currentPeriodStart()
  let cursor = '2023-04-01'

  while (cursor <= currentPeriod) {
    options.push({
      label: periodLabel(cursor),
      value: cursor,
    })
    cursor = nextPeriodStart(cursor)
  }

  return options
})

let attendanceRequestId = 0

async function fetchAttendance(periodStart) {
  const studentId = props.student?.id
  const requestId = ++attendanceRequestId

  if (!studentId) {
    attendance.value = null
    loading.value = false
    return
  }

  loading.value = true
  error.value = null

  try {
    const query = periodStart
      ? `?periodStart=${encodeURIComponent(periodStart)}`
      : ''

    const response = await $fetch(
      `/api/students/${studentId}/cohort-attendance${query}`,
    )

    if (requestId !== attendanceRequestId) return

    attendance.value = response || null

    if (response?.period?.startDate) {
      selectedPeriod.value = response.period.startDate
    }
  } catch (err) {
    if (requestId !== attendanceRequestId) return

    attendance.value = null
    error.value =
      err?.data?.statusMessage ||
      err?.statusMessage ||
      err?.message ||
      'Unable to load this student’s attendance.'
  } finally {
    if (requestId === attendanceRequestId) {
      loading.value = false
    }
  }
}

function changePeriod() {
  if (!selectedPeriod.value) return
  fetchAttendance(selectedPeriod.value)
}

watch(
  () => props.student?.id,
  () => {
    selectedPeriod.value = ''
    attendance.value = null
    fetchAttendance()
  },
  { immediate: true },
)

const lowStakes = computed(() => attendance.value?.low_stakes || null)
const metrics = computed(() => attendance.value?.attendance || null)
const audit = computed(() => attendance.value?.audit || null)

const cohortStats = computed(() => {
  if (!metrics.value) return []

  const a = metrics.value

  return [
    { label: 'Workshops', ...a.workshops },
    { label: 'Mentoring', ...a.mentoring },
    { label: 'Stand-ups', ...a.standups },
    { label: 'Squad Meetings', ...a.squad_meetings },
    { label: 'Overall', ...a.overall },
  ]
})

const scheduledStats = computed(() => {
  if (!metrics.value?.scheduled) return []

  const scheduled = metrics.value.scheduled

  return [
    { label: 'Workshops', ...scheduled.workshops },
    { label: 'Mentoring', ...scheduled.mentoring },
    { label: 'Stand-ups', ...scheduled.standups },
    { label: 'Squad Meetings', ...scheduled.squad_meetings },
  ]
})

function formatAuditReason(reason) {
  const labels = {
    live_status_blank: 'Live attendance status was blank',
    live_status_unavailable: 'Live-attendance field unavailable in source',
    session_type_not_points_eligible: 'Session type does not count toward attendance points',
    season_schedule_gap: 'No matching Season schedule',
    session_date_in_future: 'Session date is in the future',
    session_date_missing: 'Session date missing',
    student_email_not_found: 'Student could not be matched',
  }

  if (!reason) return 'No reason recorded'
  return labels[reason] || reason.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase())
}

function formatSessionType(type) {
  return ({
    workshop: 'Workshop',
    mentoring: 'Mentoring',
    standup: 'Stand-up',
    squad_meeting: 'Squad Meeting',
    unknown: 'Unknown session type',
  })[type] || type?.replaceAll('_', ' ')
}

function formatEligibilityStatus(status) {
  return status === 'unresolved' ? 'Unresolved' : 'Excluded'
}

function formatPercent(value) {
  return value == null ? '—' : `${Number(value)}%`
}

function formatCount(value) {
  return value == null ? '—' : Number(value).toLocaleString()
}

function formatPoints(value) {
  return Number(value || 0).toLocaleString('en-GB', {
    maximumFractionDigits: 2,
  })
}

function formatDate(value) {
  if (!value) return '—'

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Amsterdam',
  }).format(new Date(`${value.slice(0, 10)}T12:00:00`))
}

function coverageLabel(status) {
  const labels = {
    matched: 'Programme calendar coverage matched',
    unmatched: 'No matching programme calendar coverage',
    not_applicable: 'Calendar coverage not applicable to this programme',
  }

  return labels[status] || 'Calendar coverage status unavailable'
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-clipboard-check" class="size-4 text-muted" />
          <h3 class="text-sm font-medium text-highlighted">Low-stakes evidence</h3>
        </div>

        <div v-if="lowStakes" class="flex flex-wrap items-center gap-2">
          <label for="student-low-stakes-period" class="text-xs text-muted">
            Reporting period
          </label>
          <select
            id="student-low-stakes-period"
            v-model="selectedPeriod"
            class="min-w-56 rounded-md border border-default bg-default px-3 py-2 text-xs text-highlighted"
            :disabled="loading"
            @change="changePeriod"
          >
            <option
              v-for="option in periodOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </div>
      </div>

      <div v-if="loading" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <USkeleton v-for="i in 4" :key="i" class="h-24 w-full rounded-lg" />
      </div>

      <div v-else-if="error" class="rounded-lg border border-error/30 p-4 text-sm text-error">
        Couldn't load this student's attendance: {{ error }}
      </div>

      <template v-else-if="attendance">
        <template v-if="lowStakes">
          <div class="mb-3">
            <p class="text-xs text-muted">
              Bachelor 140-point management target · {{ lowStakes.period.label }}
            </p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <UCard variant="subtle">
              <p class="text-xs font-medium uppercase text-muted">Eligible attendance</p>
              <p class="mt-2 text-2xl font-semibold text-highlighted">
                {{ formatPoints(lowStakes.attendance_points) }}
              </p>
              <p class="mt-1 text-xs text-muted">Points in this reporting period</p>
            </UCard>

            <UCard variant="subtle">
              <p class="text-xs font-medium uppercase text-muted">Verified Case Study Forum</p>
              <p class="mt-2 text-2xl font-semibold text-highlighted">
                {{ formatPoints(lowStakes.verified_forum_points) }}
              </p>
              <p class="mt-1 text-xs text-muted">
                {{ lowStakes.forum_presenter_count }} presenter ·
                {{ lowStakes.forum_participant_count }} participant records
              </p>
            </UCard>

            <UCard variant="subtle">
              <p class="text-xs font-medium uppercase text-muted">Total low-stakes points</p>
              <p class="mt-2 text-2xl font-semibold text-highlighted">
                {{ formatPoints(lowStakes.total_points) }}
                <span class="text-sm font-normal text-muted">/ {{ lowStakes.target_points }}</span>
              </p>
              <div class="mt-2 h-2 overflow-hidden rounded-full bg-elevated">
                <div
                  class="h-full rounded-full bg-primary transition-all"
                  :style="{ width: `${Math.min(100, (lowStakes.total_points / lowStakes.target_points) * 100)}%` }"
                />
              </div>
            </UCard>

            <UCard variant="subtle">
              <p class="text-xs font-medium uppercase text-muted">Target status</p>
              <p
                class="mt-2 text-xl font-semibold"
                :class="lowStakes.target_met ? 'text-success' : 'text-warning'"
              >
                {{ lowStakes.target_met ? 'Target met' : 'Below target' }}
              </p>
              <p class="mt-1 text-xs text-muted">
                {{ lowStakes.target_met
                  ? `${formatPoints(lowStakes.surplus_points)} points above target`
                  : `${formatPoints(lowStakes.shortfall_points)} points remaining` }}
              </p>
            </UCard>
          </div>

          <p class="mt-2 text-xs text-muted">
            Only eligible attendance ledger points and verified Case Study Forum records count.
            Pending and rejected forum records contribute zero.
          </p>
        </template>

        <div v-else class="rounded-lg border border-default p-4">
          <p class="text-sm font-medium text-highlighted">
            The 140-point Bachelor management target does not apply to this student's programme.
          </p>
        </div>
      </template>
    </div>

    <div v-if="!loading && !error && metrics" class="space-y-4">
      <div>
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h4 class="text-sm font-semibold text-highlighted">
            Scheduled-session attendance to date
          </h4>
          <p class="text-xs text-muted">
            Through {{ formatDate(metrics.reporting_date) }}
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <UCard
            v-for="stat in scheduledStats"
            :key="stat.label"
            variant="subtle"
          >
            <p class="text-xs font-medium uppercase text-muted">{{ stat.label }}</p>
            <p class="mt-2 text-xl font-semibold text-highlighted">
              {{ formatPercent(stat.percent) }}
            </p>
            <p class="mt-1 text-xs text-muted">
              {{ formatCount(stat.attended) }} attended /
              {{ formatCount(stat.total) }} scheduled
            </p>
          </UCard>
        </div>

        <p class="mt-2 text-xs text-muted">
          Future calendar weeks are excluded from scheduled opportunities.
          {{ coverageLabel(metrics.calendar_coverage_status) }}.
        </p>
      </div>

      <div>
        <h4 class="mb-1 text-sm font-semibold text-highlighted">
          Cohort-relative attendance comparison
        </h4>
        <p class="mb-3 text-xs text-muted">
          Each percentage compares this student's attendance count with the highest count
          in the cohort. These percentages are not awarded points.
        </p>

        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
          <UCard
            v-for="stat in cohortStats"
            :key="stat.label"
            variant="subtle"
          >
            <p class="text-xs font-medium uppercase text-muted">{{ stat.label }}</p>
            <p class="mt-2 text-xl font-semibold text-highlighted">
              {{ formatPercent(stat.percent) }}
            </p>
            <p class="mt-1 text-xs text-muted">
              {{ formatCount(stat.count) }} / {{ formatCount(stat.max) }}
              cohort maximum
            </p>
          </UCard>
        </div>
      </div>

      <div>
        <h4 class="mb-1 text-sm font-semibold text-highlighted">
          Actual attendance ledger points
        </h4>
        <p class="text-xs text-muted">
          {{ metrics.actual_points == null
            ? 'An actual attendance ledger total is not available for this programme.'
            : `${formatPoints(metrics.actual_points)} eligible points awarded all-time. This is separate from the selected six-month target.` }}
        </p>
      </div>
    </div>

    <div
      v-if="!loading && !error && audit?.uses_ledger"
      class="rounded-lg border border-default p-4 space-y-4"
    >
      <div>
        <h4 class="text-sm font-semibold text-highlighted">Attendance audit</h4>
        <p class="mt-1 text-xs text-muted">
          Unverified submissions are shown for review and do not contribute to eligible attendance points.
        </p>
      </div>

      <div>
        <div class="mb-2 flex items-center justify-between gap-2">
          <p class="text-sm font-medium text-highlighted">Unverified submissions</p>
          <UBadge color="warning" variant="subtle">
            {{ audit.unverified_total }} records
          </UBadge>
        </div>

        <p v-if="!audit.unverified_by_reason.length" class="text-sm text-muted">
          No student-associated unverified submissions were found.
        </p>

        <div v-else class="divide-y divide-default">
          <div
            v-for="(item, index) in audit.unverified_by_reason"
            :key="`${item.eligibility_status}-${item.reason}-${item.session_type}-${index}`"
            class="flex flex-wrap justify-between gap-2 py-3"
          >
            <div>
              <p class="text-sm font-medium text-highlighted">
                {{ formatAuditReason(item.reason) }}
              </p>
              <p class="mt-1 text-xs text-muted">
                {{ formatEligibilityStatus(item.eligibility_status) }} ·
                {{ formatSessionType(item.session_type) }}
              </p>
            </div>
            <span class="text-sm font-semibold tabular-nums">{{ item.count }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
