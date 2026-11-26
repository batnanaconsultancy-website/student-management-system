<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

definePageMeta({
  layout: 'default',
  middleware: ['assessment-staff'],
})

type StudentRow = {
  student_id: string
  name: string
  email: string
  program_id: string
  cohort_id: string
  program: string
  cohort: string
  attendance_points: number
  all_time_attendance_points: number
  verified_forum_points: number
  forum_presenter_count: number
  forum_participant_count: number
  total_points: number
  target_points: number
  shortfall_points: number
  surplus_points: number
  target_met: boolean
}

type ForumRecord = {
  id: string
  event_id: string
  student_id: string
  participation_role: 'presenter' | 'participant'
  evidence_reference: string
  submission_note?: string | null
  points_awarded: number
  verification_status: 'pending' | 'verified' | 'rejected'
  submitted_by_email: string
  submitted_at: string
  verified_by_email?: string | null
  verified_at?: string | null
  rejected_by_email?: string | null
  rejected_at?: string | null
  review_note?: string | null
  student: {
    id: string
    name: string
    email: string
    program_id: string
    cohort_id: string
  }
}

type ForumEvent = {
  id: string
  event_title: string
  event_date: string
  event_reference?: string | null
  description?: string | null
  created_by_email: string
  created_at: string
  updated_at: string
  records: ForumRecord[]
}

type ManagementPermissions = {
  canCreateEvents: boolean
  canReviewRecords: boolean
  canDeleteEvents: boolean
  canSubmitRecords: boolean
}

const loading = ref(true)
const saving = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

const pointsResponse = ref<any>(null)
const events = ref<ForumEvent[]>([])
const permissions = ref<ManagementPermissions>({
  canCreateEvents: false,
  canReviewRecords: false,
  canDeleteEvents: false,
  canSubmitRecords: false,
})

const selectedPeriod = ref('')
const selectedProgramId = ref('')
const selectedCohortId = ref('')
const studentSearch = ref('')
const recordSearch = ref('')

const showEventForm = ref(false)
const showSubmissionForm = ref(false)

const eventForm = ref({
  event_title: '',
  event_date: '',
  event_reference: '',
  description: '',
})

const submissionForm = ref({
  event_id: '',
  student_id: '',
  participation_role: 'participant' as 'presenter' | 'participant',
  evidence_reference: '',
  submission_note: '',
})

const reviewNote = ref('')

const students = computed<StudentRow[]>(() => pointsResponse.value?.data || [])
const period = computed(() => pointsResponse.value?.period || null)
const target = computed(() => Number(pointsResponse.value?.target_points || 140))

