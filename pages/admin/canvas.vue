<script setup lang="ts">
// pages/admin/canvas.vue
//
// Course dropdown -> "Sync Now" (pulls fresh data from Canvas into
// canvas_students / canvas_enrollments / canvas_assignments /
// canvas_submissions) -> a searchable/sortable table of every
// (student, assignment) pair for that course, read from our own DB
// (server/api/admin/canvas/submissions.get.js) so the page itself
// never talks to Canvas directly.

definePageMeta({
  layout: 'default',
  middleware: ['admin'],
})

const { showSuccess, showError } = useNotifications()

const courses = ref<any[]>([])
const coursesLoading = ref(false)
const selectedCourseId = ref<number | null>(null)

const syncing = ref(false)
const lastSyncSummary = ref<any>(null)

const rows = ref<any[]>([])
const summary = ref({ studentCount: 0, assignmentCount: 0, submissionRate: 0 })
const rowsLoading = ref(false)

const search = ref('')
const sortKey = ref('student_name')
const sortDir = ref<'asc' | 'desc'>('asc')

async function fetchCourses() {
  coursesLoading.value = true
  try {
    const res = await $fetch('/api/admin/canvas/courses')
    courses.value = res?.data || []
  } catch (err: any) {
    showError('Could not load Canvas courses', err?.data?.statusMessage || err.message)
  } finally {
    coursesLoading.value = false
  }
}

async function fetchSubmissions() {
  if (!selectedCourseId.value) return
  rowsLoading.value = true
  try {
    const res = await $fetch('/api/admin/canvas/submissions', {
      query: { courseId: selectedCourseId.value },
    })
    rows.value = res?.data?.rows || []
    summary.value = res?.data?.summary || { studentCount: 0, assignmentCount: 0, submissionRate: 0 }
  } catch (err: any) {
    showError('Could not load submissions', err?.data?.statusMessage || err.message)
  } finally {
    rowsLoading.value = false
  }
}

async function syncNow() {
  if (!selectedCourseId.value) return
  syncing.value = true
  try {
    const res = await $fetch('/api/admin/canvas/sync', {
      method: 'POST',
      body: { canvasCourseId: selectedCourseId.value },
    })
    lastSyncSummary.value = res?.data
    showSuccess(
      'Sync complete',
      `${res.data.studentsSynced} students, ${res.data.assignmentsSynced} assignments, ${res.data.submissionsSynced} submissions`
    )
    await fetchSubmissions()
  } catch (err: any) {
    showError('Sync failed', err?.data?.statusMessage || err.message)
  } finally {
    syncing.value = false
  }
}

// Selecting a course auto-syncs it (pulls fresh data from Canvas, then
// loads the table) rather than just showing whatever was synced last
// time — matches "pick a course, it automatically syncs" behavior.
// The manual "Sync Now" button still exists for re-pulling the same
// course on demand (e.g. a student just submitted something).
watch(selectedCourseId, () => {
  lastSyncSummary.value = null
  syncNow()
})

onMounted(fetchCourses)

function toggleSort(key: string) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = 'asc'
  }
}

function sortIcon(key: string) {
  if (sortKey.value !== key) return 'i-lucide-chevrons-up-down'
  return sortDir.value === 'asc' ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'
}

const filtered = computed(() => {
  let list = rows.value

  if (search.value.trim()) {
    const q = search.value.trim().toLowerCase()
    list = list.filter(
      (r) =>
        r.student_name?.toLowerCase().includes(q) ||
        r.student_email?.toLowerCase().includes(q) ||
        r.assignment_name?.toLowerCase().includes(q)
    )
  }

  return [...list].sort((a, b) => {
    const av = a[sortKey.value]
    const bv = b[sortKey.value]
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'string') {
      return sortDir.value === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    }
    return sortDir.value === 'asc' ? av - bv : bv - av
  })
})

