<script setup lang="ts">
// pages/admin/final-project-assessment/history.vue
//
// Section 7: Preview / Historical Records. Shows every assignment
// (including archived ones) with full detail -- examiner(s), grades,
// average, submission date, completion status -- filterable by year.

definePageMeta({
  layout: 'default',
  middleware: ['admin'],
})

const { showError } = useNotifications()

const assignments = ref<any[]>([])
const loading = ref(true)
const selectedYear = ref<number | null>(new Date().getFullYear())

const yearOptions = computed(() => {
  const currentYear = new Date().getFullYear()
  const years = []
  for (let y = currentYear + 1; y >= currentYear - 5; y--) years.push(y)
  return [{ label: 'All years', value: null }, ...years.map((y) => ({ label: String(y), value: y }))]
})

async function fetchHistory() {
  loading.value = true
  try {
    const res = await $fetch('/api/admin/final-project-assessment/history', {
      query: selectedYear.value ? { year: selectedYear.value } : {},
    })
    assignments.value = res?.data?.assignments || []
  } catch (err: any) {
    showError('Failed to load history', err?.data?.statusMessage || err?.message)
  } finally {
    loading.value = false
  }
}

onMounted(fetchHistory)
watch(selectedYear, fetchHistory)

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
</script>

<template>
  <UDashboardPanel id="final-project-assessment-history" :ui="{ body: 'overflow-auto' }">
    <template #header>
      <UDashboardNavbar title="Final Project Assessment — Preview / History">
        <template #leading>
          <UDashboardSidebarCollapse />
          <UButton
            to="/admin/final-project-assessment"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            size="sm"
            class="ml-1"
          >
            Back
          </UButton>
        </template>
        <template #right>
          <USelectMenu
            v-model="selectedYear"
            :items="yearOptions"
            value-key="value"
            class="w-40"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="loading" class="space-y-3">
        <USkeleton v-for="i in 4" :key="i" class="h-24 w-full" />
      </div>

      <div v-else-if="assignments.length === 0" class="text-center py-16 text-muted">
        No records for this period.
      </div>

      <div v-else class="space-y-3">
        <UCard v-for="a in assignments" :key="a.id">
          <div class="flex items-start justify-between gap-4 flex-wrap mb-3">
            <div>
              <p class="font-medium text-highlighted">
                {{ a.student?.name }}
                <UBadge v-if="a.archived" color="neutral" variant="subtle" size="sm" class="ml-1">Archived</UBadge>
              </p>
              <p class="text-xs text-muted">{{ a.student?.email }} · {{ a.student?.program }} · {{ a.student?.cohort }}</p>
            </div>
            <UBadge
              :color="a.overallStatus === 'FINAL PROJECT ASSESSMENT COMPLETED' ? 'success' : 'neutral'"
              variant="subtle"
            >
              {{ a.overallStatus }}
            </UBadge>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div class="p-3 rounded-lg bg-elevated/30">
              <p class="font-medium mb-1">Final Project Submission</p>
              <p class="text-xs text-muted">Status: {{ a.submission?.status || 'NOT_ASSIGNED' }}</p>
              <p class="text-xs text-muted">Average Grade: {{ a.submission?.averageGrade ?? '—' }}</p>
              <p class="text-xs text-muted">Submitted: {{ formatDate(a.submission?.submittedAt) }}</p>
              <p v-if="a.submission?.reopened" class="text-xs text-warning">Reopened: {{ a.submission?.reopenReason }}</p>
            </div>
            <div class="p-3 rounded-lg bg-elevated/30">
              <p class="font-medium mb-1">Final Project Presentation</p>
              <p class="text-xs text-muted">Status: {{ a.presentation?.status || 'NOT_ASSIGNED' }}</p>
              <p class="text-xs text-muted">Average Grade: {{ a.presentation?.averageGrade ?? '—' }}</p>
              <p class="text-xs text-muted">Submitted: {{ formatDate(a.presentation?.submittedAt) }}</p>
              <p v-if="a.presentation?.reopened" class="text-xs text-warning">Reopened: {{ a.presentation?.reopenReason }}</p>
            </div>
          </div>

          <div class="mt-3 text-xs text-muted">
            Examiner(s):
            <span v-for="(ex, i) in a.examiners" :key="ex.id">{{ ex.name }}<span v-if="i < a.examiners.length - 1">, </span></span>
            <span v-if="a.examiners.length === 0">none</span>
            · Season 04: {{ a.season04.confirmed ? (a.season04.override ? 'Confirmed (override)' : 'Confirmed') : 'Not confirmed' }}
            · Created {{ formatDate(a.createdAt) }} by {{ a.createdBy }}
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
