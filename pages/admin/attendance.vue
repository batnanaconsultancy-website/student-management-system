<script setup lang="ts">
import { PROGRAM_OPTIONS } from '~/constants/options'

definePageMeta({
  layout: 'default',
  middleware: ['admin'],
})

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
  } catch (err) {
    console.error('Failed to fetch attendance:', err)
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

const filtered = computed(() => {
  let rows = students.value

  if (programFilter.value !== 'all') {
    rows = rows.filter((s) => s.program === programFilter.value)
  }

  if (search.value.trim()) {
    const q = search.value.trim().toLowerCase()
    rows = rows.filter(
      (s) =>
        s.name?.toLowerCase().includes(q) ||
        s.email?.toLowerCase().includes(q) ||
        s.username?.toLowerCase().includes(q)
    )
  }

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey.value]
    const bv = b[sortKey.value]
    if (typeof av === 'string') {
      return sortDir.value === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    }
    return sortDir.value === 'asc' ? av - bv : bv - av
  })

  return sorted
})

const summary = computed(() => ({
  students: filtered.value.length,
  workshops: filtered.value.reduce((sum, s) => sum + s.workshops_attended, 0),
  standups: filtered.value.reduce((sum, s) => sum + s.standup_attended, 0),
  mentoring: filtered.value.reduce((sum, s) => sum + s.mentoring_attended, 0),
}))

const programItems = [{ label: 'All Programs', value: 'all' }, ...PROGRAM_OPTIONS]

function sortIcon(key: string) {
  if (sortKey.value !== key) return 'i-lucide-chevrons-up-down'
  return sortDir.value === 'asc' ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'
}
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
      <!-- Summary stat cards -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <UCard>
          <p class="text-xs text-muted uppercase tracking-wide">Students</p>
          <p class="text-2xl font-semibold">{{ summary.students }}</p>
        </UCard>
        <UCard>
          <p class="text-xs text-muted uppercase tracking-wide">Workshop Attendances</p>
          <p class="text-2xl font-semibold">{{ summary.workshops }}</p>
        </UCard>
        <UCard>
          <p class="text-xs text-muted uppercase tracking-wide">Stand-up Attendances</p>
          <p class="text-2xl font-semibold">{{ summary.standups }}</p>
        </UCard>
        <UCard>
          <p class="text-xs text-muted uppercase tracking-wide">Mentoring Attendances</p>
          <p class="text-2xl font-semibold">{{ summary.mentoring }}</p>
        </UCard>
      </div>

      <!-- Filters -->
      <div class="flex flex-col sm:flex-row gap-3 mb-4">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="Search by name, email, or username..."
          class="flex-1"
        />
        <USelect
          v-model="programFilter"
          :items="programItems"
          value-key="value"
          class="w-52"
        />
      </div>

      <div v-if="loading" class="text-sm text-muted py-8 text-center">Loading...</div>
      <div v-else-if="filtered.length === 0" class="text-sm text-muted py-8 text-center">
        No students match your search/filter.
      </div>

      <div v-else class="overflow-x-auto rounded-lg border border-default">
        <table class="w-full text-sm">
          <thead class="bg-elevated/50 border-b border-default">
            <tr>
              <th class="text-left px-4 py-3 font-medium cursor-pointer select-none" @click="toggleSort('name')">
                <span class="inline-flex items-center gap-1">Name <UIcon :name="sortIcon('name')" class="size-3.5" /></span>
              </th>
              <th class="text-left px-4 py-3 font-medium">Program</th>
              <th class="text-left px-4 py-3 font-medium">Cohort</th>
              <th class="text-right px-4 py-3 font-medium cursor-pointer select-none" @click="toggleSort('workshops_attended')">
                <span class="inline-flex items-center gap-1">Workshops <UIcon :name="sortIcon('workshops_attended')" class="size-3.5" /></span>
              </th>
              <th class="text-right px-4 py-3 font-medium cursor-pointer select-none" @click="toggleSort('standup_attended')">
                <span class="inline-flex items-center gap-1">Stand-ups <UIcon :name="sortIcon('standup_attended')" class="size-3.5" /></span>
              </th>
              <th class="text-right px-4 py-3 font-medium cursor-pointer select-none" @click="toggleSort('mentoring_attended')">
                <span class="inline-flex items-center gap-1">Mentoring <UIcon :name="sortIcon('mentoring_attended')" class="size-3.5" /></span>
              </th>
              <th class="text-right px-4 py-3 font-medium cursor-pointer select-none" @click="toggleSort('total_attended')">
                <span class="inline-flex items-center gap-1">Total <UIcon :name="sortIcon('total_attended')" class="size-3.5" /></span>
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-for="s in filtered" :key="s.id">
              <td class="px-4 py-2.5">
                <p class="font-medium text-highlighted">{{ s.name }}</p>
                <p class="text-xs text-muted">{{ s.email }}</p>
              </td>
              <td class="px-4 py-2.5 text-muted">{{ s.program }}</td>
              <td class="px-4 py-2.5 text-muted">{{ s.cohort }}</td>
              <td class="px-4 py-2.5 text-right">{{ s.workshops_attended }}</td>
              <td class="px-4 py-2.5 text-right">{{ s.standup_attended }}</td>
              <td class="px-4 py-2.5 text-right">{{ s.mentoring_attended }}</td>
              <td class="px-4 py-2.5 text-right font-medium">{{ s.total_attended }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </UDashboardPanel>
</template>