function statusColor(state: string) {
  switch (state) {
    case 'graded':
      return 'success'
    case 'submitted':
    case 'pending_review':
      return 'info'
    case 'unsubmitted':
      return 'neutral'
    default:
      return 'neutral'
  }
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const courseItems = computed(() =>
  courses.value.map((c) => ({
    label: c.name,
    description: c.course_code,
    value: c.id,
  }))
)
</script>

<template>
  <UDashboardPanel id="canvas">
    <template #header>
      <UDashboardNavbar title="Canvas">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <!-- Course picker + sync -->
      <UCard variant="subtle" class="mb-6" :ui="{ body: '!py-4' }">
        <div class="flex flex-col sm:flex-row sm:items-end gap-3">
          <div class="flex-1">
            <p class="text-xs text-muted mb-1.5">Course</p>
            <USelectMenu
              v-model="selectedCourseId"
              :items="courseItems"
              value-key="value"
              placeholder="Select a course"
              :loading="coursesLoading"
              class="w-full sm:w-96"
            />
          </div>
          <UButton
            label="Sync Now"
            icon="i-lucide-refresh-cw"
            color="primary"
            :loading="syncing"
            :disabled="!selectedCourseId || syncing"
            @click="syncNow"
          />
        </div>
        <p v-if="lastSyncSummary" class="text-xs text-muted mt-3">
          Last sync: {{ lastSyncSummary.studentsSynced }} students,
          {{ lastSyncSummary.assignmentsSynced }} assignments,
          {{ lastSyncSummary.submissionsSynced }} submissions.
        </p>
      </UCard>

      <!-- Empty state: no course chosen yet -->
      <div v-if="!selectedCourseId" class="text-center py-16">
        <UIcon name="i-lucide-bar-chart-3" class="size-10 text-muted mx-auto mb-3" />
        <p class="font-medium text-highlighted">Select a Course to Begin</p>
        <p class="text-sm text-muted mt-1">
          Choose a course from the dropdown above to sync assignments and student
          submissions from Canvas LMS.
        </p>
      </div>

      <template v-else>
        <!-- Summary stat cards -->
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
          <UCard>
            <p class="text-xs text-muted uppercase tracking-wide">Students</p>
            <p class="text-2xl font-semibold">{{ summary.studentCount }}</p>
          </UCard>
          <UCard>
            <p class="text-xs text-muted uppercase tracking-wide">Assignments</p>
            <p class="text-2xl font-semibold">{{ summary.assignmentCount }}</p>
          </UCard>
          <UCard>
            <p class="text-xs text-muted uppercase tracking-wide">Submission Rate</p>
            <p class="text-2xl font-semibold">{{ summary.submissionRate }}%</p>
          </UCard>
        </div>

        <!-- Search -->
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="Search students or assignments..."
          class="mb-4 w-full sm:w-96"
        />

        <div v-if="syncing" class="text-sm text-muted py-8 text-center">
          <UIcon name="i-lucide-refresh-cw" class="size-4 animate-spin inline mr-1.5" />
          Syncing with Canvas... this can take a moment for courses with many assignments.
        </div>
        <div v-else-if="rowsLoading" class="text-sm text-muted py-8 text-center">Loading...</div>
        <div v-else-if="filtered.length === 0" class="text-sm text-muted py-8 text-center">
          No students or submissions found for this course yet. Try "Sync Now" above.
        </div>

        <div v-else class="overflow-x-auto rounded-lg border border-default">
          <table class="w-full text-sm">
            <thead class="bg-elevated/50 border-b border-default">
              <tr>
                <th class="text-left px-4 py-3 font-medium cursor-pointer select-none" @click="toggleSort('student_name')">
                  <span class="inline-flex items-center gap-1">Student <UIcon :name="sortIcon('student_name')" class="size-3.5" /></span>
                </th>
                <th class="text-left px-4 py-3 font-medium cursor-pointer select-none" @click="toggleSort('assignment_name')">
                  <span class="inline-flex items-center gap-1">Assignment <UIcon :name="sortIcon('assignment_name')" class="size-3.5" /></span>
                </th>
                <th class="text-left px-4 py-3 font-medium">Status</th>
                <th class="text-left px-4 py-3 font-medium">Grade</th>
                <th class="text-right px-4 py-3 font-medium cursor-pointer select-none" @click="toggleSort('score')">
                  <span class="inline-flex items-center gap-1">Score <UIcon :name="sortIcon('score')" class="size-3.5" /></span>
                </th>
                <th class="text-left px-4 py-3 font-medium cursor-pointer select-none" @click="toggleSort('submitted_at')">
                  <span class="inline-flex items-center gap-1">Submitted <UIcon :name="sortIcon('submitted_at')" class="size-3.5" /></span>
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-default">
              <tr v-for="r in filtered" :key="`${r.student_id}-${r.assignment_id}`">
                <td class="px-4 py-2.5">
                  <p class="font-medium text-highlighted">{{ r.student_name || '—' }}</p>
                  <p class="text-xs text-muted">{{ r.student_email }}</p>
                </td>
                <td class="px-4 py-2.5 text-muted">{{ r.assignment_name }}</td>
                <td class="px-4 py-2.5">
                  <UBadge :color="statusColor(r.workflow_state)" variant="subtle" size="sm">
                    {{ r.workflow_state }}
                  </UBadge>
                  <UBadge v-if="r.late" color="warning" variant="subtle" size="sm" class="ml-1">late</UBadge>
                </td>
                <td class="px-4 py-2.5 text-muted">{{ r.grade || '—' }}</td>
                <td class="px-4 py-2.5 text-right">
                  {{ r.score ?? '—' }}<span v-if="r.points_possible" class="text-muted">/{{ r.points_possible }}</span>
                </td>
                <td class="px-4 py-2.5 text-muted">{{ formatDate(r.submitted_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </UDashboardPanel>
</template>