const programOptions = computed(() => {
  const options = new Map<string, string>()

  for (const student of students.value) {
    if (student.program_id) {
      options.set(student.program_id, student.program || 'Unnamed programme')
    }
  }

  return Array.from(options, ([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
})

const cohortOptions = computed(() => {
  const options = new Map<string, string>()

  for (const student of students.value) {
    if (
      student.cohort_id &&
      (!selectedProgramId.value || student.program_id === selectedProgramId.value)
    ) {
      options.set(student.cohort_id, student.cohort || 'Unnamed cohort')
    }
  }

  return Array.from(options, ([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
})

const scopedStudents = computed(() =>
  students.value.filter(student =>
    (!selectedProgramId.value || student.program_id === selectedProgramId.value) &&
    (!selectedCohortId.value || student.cohort_id === selectedCohortId.value),
  ),
)

const studentCount = computed(() => scopedStudents.value.length)
const targetMetCount = computed(() =>
  scopedStudents.value.filter(student => student.target_met).length,
)
const targetNotMetCount = computed(() =>
  scopedStudents.value.filter(student => !student.target_met).length,
)
const pendingCount = computed(() =>
  events.value.reduce(
    (total, item) =>
      total + item.records.filter(record => record.verification_status === 'pending').length,
    0,
  ),
)

const averagePoints = computed(() => {
  if (!scopedStudents.value.length) return 0
  return Math.round(
    scopedStudents.value.reduce((sum, student) => sum + student.total_points, 0) /
      scopedStudents.value.length,
  )
})

const filteredStudents = computed(() => {
  const query = studentSearch.value.trim().toLowerCase()
  if (!query) return scopedStudents.value

  return scopedStudents.value.filter(student =>
    [
      student.name,
      student.email,
      student.program,
      student.cohort,
    ].some(value => String(value || '').toLowerCase().includes(query)),
  )
})

function changeProgram() {
  selectedCohortId.value = ''
}

const filteredEvents = computed(() => {
  const query = recordSearch.value.trim().toLowerCase()
  if (!query) return events.value

  return events.value
    .map(item => ({
      ...item,
      records: item.records.filter(record =>
        [
          record.student?.name,
          record.student?.email,
          record.participation_role,
          record.verification_status,
          record.evidence_reference,
        ].some(value => String(value || '').toLowerCase().includes(query)),
      ),
    }))
    .filter(item =>
      item.event_title.toLowerCase().includes(query) ||
      item.records.length > 0,
    )
})

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

function nextPeriodStart(start: string) {
  const [year, month] = start.split('-').map(Number)
  return month === 4
    ? `${year}-10-01`
    : `${year + 1}-04-01`
}

function periodLabel(start: string) {
  const [year, month] = start.split('-').map(Number)
  return month === 4
    ? `1 April – 30 September ${year}`
    : `1 October ${year} – 31 March ${year + 1}`
}

const periodOptions = computed(() => {
  if (!period.value?.startDate) return []

  const firstPeriod = '2023-04-01'
  const currentPeriod = currentPeriodStart()
  const options: Array<{ label: string; value: string }> = []
  let cursor = firstPeriod

  while (cursor <= currentPeriod) {
    options.push({ label: periodLabel(cursor), value: cursor })
    cursor = nextPeriodStart(cursor)
  }

  return options
})

function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Amsterdam',
  }).format(date)
}

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Amsterdam',
  }).format(new Date(value))
}

function statusColor(status: string) {
  if (status === 'verified') return 'success'
  if (status === 'rejected') return 'error'
  if (status === 'pending') return 'warning'
  return 'neutral'
}

async function loadPoints(periodStart?: string) {
  const query = periodStart
    ? `?periodStart=${encodeURIComponent(periodStart)}`
    : ''

  pointsResponse.value = await $fetch(`/api/assessment-management/bachelor-points${query}`)

  if (!selectedPeriod.value && pointsResponse.value?.period?.startDate) {
    selectedPeriod.value = pointsResponse.value.period.startDate
  }
}

async function loadEvents() {
  const response: any = await $fetch('/api/assessment-management/events')
  events.value = response.data || []
  permissions.value = response.permissions || {
    canCreateEvents: false,
    canReviewRecords: false,
    canDeleteEvents: false,
    canSubmitRecords: false,
  }
}

async function loadAll(periodStart?: string) {
  loading.value = true
  errorMessage.value = ''

  try {
    await Promise.all([
      loadPoints(periodStart),
      loadEvents(),
    ])
  } catch (error: any) {
    errorMessage.value =
      error?.data?.statusMessage ||
      error?.statusMessage ||
      'Unable to load Bachelor assessment management data.'
  } finally {
    loading.value = false
  }
}

async function changePeriod() {
  if (!selectedPeriod.value) return
  loading.value = true
  errorMessage.value = ''

  try {
    await loadPoints(selectedPeriod.value)
  } catch (error: any) {
    errorMessage.value =
      error?.data?.statusMessage ||
      error?.statusMessage ||
      'Unable to load the selected reporting period.'
  } finally {
    loading.value = false
  }
}

async function createEvent() {
  saving.value = true
  errorMessage.value = ''
  successMessage.value = ''

  try {
    await $fetch('/api/assessment-management/events', {
      method: 'POST',
      body: {
        event_title: eventForm.value.event_title,
        event_date: eventForm.value.event_date,
        event_reference: eventForm.value.event_reference || null,
        description: eventForm.value.description || null,
      },
    })

    eventForm.value = {
      event_title: '',
      event_date: amsterdamToday(),
      event_reference: '',
      description: '',
    }
    showEventForm.value = false
    successMessage.value = 'Case Study Forum event created.'
    await loadEvents()
  } catch (error: any) {
    errorMessage.value =
      error?.data?.statusMessage ||
      error?.statusMessage ||
      'Unable to create the event.'
  } finally {
    saving.value = false
  }
}

