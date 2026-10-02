<script setup lang="ts">
// pages/admin/final-project-assessment/[assignmentId].vue
//
// "View Assessment" -- what Section 8's notification links to, and
// what clicking a row on the list/history pages opens. Full
// criterion-by-criterion grade breakdown and signatures for both
// assessment types (the list/history pages only show the average),
// plus the admin-side half of Section 19's reopen flow.

definePageMeta({
  layout: 'default',
  middleware: ['admin'],
})

const route = useRoute()
const assignmentId = computed(() => String(route.params.assignmentId))
const { showSuccess, showError } = useNotifications()

const loading = ref(true)
const error = ref<string | null>(null)
const assignment = ref<any>(null)
const submission = ref<any>(null)
const presentation = ref<any>(null)

async function fetchDetail() {
  loading.value = true
  error.value = null
  try {
    const res = await $fetch(`/api/admin/final-project-assessment/assignment/${assignmentId.value}`)
    assignment.value = res?.data?.assignment
    submission.value = res?.data?.submission
    presentation.value = res?.data?.presentation
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err.message
  } finally {
    loading.value = false
  }
}

onMounted(fetchDetail)

const reopeningId = ref<string | null>(null)
async function handleReopen(sub: any) {
  const reason = prompt('Why are you reopening this assessment? (shown to the examiner)')
  if (!reason || !reason.trim()) return

  reopeningId.value = sub.id
  try {
    await $fetch('/api/admin/final-project-assessment/reopen-submission', {
      method: 'POST',
      body: { submissionId: sub.id, reason: reason.trim() },
    })
    showSuccess('Reopened', 'The examiner can now edit and resubmit this assessment.')
    await fetchDetail()
  } catch (err: any) {
    showError('Failed to reopen', err?.data?.statusMessage || err?.message)
  } finally {
    reopeningId.value = null
  }
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
</script>

<template>
  <UDashboardPanel id="final-project-assessment-detail" :ui="{ body: 'overflow-auto' }">
    <template #header>
      <UDashboardNavbar :title="assignment?.student?.name || 'Assessment Detail'">
        <template #leading>
          <UDashboardSidebarCollapse />
          <UButton to="/admin/final-project-assessment" icon="i-lucide-arrow-left" color="neutral" variant="ghost" size="sm" class="ml-1">
            Back
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="loading" class="space-y-3">
        <USkeleton v-for="i in 3" :key="i" class="h-32 w-full" />
      </div>

      <div v-else-if="error" class="flex items-center justify-center h-64">
        <UCard class="max-w-md">
          <div class="text-center space-y-3">
            <UIcon name="i-lucide-alert-triangle" class="size-8 text-error mx-auto" />
            <p class="text-muted text-sm">{{ error }}</p>
          </div>
        </UCard>
      </div>

      <div v-else-if="assignment" class="space-y-6 max-w-3xl">
        <UCard>
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p class="font-medium text-highlighted">{{ assignment.student?.email }}</p>
              <p class="text-xs text-muted">{{ assignment.student?.program }} · {{ assignment.student?.cohort }}</p>
            </div>
            <div class="flex gap-2">
              <UBadge v-if="assignment.archived" color="neutral" variant="subtle">Archived</UBadge>
              <UBadge :color="assignment.season04.confirmed ? 'success' : 'neutral'" variant="subtle">
                Season 04: {{ assignment.season04.confirmed ? (assignment.season04.override ? 'Confirmed (override)' : 'Confirmed') : 'Not confirmed' }}
              </UBadge>
            </div>
          </div>
          <p class="text-xs text-muted mt-2">
            Examiner(s): <span v-for="(e, i) in assignment.examiners" :key="e.id">{{ e.name }}<span v-if="i < assignment.examiners.length - 1">, </span></span>
          </p>
        </UCard>

        <UCard v-for="(sub, label) in { 'Final Project Submission': submission, 'Final Project Presentation': presentation }" :key="label">
          <template #header>
            <div class="flex items-center justify-between">
              <p class="font-medium text-highlighted">{{ label }}</p>
              <UBadge :color="sub?.status === 'SUBMITTED' ? 'success' : 'neutral'" variant="subtle">
                {{ sub?.status || 'NOT_ASSIGNED' }}
              </UBadge>
            </div>
          </template>

          <div v-if="!sub" class="text-sm text-muted">Not yet assigned.</div>
          <div v-else class="space-y-4">
            <div v-if="sub.grades?.length" class="space-y-1.5">
              <div v-for="g in sub.grades" :key="g.criterionId" class="flex items-center justify-between text-sm">
                <span>{{ g.label }}</span>
                <span class="text-muted">{{ g.grade }} / {{ g.maxGrade }}</span>
              </div>
              <div class="flex items-center justify-between text-sm font-medium pt-2 border-t border-default">
                <span>Average Grade</span>
                <span>{{ sub.averageGrade ?? '—' }}</span>
              </div>
            </div>
            <div v-else class="text-sm text-muted">No grades entered yet.</div>

            <div v-if="sub.signatures?.length" class="text-xs text-muted space-y-0.5">
              <p v-for="s in sub.signatures" :key="s.examinerId">
                Signed by {{ s.examinerName }} on {{ formatDate(s.signedAt) }}
              </p>
            </div>

            <p class="text-xs text-muted">Submitted: {{ formatDate(sub.submittedAt) }}</p>
            <UAlert
              v-if="sub.reopenedAt"
              color="warning"
              variant="subtle"
              title="Reopened"
              :description="`${sub.reopenReason} (by ${sub.reopenedBy}, ${formatDate(sub.reopenedAt)})`"
            />

            <UButton
              v-if="sub.status === 'SUBMITTED' && !(sub.reopenedAt && sub.reopenedAt > sub.submittedAt)"
              size="sm"
              color="warning"
              variant="outline"
              :loading="reopeningId === sub.id"
              @click="handleReopen(sub)"
            >
              Request Correction / Reopen
            </UButton>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
