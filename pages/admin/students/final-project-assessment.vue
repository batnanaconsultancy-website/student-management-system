<script setup lang="ts">
// pages/students/final-project-assessment.vue
//
// Section 15/17: the student's own status checklist. Read-only --
// students can see where they stand but can't change any of it.

definePageMeta({
  layout: 'custom',
})

const { showError } = useNotifications()
const loading = ref(true)
const status = ref<any>(null)

async function fetchStatus() {
  loading.value = true
  try {
    const res = await $fetch('/api/students/final-project-assessment')
    status.value = res?.data
  } catch (err: any) {
    showError('Failed to load status', err?.data?.statusMessage || err?.message)
  } finally {
    loading.value = false
  }
}

onMounted(fetchStatus)

function submittedStatus(s: any) {
  return s?.status === 'SUBMITTED'
}

const overallColor = computed(() => {
  if (status.value?.overallStatus === 'FINAL PROJECT ASSESSMENT COMPLETED') return 'success'
  if (status.value?.overallStatus === 'PRESENTATION PENDING') return 'warning'
  return 'neutral'
})
</script>

<template>
  <UDashboardPanel id="student-final-project-assessment" :ui="{ body: 'overflow-auto' }">
    <template #header>
      <UDashboardNavbar title="Final Project Assessment">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="loading" class="max-w-xl space-y-3">
        <USkeleton class="h-10 w-full" />
        <USkeleton class="h-10 w-full" />
        <USkeleton class="h-10 w-full" />
      </div>

      <div v-else-if="!status?.hasAssignment" class="max-w-xl">
        <UCard>
          <div class="text-center py-6 text-muted">
            <UIcon name="i-lucide-clipboard-list" class="size-8 mx-auto mb-3" />
            <p>Your Final Project Assessment hasn't started yet.</p>
            <p class="text-xs mt-1">Check back once your program sets this up for you.</p>
          </div>
        </UCard>
      </div>

      <div v-else class="max-w-xl space-y-4">
        <UCard>
          <template #header>
            <p class="font-medium text-highlighted">Final Project Assessment</p>
          </template>

          <div class="space-y-3">
            <div class="flex items-center gap-2">
              <UIcon :name="status.season04Confirmed ? 'i-lucide-check-circle-2' : 'i-lucide-circle'" :class="status.season04Confirmed ? 'text-success' : 'text-muted'" class="size-5" />
              <span class="text-sm">Season 04 Completed</span>
            </div>
            <div class="flex items-center gap-2">
              <UIcon :name="submittedStatus(status.submission) ? 'i-lucide-check-circle-2' : 'i-lucide-circle'" :class="submittedStatus(status.submission) ? 'text-success' : 'text-muted'" class="size-5" />
              <span class="text-sm">Final Project Submission</span>
              <span v-if="status.submission?.averageGrade != null" class="text-xs text-muted">(Grade: {{ status.submission.averageGrade }})</span>
            </div>
            <div class="flex items-center gap-2">
              <UIcon :name="submittedStatus(status.presentation) ? 'i-lucide-check-circle-2' : 'i-lucide-circle'" :class="submittedStatus(status.presentation) ? 'text-success' : 'text-muted'" class="size-5" />
              <span class="text-sm">Final Project Presentation</span>
              <span v-if="status.presentation?.averageGrade != null" class="text-xs text-muted">(Grade: {{ status.presentation.averageGrade }})</span>
            </div>
          </div>

          <div class="mt-4 pt-4 border-t border-default flex items-center justify-between">
            <span class="text-sm font-medium">Status</span>
            <UBadge :color="overallColor" variant="subtle">{{ status.overallStatus }}</UBadge>
          </div>
        </UCard>

        <p v-if="status.examiners?.length" class="text-xs text-muted">
          Examiner(s): {{ status.examiners.join(', ') }}
        </p>
        <p v-if="!status.assessmentActivated" class="text-xs text-muted">
          Your assessment hasn't been activated yet -- your examiner can't start grading until then.
        </p>
      </div>
    </template>
  </UDashboardPanel>
</template>
