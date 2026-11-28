<script setup lang="ts">
// pages/examiner/dashboard.vue
//
// "MY FINAL PROJECT ASSESSMENTS" (spec Section 21): every student
// this examiner is assigned to, with independent Submission and
// Presentation status. Clicking a card opens the relevant form.

definePageMeta({
  layout: 'examiner',
  middleware: ['examiner'],
})

const { showError } = useNotifications()

const assignments = ref<any[]>([])
const loading = ref(true)
const canvasAssessments = ref<any>({ scopes: [], courses: [], assignments: [], attempts: [] })
const canvasAssessmentsLoading = ref(true)

async function fetchAssignments() {
  loading.value = true
  try {
    const res = await $fetch('/api/examiner/assignments')
    assignments.value = res?.data?.assignments || []
  } catch (err: any) {
    showError('Failed to load assignments', err?.data?.statusMessage || err?.message)
  } finally {
    loading.value = false
  }
}

async function fetchCanvasAssessments() {
  canvasAssessmentsLoading.value = true
  try {
    const res: any = await $fetch('/api/examiner/canvas-assessments')
    canvasAssessments.value = res?.data || { scopes: [], courses: [], assignments: [], attempts: [] }
  } catch (err: any) {
    showError('Failed to load Canvas assessments', err?.data?.statusMessage || err?.message)
  } finally {
    canvasAssessmentsLoading.value = false
  }
}

onMounted(() => {
  fetchAssignments()
  fetchCanvasAssessments()
})

function statusColor(status: string | undefined) {
  if (status === 'SUBMITTED') return 'success'
  if (status === 'IN_PROGRESS') return 'info'
  if (status === 'ACTIVATED') return 'warning'
  return 'neutral'
}

function statusLabel(status: string | undefined) {
  if (!status) return 'Not assigned'
  const map: Record<string, string> = {
    ASSIGNED: 'Assigned',
    ACTIVATED: 'Ready to start',
    IN_PROGRESS: 'In progress',
    SUBMITTED: 'Submitted',
  }
  return map[status] || status
}

function canOpen(entry: any) {
  // Can't open until the admin has activated it (Section 2).
  return entry.assessmentActivated
}
</script>

<template>
  <UDashboardPanel id="examiner-dashboard" :ui="{ body: 'overflow-auto' }">
    <template #header>
      <UDashboardNavbar title="My Assessments">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <section class="mb-8">
        <div class="flex items-center justify-between gap-3 mb-3">
          <div>
            <h2 class="text-base font-semibold text-highlighted">Canvas Assessments</h2>
            <p class="text-xs text-muted mt-0.5">Assignments from the Canvas Bachelor and Masters scopes assigned to you.</p>
          </div>
          <UBadge color="info" variant="subtle">AI-assisted review</UBadge>
        </div>

        <div v-if="canvasAssessmentsLoading" class="space-y-2">
          <USkeleton class="h-20 w-full" />
        </div>
        <div v-else-if="canvasAssessments.scopes.length === 0" class="rounded-lg border border-default p-5 text-sm text-muted">
          No Canvas assessment scopes have been assigned to your Examiner account.
        </div>
        <div v-else-if="canvasAssessments.attempts.length === 0" class="rounded-lg border border-default p-5 text-sm text-muted">
          You have access to {{ canvasAssessments.assignments.length }} configured Canvas assessment assignments. Submission attempts will appear here after evidence sync.
        </div>
        <div v-else class="space-y-2">
          <UCard v-for="attempt in canvasAssessments.attempts" :key="attempt.id" :ui="{ body: '!py-3' }">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <p class="text-sm font-medium text-highlighted">{{ attempt.studentName }}</p>
                  <UBadge color="neutral" variant="subtle" size="xs">{{ attempt.scope === 'canvas_bachelor' ? 'Bachelor' : 'Masters' }}</UBadge>
                  <UBadge v-if="attempt.isLatest" color="success" variant="subtle" size="xs">Latest attempt</UBadge>
                </div>
                <p class="text-sm mt-1">{{ attempt.assignmentName }}</p>
                <p class="text-xs text-muted">{{ attempt.courseName }} · Attempt {{ attempt.attempt }} · {{ attempt.submittedAt ? new Date(attempt.submittedAt).toLocaleString() : 'Not timestamped' }}</p>
              </div>
              <UButton size="sm" variant="outline" :to="`/examiner/canvas/${attempt.id}`">Review submission</UButton>
            </div>
          </UCard>
        </div>
      </section>

      <div class="border-t border-default pt-6 mb-5">
        <h2 class="text-base font-semibold text-highlighted">Final Project Assessments</h2>
        <p class="text-xs text-muted mt-0.5">Your existing Final Project examiner assignments.</p>
      </div>

      <div v-if="loading" class="space-y-3">
        <USkeleton v-for="i in 3" :key="i" class="h-24 w-full" />
      </div>

      <div v-else-if="assignments.length === 0" class="text-center py-16 text-muted">
        <UIcon name="i-lucide-clipboard-list" class="size-10 mx-auto mb-3" />
        <p>No students assigned to you yet.</p>
      </div>

      <div v-else class="space-y-3">
        <UCard v-for="a in assignments" :key="a.assignmentId">
          <div class="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p class="font-medium text-highlighted">{{ a.student?.name }}</p>
              <p class="text-xs text-muted">{{ a.student?.program }} · {{ a.student?.cohort }}</p>
            </div>
            <UBadge v-if="!a.assessmentActivated" color="neutral" variant="subtle" size="sm">
              Not yet activated by admin
            </UBadge>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
            <div class="flex items-center justify-between p-3 rounded-lg border border-default">
              <div>
                <p class="text-sm font-medium">Final Project Submission</p>
                <UBadge :color="statusColor(a.submission?.status)" variant="subtle" size="sm" class="mt-1">
                  {{ statusLabel(a.submission?.status) }}
                </UBadge>
                <span v-if="a.submission?.averageGrade != null" class="text-xs text-muted ml-2">
                  Avg: {{ a.submission.averageGrade }}
                </span>
              </div>
              <UButton
                :disabled="!canOpen(a) || !a.submission"
                size="sm"
                variant="outline"
                :to="a.submission ? `/examiner/assessment/${a.submission.id}` : undefined"
              >
                {{ a.submission?.status === 'SUBMITTED' ? 'View' : 'Open' }}
              </UButton>
            </div>

            <div class="flex items-center justify-between p-3 rounded-lg border border-default">
              <div>
                <p class="text-sm font-medium">Final Project Presentation</p>
                <UBadge :color="statusColor(a.presentation?.status)" variant="subtle" size="sm" class="mt-1">
                  {{ statusLabel(a.presentation?.status) }}
                </UBadge>
                <span v-if="a.presentation?.averageGrade != null" class="text-xs text-muted ml-2">
                  Avg: {{ a.presentation.averageGrade }}
                </span>
              </div>
              <UButton
                :disabled="!canOpen(a) || !a.presentation"
                size="sm"
                variant="outline"
                :to="a.presentation ? `/examiner/assessment/${a.presentation.id}` : undefined"
              >
                {{ a.presentation?.status === 'SUBMITTED' ? 'View' : 'Open' }}
              </UButton>
            </div>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
