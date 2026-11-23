<script setup lang="ts">
import { PROGRAM_OPTIONS } from '~/constants/options'

definePageMeta({
  layout: 'default',
  middleware: ['admin'],
})

const { showError } = useNotifications()

const students = ref<any[]>([])
const loading = ref(false)
const search = ref('')
const programFilter = ref('all')
const sortKey = ref('total_attended')
const sortDir = ref<'asc' | 'desc'>('desc')

async function fetchAttendance() {
  loading.value = true
  try {
    const res = await $fetch('/api/admin/attendance')
    students.value = res?.data || []
  } catch (err: any) {
    console.error('Failed to fetch attendance:', err)
    showError(
      'Could not load attendance',
      err?.data?.statusMessage || err?.message || 'Please try again.',
    )
  } finally {
    loading.value = false
  }
}

onMounted(fetchAttendance)

function toggleSort(key: string) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = 'desc'
  }
}

function sortIcon(key: string) {
  if (sortKey.value !== key) return 'i-lucide-chevrons-up-down'
  return sortDir.value === 'asc'
    ? 'i-lucide-chevron-up'
    : 'i-lucide-chevron-down'
}

function pctColor(value: number | null | undefined) {
  if (value == null) return 'neutral'
  if (value >= 75) return 'success'
  if (value >= 50) return 'warning'
  return 'error'
}

function scheduledLabel(student: any, key: string) {
  if (student.calendar_coverage_status !== 'matched') return '—'
  const attended = student[`scheduled_${key}_attended`]
  const total = student[`scheduled_${key}_total`]
  const percent = student[`scheduled_${key}_percent`]
  if (attended == null || total == null || percent == null) return '—'
  return `${attended}/${total} (${percent}%)`
}

const filtered = computed(() => {
  let rows = [...students.value]

  if (programFilter.value !== 'all') {
    rows = rows.filter((s) => s.program === programFilter.value)
  }

  if (search.value.trim()) {
    const q = search.value.trim().toLowerCase()
    rows = rows.filter((s) =>
      [s.name, s.email, s.username, s.cohort]
        .some((value) => String(value || '').toLowerCase().includes(q))
    )
  }

  return rows.sort((a, b) => {
    const av = a[sortKey.value]
    const bv = b[sortKey.value]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    const result = typeof av === 'string'
      ? av.localeCompare(String(bv))
      : Number(av) - Number(bv)
    return sortDir.value === 'asc' ? result : -result
  })
})

const summary = computed(() => ({
  students: filtered.value.length,
  workshops: filtered.value.reduce((n, s) => n + (s.workshops_attended || 0), 0),
  standups: filtered.value.reduce((n, s) => n + (s.standup_attended || 0), 0),
  mentoring: filtered.value.reduce((n, s) => n + (s.mentoring_attended || 0), 0),
  squadMeetings: filtered.value.reduce((n, s) => n + (s.squad_meeting_attended || 0), 0),
  points: filtered.value.reduce((n, s) => n + (s.uses_ledger ? (s.actual_points || 0) : 0), 0),
  ledgerStudents: filtered.value.filter((s) => s.uses_ledger).length,
}))

const programItems = [
  { label: 'All Programs', value: 'all' },
  ...PROGRAM_OPTIONS,
]
</script>

