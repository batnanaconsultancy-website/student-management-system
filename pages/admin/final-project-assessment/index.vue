<script setup lang="ts">
// pages/admin/final-project-assessment/index.vue
//
// The Admin "Final Project Assessment" section (spec Section 1). Lists
// active (non-archived) assignments; "New Assignment" opens the
// Add Examiners -> Select Students -> Confirm Season 4 -> Activate ->
// Save workflow (NewAssignmentModal.vue). Archived assignments and
// full submission/grade history live on the separate Preview page
// (history.vue) per Section 7.

definePageMeta({
  layout: 'default',
  middleware: ['admin'],
})

const { showSuccess, showError } = useNotifications()

const assignments = ref<any[]>([])
const loading = ref(true)
const modalOpen = ref(false)

async function fetchAssignments() {
  loading.value = true
  try {
    const res = await $fetch('/api/admin/final-project-assessment/assignments')
    assignments.value = res?.data?.assignments || []
  } catch (err: any) {
    showError('Failed to load assignments', err?.data?.statusMessage || err?.message)
  } finally {
    loading.value = false
  }
}

onMounted(fetchAssignments)

async function handleArchive(assignment: any) {
  if (!confirm(`Archive the Final Project Assessment for ${assignment.student?.name}? This hides it from the active list but keeps the full record -- nothing is deleted.`)) return
  try {
    await $fetch('/api/admin/final-project-assessment/archive-assignment', {
      method: 'POST',
      body: { assignmentId: assignment.id, archived: true },
    })
    showSuccess('Archived', `${assignment.student?.name} moved to history.`)
    await fetchAssignments()
  } catch (err: any) {
    showError('Failed to archive', err?.data?.statusMessage || err?.message)
  }
}

function statusColor(status: string) {
  const map: Record<string, string> = {
    'FINAL PROJECT ASSESSMENT COMPLETED': 'success',
    'PRESENTATION PENDING': 'warning',
    'ASSESSMENT PENDING': 'neutral',
  }
  return map[status] || 'neutral'
}

function submissionBadgeColor(status: string | undefined) {
  if (status === 'SUBMITTED') return 'success'
  if (status === 'IN_PROGRESS') return 'info'
  if (status === 'ACTIVATED') return 'warning'
  return 'neutral'
}
</script>

<template>
  <UDashboardPanel id="final-project-assessment" :ui="{ body: 'overflow-auto' }">
    <template #header>
      <UDashboardNavbar title="Final Project Assessment">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            label="Preview / History"
            icon="i-lucide-history"
            color="neutral"
            variant="outline"
            size="sm"
            to="/admin/final-project-assessment/history"
          />
          <UButton
            label="New Assignment"
            icon="i-lucide-plus"
            size="sm"
            @click="modalOpen = true"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="loading" class="space-y-3">
        <USkeleton v-for="i in 4" :key="i" class="h-20 w-full" />
      </div>

      <div v-else-if="assignments.length === 0" class="text-center py-16 text-muted">
        <UIcon name="i-lucide-clipboard-list" class="size-10 mx-auto mb-3" />
        <p>No active Final Project Assessment assignments yet.</p>
        <UButton class="mt-3" @click="modalOpen = true">New Assignment</UButton>
      </div>

      <div v-else class="rounded-lg border border-default divide-y divide-default">
        <div v-for="a in assignments" :key="a.id" class="p-4">
          <div class="flex items-start justify-between gap-4 flex-wrap">
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <p class="font-medium text-highlighted">{{ a.student?.name || 'Unknown student' }}</p>
                <UBadge :color="statusColor(a.overallStatus)" variant="subtle" size="sm">{{ a.overallStatus }}</UBadge>
                <UBadge v-if="!a.assessmentActivated" color="neutral" variant="subtle" size="sm">Not Activated</UBadge>
              </div>
              <p class="text-xs text-muted mt-0.5">
                {{ a.student?.email }} · {{ a.student?.program }} · {{ a.student?.cohort }}
              </p>
              <p class="text-xs text-muted mt-1">
                Examiner(s):
                <span v-for="(ex, i) in a.examiners" :key="ex.id">{{ ex.name }}<span v-if="i < a.examiners.length - 1">, </span></span>
                <span v-if="a.examiners.length === 0">none</span>
              </p>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <UButton icon="i-lucide-archive" size="xs" color="neutral" variant="outline" @click="handleArchive(a)">
                Archive
              </UButton>
            </div>
          </div>

          <div class="flex items-center gap-4 mt-3 flex-wrap">
            <div class="flex items-center gap-1.5 text-xs">
              <span class="text-muted">Season 04:</span>
              <UBadge :color="a.season04.confirmed ? 'success' : 'neutral'" variant="subtle" size="sm">
                {{ a.season04.confirmed ? (a.season04.override ? 'Confirmed (override)' : 'Confirmed') : 'Not confirmed' }}
              </UBadge>
            </div>
            <div class="flex items-center gap-1.5 text-xs">
              <span class="text-muted">Submission:</span>
              <UBadge :color="submissionBadgeColor(a.submission?.status)" variant="subtle" size="sm">
                {{ a.submission?.status || 'NOT_ASSIGNED' }}
              </UBadge>
              <span v-if="a.submission?.averageGrade != null" class="text-muted">({{ a.submission.averageGrade }})</span>
            </div>
            <div class="flex items-center gap-1.5 text-xs">
              <span class="text-muted">Presentation:</span>
              <UBadge :color="submissionBadgeColor(a.presentation?.status)" variant="subtle" size="sm">
                {{ a.presentation?.status || 'NOT_ASSIGNED' }}
              </UBadge>
              <span v-if="a.presentation?.averageGrade != null" class="text-muted">({{ a.presentation.averageGrade }})</span>
            </div>
          </div>
        </div>
      </div>

      <AdminFinalProjectAssessmentNewAssignmentModal
        v-model:open="modalOpen"
        @saved="fetchAssignments"
      />
    </template>
  </UDashboardPanel>
</template>