async function deleteEvent(item: ForumEvent) {
  const originalEvent = events.value.find(event => event.id === item.id)
  const recordCount = originalEvent?.records.length ?? item.records.length

  const confirmed = window.confirm(
    `Delete the Case Study Forum event "${item.event_title}" (${formatDate(item.event_date)})?\n\n` +
    `${recordCount} associated participation record(s) will also be permanently deleted, including pending, verified, and rejected records.\n\n` +
    `Any verified forum points awarded to affected students will be removed from their totals.\n\n` +
    `The audit history of this deletion will be retained. This action cannot be undone.`
  )

  if (!confirmed) return

  saving.value = true
  errorMessage.value = ''
  successMessage.value = ''

  try {
    const response: any = await $fetch(
      `/api/assessment-management/events/${item.id}`,
      { method: 'DELETE' }
    )

    await loadAll(selectedPeriod.value)

    const deletedCount = response?.data?.deleted_record_count ?? recordCount
    successMessage.value =
      `Case Study Forum event "${item.event_title}" and ${deletedCount} participation record(s) deleted. Audit history retained.`
  } catch (error: any) {
    errorMessage.value =
      error?.data?.statusMessage ||
      error?.statusMessage ||
      'Unable to delete the Case Study Forum event.'
  } finally {
    saving.value = false
  }
}

async function submitParticipation() {
  saving.value = true
  errorMessage.value = ''
  successMessage.value = ''

  try {
    await $fetch('/api/assessment-management/records', {
      method: 'POST',
      body: {
        event_id: submissionForm.value.event_id,
        student_id: submissionForm.value.student_id,
        participation_role: submissionForm.value.participation_role,
        evidence_reference: submissionForm.value.evidence_reference,
        submission_note: submissionForm.value.submission_note || null,
      },
    })

    submissionForm.value = {
      event_id: '',
      student_id: '',
      participation_role: 'participant',
      evidence_reference: '',
      submission_note: '',
    }
    showSubmissionForm.value = false
    successMessage.value = 'Participation submitted for verification. Pending records do not contribute points.'
    await loadAll(selectedPeriod.value)
  } catch (error: any) {
    errorMessage.value =
      error?.data?.statusMessage ||
      error?.statusMessage ||
      'Unable to submit participation.'
  } finally {
    saving.value = false
  }
}

async function reviewRecord(record: ForumRecord, decision: 'verified' | 'rejected') {
  const action = decision === 'verified' ? 'verify' : 'reject'

  if (!window.confirm(`Are you sure you want to ${action} this participation record?`)) {
    return
  }

  saving.value = true
  errorMessage.value = ''
  successMessage.value = ''

  try {
    await $fetch(`/api/assessment-management/records/${record.id}/review`, {
      method: 'POST',
      body: {
        decision,
        review_note: reviewNote.value || null,
      },
    })

    reviewNote.value = ''
    successMessage.value = `Participation record ${decision}.`
    await loadAll(selectedPeriod.value)
  } catch (error: any) {
    errorMessage.value =
      error?.data?.statusMessage ||
      error?.statusMessage ||
      `Unable to ${action} this record.`
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  eventForm.value.event_date = amsterdamToday()
  await loadAll()
})
</script>