<template>
  <UDashboardPanel id="attendance">
    <template #header>
      <UDashboardNavbar title="Attendance">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <UCard>
          <p class="text-xs text-muted uppercase">Students</p>
          <p class="text-2xl font-semibold">{{ summary.students }}</p>
        </UCard>
        <UCard>
          <p class="text-xs text-muted uppercase">Workshop attendances</p>
          <p class="text-2xl font-semibold">{{ summary.workshops }}</p>
        </UCard>
        <UCard>
          <p class="text-xs text-muted uppercase">Stand-up attendances</p>
          <p class="text-2xl font-semibold">{{ summary.standups }}</p>
        </UCard>
        <UCard>
          <p class="text-xs text-muted uppercase">Mentoring attendances</p>
          <p class="text-2xl font-semibold">{{ summary.mentoring }}</p>
        </UCard>
        <UCard>
          <p class="text-xs text-muted uppercase">Squad Meeting attendances</p>
          <p class="text-2xl font-semibold">{{ summary.squadMeetings }}</p>
        </UCard>
        <UCard>
          <p class="text-xs text-muted uppercase">Bachelor points awarded</p>
          <p class="text-2xl font-semibold">{{ summary.points }}</p>
          <p class="text-xs text-muted">{{ summary.ledgerStudents }} ledger students</p>
        </UCard>
      </div>

      <p class="text-xs text-muted mb-4">
        Attendance % is relative to the highest attendee in the same cohort.
        Scheduled rates show attended/planned sessions through the reporting date.
        Points are actual ledger-awarded points and apply only to ledger students.
      </p>

      <div class="flex flex-col sm:flex-row gap-3 mb-4">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="Search name, email, username, or cohort..."
          class="flex-1"
        />
        <USelect
          v-model="programFilter"
          :items="programItems"
          value-key="value"
          class="w-52"
        />
      </div>

      <div v-if="loading" class="text-sm text-muted py-8 text-center">
        Loading attendance...
      </div>
      <div v-else-if="filtered.length === 0" class="text-sm text-muted py-8 text-center">
        No students match your search or filter.
      </div>
      <div v-else class="overflow-x-auto rounded-lg border border-default">
        <table class="w-full text-sm">
          <thead class="bg-elevated/50 border-b border-default">
            <tr>
              <th class="text-left px-3 py-3 cursor-pointer" @click="toggleSort('name')">Name</th>
              <th class="text-left px-3 py-3">Program</th>
              <th class="text-left px-3 py-3">Cohort</th>
              <th class="text-right px-3 py-3 cursor-pointer" @click="toggleSort('workshops_attended')">Workshops</th>
              <th class="text-right px-3 py-3 cursor-pointer" @click="toggleSort('standup_attended')">Stand-ups</th>
              <th class="text-right px-3 py-3 cursor-pointer" @click="toggleSort('mentoring_attended')">Mentoring</th>
              <th class="text-right px-3 py-3 cursor-pointer" @click="toggleSort('squad_meeting_attended')">Squad Meetings</th>
              <th class="text-right px-3 py-3 cursor-pointer" @click="toggleSort('total_attended')">Total</th>
              <th class="text-right px-3 py-3 cursor-pointer" @click="toggleSort('actual_points')">Points</th>
              <th class="text-right px-3 py-3 cursor-pointer" @click="toggleSort('cohort_pct')">Cohort %</th>
              <th class="text-left px-3 py-3">Calendar</th>
              <th class="text-right px-3 py-3">Scheduled workshops</th>
              <th class="text-right px-3 py-3">Scheduled mentoring</th>
              <th class="text-right px-3 py-3">Scheduled stand-ups</th>
              <th class="text-right px-3 py-3">Scheduled Squad Meetings</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-for="s in filtered" :key="s.id">
              <td class="px-3 py-2.5">
                <p class="font-medium text-highlighted">{{ s.name }}</p>
                <p class="text-xs text-muted">{{ s.email }}</p>
              </td>
              <td class="px-3 py-2.5">{{ s.program }}</td>
              <td class="px-3 py-2.5">{{ s.cohort || '—' }}</td>
              <td class="px-3 py-2.5 text-right">{{ s.workshops_attended }}</td>
              <td class="px-3 py-2.5 text-right">{{ s.standup_attended }}</td>
              <td class="px-3 py-2.5 text-right">{{ s.mentoring_attended }}</td>
              <td class="px-3 py-2.5 text-right">{{ s.squad_meeting_attended }}</td>
              <td class="px-3 py-2.5 text-right font-medium">{{ s.total_attended }}</td>
              <td class="px-3 py-2.5 text-right">
                {{ s.uses_ledger ? s.actual_points : '—' }}
              </td>
              <td class="px-3 py-2.5 text-right">
                <UTooltip
                  :text="`Cohort's highest attendee: ${s.cohort_top_attendee ?? '—'} sessions`"
                  :delay-duration="0"
                >
                  <UBadge :color="pctColor(s.cohort_pct)" variant="subtle">
                    {{ s.cohort_pct == null ? '—' : `${s.cohort_pct}%` }}
                  </UBadge>
                </UTooltip>
              </td>
              <td class="px-3 py-2.5">
                <UBadge
                  :color="s.calendar_coverage_status === 'matched' ? 'success' : 'neutral'"
                  variant="subtle"
                >
                  {{ s.calendar_coverage_status || 'not applicable' }}
                </UBadge>
              </td>
              <td class="px-3 py-2.5 text-right whitespace-nowrap">
                {{ scheduledLabel(s, 'workshops') }}
              </td>
              <td class="px-3 py-2.5 text-right whitespace-nowrap">
                {{ scheduledLabel(s, 'mentoring') }}
              </td>
              <td class="px-3 py-2.5 text-right whitespace-nowrap">
                {{ scheduledLabel(s, 'standups') }}
              </td>
              <td class="px-3 py-2.5 text-right whitespace-nowrap">
                {{ scheduledLabel(s, 'squad_meetings') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </UDashboardPanel>
</template>