<template>
  <UDashboardPanel id="assessment-management">
    <template #header>
      <UDashboardNavbar title="Bachelor Assessment Management">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-6">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 class="text-xl font-semibold text-highlighted">
              Bachelor Assessment Management
            </h2>
            <p class="mt-1 text-sm text-muted">
              Monitor six-month low-stakes points and manage Case Study Forum participation evidence.
            </p>
          </div>

          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-refresh-cw"
            :loading="loading"
            @click="loadAll(selectedPeriod || undefined)"
          >
            Refresh
          </UButton>
        </div>

        <UAlert
          color="info"
          variant="subtle"
          title="Separate low-stakes management indicator"
          description="The target is 140 points per six-month reporting period, combining eligible attendance points and verified Case Study Forum points. This administrative indicator is separate from formal assessment evidence, progression thresholds and progression decisions. Pending or rejected forum records contribute zero points."
        />

        <UAlert
          v-if="errorMessage"
          color="error"
          variant="subtle"
          title="Action could not be completed"
          :description="errorMessage"
        />

        <UAlert
          v-if="successMessage"
          color="success"
          variant="subtle"
          :description="successMessage"
        />

        <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 class="font-semibold text-highlighted">Six-month points report</h3>
            <p class="text-sm text-muted">
              {{ period?.label || 'Loading reporting period…' }}
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <div class="flex items-center gap-2">
              <label for="assessment-programme" class="text-sm text-muted">Programme</label>
              <select
                id="assessment-programme"
                v-model="selectedProgramId"
                class="min-w-48 rounded-md border border-default bg-default px-3 py-2 text-sm text-highlighted"
                :disabled="loading || !programOptions.length"
                @change="changeProgram"
              >
                <option value="">All Programmes</option>
                <option
                  v-for="option in programOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </div>

            <div class="flex items-center gap-2">
              <label for="assessment-cohort" class="text-sm text-muted">Cohort</label>
              <select
                id="assessment-cohort"
                v-model="selectedCohortId"
                class="min-w-40 rounded-md border border-default bg-default px-3 py-2 text-sm text-highlighted"
                :disabled="loading || !cohortOptions.length"
              >
                <option value="">All Cohorts</option>
                <option
                  v-for="option in cohortOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </div>

            <div class="flex items-center gap-2">
              <label for="reporting-period" class="text-sm text-muted">Reporting period</label>
              <select
                id="reporting-period"
                v-model="selectedPeriod"
                class="min-w-64 rounded-md border border-default bg-default px-3 py-2 text-sm text-highlighted"
                :disabled="loading || !periodOptions.length"
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
        </div>

        <div v-if="loading && !pointsResponse" class="py-12 text-center text-sm text-muted">
          Loading Bachelor assessment data…
        </div>

        <template v-else>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <UCard>
              <p class="text-sm text-muted">Bachelor students in scope</p>
              <p class="mt-2 text-3xl font-semibold text-highlighted">{{ studentCount }}</p>
            </UCard>

            <UCard>
              <p class="text-sm text-muted">Met {{ target }}-point target</p>
              <p class="mt-2 text-3xl font-semibold text-success">{{ targetMetCount }}</p>
              <p class="mt-1 text-xs text-muted">
                {{ studentCount ? Math.round((targetMetCount / studentCount) * 100) : 0 }}% of students
              </p>
            </UCard>

            <UCard>
              <p class="text-sm text-muted">Below target</p>
              <p class="mt-2 text-3xl font-semibold text-warning">{{ targetNotMetCount }}</p>
            </UCard>

            <UCard>
              <p class="text-sm text-muted">Average points</p>
              <p class="mt-2 text-3xl font-semibold text-highlighted">{{ averagePoints }}</p>
              <p class="mt-1 text-xs text-muted">Out of {{ target }} target points</p>
            </UCard>
          </div>

          <UCard>
            <template #header>
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 class="font-semibold text-highlighted">Student points register</h3>
                  <p class="text-sm text-muted">
                    Eligible attendance and verified forum points within the selected period only.
                  </p>
                </div>
                <UInput
                  v-model="studentSearch"
                  icon="i-lucide-search"
                  placeholder="Search students…"
                  class="w-full sm:max-w-xs"
                />
              </div>
            </template>

            <div class="overflow-x-auto">
              <table class="w-full min-w-[1150px] text-sm">
                <thead>
                  <tr class="border-b border-default text-left text-muted">
                    <th class="px-3 py-3 font-medium">Student</th>
                    <th class="px-3 py-3 font-medium">Programme / Cohort</th>
                    <th class="px-3 py-3 text-right font-medium">All-time attendance</th>
                    <th class="px-3 py-3 text-right font-medium">Semester attendance</th>
                    <th class="px-3 py-3 text-right font-medium">Verified forum</th>
                    <th class="px-3 py-3 text-right font-medium">Total / {{ target }}</th>
                    <th class="px-3 py-3 text-right font-medium">Shortfall</th>
                    <th class="px-3 py-3 text-right font-medium">Surplus</th>
                    <th class="px-3 py-3 text-right font-medium">Target status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="student in filteredStudents"
                    :key="student.student_id"
                    class="border-b border-default last:border-0"
                  >
                    <td class="px-3 py-3">
                      <p class="font-medium text-highlighted">{{ student.name || 'Unnamed student' }}</p>
                      <p class="text-xs text-muted">{{ student.email }}</p>
                    </td>
                    <td class="px-3 py-3">
                      <p>{{ student.program || '—' }}</p>
                      <p class="text-xs text-muted">{{ student.cohort || '—' }}</p>
                    </td>
                    <td class="px-3 py-3 text-right tabular-nums">{{ student.all_time_attendance_points }}</td>
                    <td class="px-3 py-3 text-right tabular-nums">{{ student.attendance_points }}</td>
                    <td class="px-3 py-3 text-right tabular-nums">
                      <div>{{ student.verified_forum_points }}</div>
                      <p class="text-xs text-muted">
                        {{ student.forum_presenter_count }} presenter ·
                        {{ student.forum_participant_count }} participant
                      </p>
                    </td>
                    <td class="px-3 py-3 text-right font-semibold tabular-nums">
                      {{ student.total_points }}
                    </td>
                    <td class="px-3 py-3 text-right tabular-nums">{{ student.shortfall_points }}</td>
                    <td class="px-3 py-3 text-right tabular-nums">{{ student.surplus_points }}</td>
                    <td class="px-3 py-3 text-right">
                      <UBadge
                        :color="student.target_met ? 'success' : 'warning'"
                        variant="subtle"
                      >
                        {{ student.target_met ? 'Met' : 'Not met' }}
                      </UBadge>
                    </td>
                  </tr>
                  <tr v-if="!filteredStudents.length">
                    <td colspan="9" class="px-3 py-8 text-center text-muted">
                      No students match this search.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </UCard>
        </template>

        <UCard>
          <template #header>
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 class="font-semibold text-highlighted">Case Study Forum register</h3>
                <p class="text-sm text-muted">
                  Presenter: 5 points · Participant: 2 points · Only verified records count.
                </p>
              </div>
              <div class="flex flex-wrap gap-2">
                <UButton
                  v-if="permissions.canCreateEvents"
                  color="primary"
                  icon="i-lucide-calendar-plus"
                  @click="showEventForm = !showEventForm"
                >
                  {{ showEventForm ? 'Close event form' : 'Create event' }}
                </UButton>
                <UButton
                  v-if="permissions.canSubmitRecords"
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-file-plus"
                  :disabled="!events.length || !students.length"
                  @click="showSubmissionForm = !showSubmissionForm"
                >
                  {{ showSubmissionForm ? 'Close submission' : 'Submit participation' }}
                </UButton>
              </div>
            </div>
          </template>

          <div
            v-if="showEventForm && permissions.canCreateEvents"
            class="mb-6 rounded-lg border border-default p-4"
          >
            <h4 class="mb-3 font-semibold text-highlighted">Create Case Study Forum event</h4>
            <form class="grid grid-cols-1 gap-3 md:grid-cols-2" @submit.prevent="createEvent">
              <UFormField label="Event title" required>
                <UInput v-model="eventForm.event_title" required maxlength="200" class="w-full" />
              </UFormField>
              <UFormField label="Event date" required>
                <UInput v-model="eventForm.event_date" type="date" required class="w-full" />
              </UFormField>
              <UFormField label="Event reference">
                <UInput
                  v-model="eventForm.event_reference"
                  maxlength="1000"
                  placeholder="Optional URL or reference"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Description">
                <UInput v-model="eventForm.description" maxlength="5000" class="w-full" />
              </UFormField>
              <div class="md:col-span-2">
                <UButton type="submit" :loading="saving" :disabled="!eventForm.event_title.trim() || !eventForm.event_date">
                  Save event
                </UButton>
              </div>
            </form>
          </div>

          <div
            v-if="showSubmissionForm && permissions.canSubmitRecords"
            class="mb-6 rounded-lg border border-default p-4"
          >
            <h4 class="mb-3 font-semibold text-highlighted">Submit student participation</h4>
            <p class="mb-3 text-sm text-muted">
              Submissions remain pending until an administrator or active Assessment Manager verifies them.
            </p>
            <form class="grid grid-cols-1 gap-3 md:grid-cols-2" @submit.prevent="submitParticipation">
              <UFormField label="Forum event" required>
                <select
                  v-model="submissionForm.event_id"
                  required
                  class="w-full rounded-md border border-default bg-default px-3 py-2 text-sm"
                >
                  <option value="" disabled>Select an event</option>
                  <option v-for="item in events" :key="item.id" :value="item.id">
                    {{ item.event_title }} — {{ formatDate(item.event_date) }}
                  </option>
                </select>
              </UFormField>

              <UFormField label="Student" required>
                <select
                  v-model="submissionForm.student_id"
                  required
                  class="w-full rounded-md border border-default bg-default px-3 py-2 text-sm"
                >
                  <option value="" disabled>Select a student</option>
                  <option v-for="student in students" :key="student.student_id" :value="student.student_id">
                    {{ student.name }} — {{ student.email }}
                  </option>
                </select>
              </UFormField>

              <UFormField label="Participation role" required>
                <select
                  v-model="submissionForm.participation_role"
                  required
                  class="w-full rounded-md border border-default bg-default px-3 py-2 text-sm"
                >
                  <option value="presenter">Presenter — 5 points</option>
                  <option value="participant">Participant — 2 points</option>
                </select>
              </UFormField>

              <UFormField label="Evidence reference" required>
                <UInput
                  v-model="submissionForm.evidence_reference"
                  required
                  maxlength="2000"
                  placeholder="Link or identifiable evidence reference"
                  class="w-full"
                />
              </UFormField>

              <div class="md:col-span-2">
                <UFormField label="Submission note">
                  <UInput
                    v-model="submissionForm.submission_note"
                    maxlength="2000"
                    placeholder="Optional context for the verifier"
                    class="w-full"
                  />
                </UFormField>
              </div>

              <div class="md:col-span-2">
                <UButton
                  type="submit"
                  :loading="saving"
                  :disabled="!submissionForm.event_id || !submissionForm.student_id || !submissionForm.evidence_reference.trim()"
                >
                  Submit for verification
                </UButton>
              </div>
            </form>
          </div>

          <div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p class="text-sm text-muted">
              {{ events.length }} events · {{ pendingCount }} pending records
            </p>
            <UInput
              v-model="recordSearch"
              icon="i-lucide-search"
              placeholder="Search events or records…"
              class="w-full sm:max-w-xs"
            />
          </div>

          <div v-if="!events.length" class="py-8 text-center text-sm text-muted">
            No Case Study Forum events have been registered yet.
          </div>

          <div v-else class="space-y-4">
            <section
              v-for="item in filteredEvents"
              :key="item.id"
              class="rounded-lg border border-default"
            >
              <div class="flex flex-col gap-2 border-b border-default p-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h4 class="font-semibold text-highlighted">{{ item.event_title }}</h4>
                  <p class="text-sm text-muted">
                    {{ formatDate(item.event_date) }}
                    <span v-if="item.event_reference"> · {{ item.event_reference }}</span>
                  </p>
                  <p v-if="item.description" class="mt-1 text-sm text-muted">
                    {{ item.description }}
                  </p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <UBadge color="neutral" variant="subtle">
                    {{ item.records.length }} visible records
                  </UBadge>
                  <UButton
                    v-if="permissions.canDeleteEvents"
                    label="Delete event"
                    color="error"
                    variant="outline"
                    icon="i-lucide-trash-2"
                    size="sm"
                    :loading="saving"
                    :disabled="saving"
                    @click="deleteEvent(item)"
                  />
                </div>
              </div>

              <div v-if="!item.records.length" class="p-4 text-sm text-muted">
                No participation records are visible for this event.
              </div>

              <div v-else class="divide-y divide-default">
                <article
                  v-for="record in item.records"
                  :key="record.id"
                  class="space-y-3 p-4"
                >
                  <div class="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p class="font-medium text-highlighted">
                        {{ record.student?.name || 'Student' }}
                      </p>
                      <p class="text-xs text-muted">{{ record.student?.email }}</p>
                      <p class="mt-1 text-sm">
                        {{ record.participation_role === 'presenter' ? 'Presenter · 5 points' : 'Participant · 2 points' }}
                      </p>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                      <UBadge :color="statusColor(record.verification_status)" variant="subtle">
                        {{ record.verification_status }}
                      </UBadge>
                      <UBadge v-if="record.verification_status === 'verified'" color="success" variant="outline">
                        {{ record.points_awarded }} points
                      </UBadge>
                      <UBadge v-else color="neutral" variant="outline">
                        0 points counted
                      </UBadge>
                    </div>
                  </div>

                  <div class="text-sm">
                    <p>
                      <span class="text-muted">Evidence:</span>
                      <a
                        v-if="/^https?:\/\//i.test(record.evidence_reference)"
                        :href="record.evidence_reference"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="break-all text-primary underline"
                      >
                        {{ record.evidence_reference }}
                      </a>
                      <span v-else class="break-all">{{ record.evidence_reference }}</span>
                    </p>
                    <p v-if="record.submission_note" class="mt-1 text-muted">
                      Note: {{ record.submission_note }}
                    </p>
                    <p class="mt-1 text-xs text-muted">
                      Submitted by {{ record.submitted_by_email }} · {{ formatDateTime(record.submitted_at) }}
                    </p>
                    <p v-if="record.verified_by_email" class="mt-1 text-xs text-muted">
                      Verified by {{ record.verified_by_email }} · {{ formatDateTime(record.verified_at) }}
                    </p>
                    <p v-if="record.rejected_by_email" class="mt-1 text-xs text-muted">
                      Rejected by {{ record.rejected_by_email }} · {{ formatDateTime(record.rejected_at) }}
                    </p>
                    <p v-if="record.review_note" class="mt-1 text-xs text-muted">
                      Review note: {{ record.review_note }}
                    </p>
                  </div>

                  <div v-if="permissions.canReviewRecords && record.verification_status === 'pending'" class="space-y-2 rounded-md bg-elevated p-3">
                    <UInput
                      v-model="reviewNote"
                      placeholder="Optional review note"
                      maxlength="2000"
                      class="w-full"
                    />
                    <div class="flex flex-wrap gap-2">
                      <UButton
                        color="success"
                        size="sm"
                        :loading="saving"
                        @click="reviewRecord(record, 'verified')"
                      >
                        Verify record
                      </UButton>
                      <UButton
                        color="error"
                        variant="outline"
                        size="sm"
                        :loading="saving"
                        @click="reviewRecord(record, 'rejected')"
                      >
                        Reject record
                      </UButton>
                    </div>
                  </div>
                </article>
              </div>
            </section>
          </div>
        </UCard>

        <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
          <UCard>
            <template #header>
              <h3 class="font-semibold">Final Project Assessment</h3>
            </template>
            <p class="text-sm text-muted">
              Existing examiner assignments, submission and presentation assessment, moderation and assessment history.
            </p>
            <UButton class="mt-4" to="/admin/final-project-assessment" color="primary">
              Open Final Project Assessment
            </UButton>
          </UCard>

          <UCard>
            <template #header>
              <h3 class="font-semibold">Formal Assessment Reviews</h3>
            </template>
            <p class="text-sm text-muted">
              Formal assessment outcomes remain a separate workflow. Approved outcome terminology is Progression, Conditional progression and No progression.
            </p>
            <UBadge class="mt-3" color="neutral" variant="subtle">
              Rules configuration pending
            </UBadge>
          </UCard>

          <UCard>
            <template #header>
              <h3 class="font-semibold">VIVA and Examiner Management</h3>
            </template>
            <p class="text-sm text-muted">
              Mini VIVA and final VIVA scheduling, examiner assignment, rubrics and recorded outcomes.
            </p>
            <UBadge class="mt-3" color="neutral" variant="subtle">
              Programme rules verification pending
            </UBadge>
          </UCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
