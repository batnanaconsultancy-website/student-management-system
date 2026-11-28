<script setup lang="ts">
definePageMeta({
  layout: 'examiner',
  middleware: ['examiner'],
})

const route = useRoute()
const { showError, showSuccess } = useNotifications()
const loading = ref(true)
const requesting = ref(false)
const savingReview = ref(false)
const publishing = ref(false)
const approvedScore = ref<number | null>(null)
const approvedGrade = ref('')
const examinerFeedback = ref('')
const assessment = ref<any>(null)

async function loadAssessment() {
  loading.value = true
  try {
    const response: any = await $fetch(`/api/examiner/canvas-assessment/${route.params.attemptId}`)
    assessment.value = response?.data || null
    approvedScore.value = assessment.value?.latestReview?.review_score ?? assessment.value?.latestReview?.approved_score ?? assessment.value?.latestResult?.suggested_score ?? null
    approvedGrade.value = assessment.value?.latestReview?.review_grade ?? assessment.value?.latestReview?.approved_grade ?? assessment.value?.latestResult?.suggested_grade ?? ''
    examinerFeedback.value = assessment.value?.latestReview?.examiner_feedback ?? assessment.value?.latestResult?.overall_feedback ?? ''
  } catch (error: any) {
    showError('Could not load Canvas assessment', error?.data?.statusMessage || error.message)
  } finally {
    loading.value = false
  }
}

async function saveExaminerReview(status: 'draft' | 'approved') {
  if (!assessment.value?.latestResult?.id) return
  savingReview.value = true
  try {
    await $fetch(`/api/examiner/canvas-assessment/${route.params.attemptId}/review`, {
      method: 'POST',
      body: {
        gradingResultId: assessment.value.latestResult.id,
        status,
        score: approvedScore.value,
        grade: approvedGrade.value,
        feedback: examinerFeedback.value,
      },
    })
    showSuccess(status === 'approved' ? 'Grade approved' : 'Review saved', status === 'approved'
      ? 'The approved grade is ready for explicit publishing to Canvas.'
      : 'Your Examiner review has been saved as a draft.')
    await loadAssessment()
  } catch (error: any) {
    showError('Could not save Examiner review', error?.data?.statusMessage || error.message)
  } finally {
    savingReview.value = false
  }
}

async function publishApprovedGrade() {
  if (!assessment.value?.latestReview?.id) return
  publishing.value = true
  try {
    await $fetch(`/api/examiner/canvas-assessment/${route.params.attemptId}/publish`, {
      method: 'POST',
      body: { reviewId: assessment.value.latestReview.id },
    })
    showSuccess('Grade published to Canvas', 'Canvas accepted the Examiner-approved grade.')
    await loadAssessment()
  } catch (error: any) {
    showError('Could not publish grade', error?.data?.statusMessage || error.message)
  } finally {
    publishing.value = false
  }
}

async function requestAiGrading() {
  requesting.value = true
  try {
    const response: any = await $fetch(`/api/examiner/canvas-assessment/${route.params.attemptId}/grade`, {
      method: 'POST',
    })
    showSuccess('AI grading request queued', response?.data?.message || 'The request has been queued.')
    await loadAssessment()
  } catch (error: any) {
    showError('Could not queue AI grading', error?.data?.statusMessage || error.message)
  } finally {
    requesting.value = false
  }
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

onMounted(loadAssessment)
</script>

<template>
  <UDashboardPanel id="canvas-examiner-assessment">
    <template #header>
      <UDashboardNavbar title="Canvas Assessment">
        <template #leading>
          <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" to="/examiner/dashboard" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="loading" class="space-y-3">
        <USkeleton class="h-24 w-full" />
        <USkeleton class="h-48 w-full" />
      </div>
      <div v-else-if="!assessment" class="py-12 text-center text-muted">
        Assessment evidence is unavailable or you are not assigned to this assessment.
      </div>
      <template v-else>
        <UCard class="mb-4">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p class="text-xs text-muted uppercase tracking-wide">{{ assessment.scope === 'canvas_bachelor' ? 'Canvas Bachelor' : 'Canvas Masters' }}</p>
              <h2 class="text-lg font-semibold text-highlighted mt-1">{{ assessment.assignment?.name || 'Canvas assignment' }}</h2>
              <p class="text-sm text-muted mt-1">{{ assessment.course?.name }} · {{ assessment.student?.name || 'Canvas student' }}</p>
              <p class="text-xs text-muted mt-1">{{ assessment.student?.email }} · Attempt {{ assessment.attempt.attempt }} · Submitted {{ formatDate(assessment.attempt.submitted_at) }}</p>
            </div>
            <div class="flex flex-col items-end gap-2">
              <UBadge :color="assessment.attempt.is_latest ? 'success' : 'neutral'" variant="subtle">
                {{ assessment.attempt.is_latest ? 'Latest attempt' : 'Historical attempt' }}
              </UBadge>
              <UButton
                icon="i-lucide-sparkles"
                :loading="requesting"
                :disabled="['queued', 'processing', 'completed'].includes(assessment.latestJob?.status)"
                @click="requestAiGrading"
              >
                Request AI grading
              </UButton>
            </div>
          </div>
        </UCard>

        <UAlert
          color="info"
          variant="subtle"
          title="Examiner approval remains authoritative"
          description="AI output is an advisory suggestion only. It does not change the approved grade or publish anything to Canvas."
          class="mb-4"
        />

        <UCard class="mb-4">
          <div class="flex items-center justify-between gap-3 mb-3">
            <h3 class="font-semibold text-highlighted">Submission evidence</h3>
            <UBadge color="neutral" variant="subtle">Captured {{ formatDate(assessment.attempt.captured_at) }}</UBadge>
          </div>
          <div v-if="assessment.attempt.body" class="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">{{ assessment.attempt.body }}</div>
          <p v-else class="text-sm text-muted">No text body was included in this Canvas attempt.</p>
          <p v-if="assessment.attempt.url" class="text-sm mt-3">
            <a :href="assessment.attempt.url" target="_blank" rel="noopener noreferrer" class="text-primary underline">Open submitted URL</a>
          </p>
          <div v-if="assessment.attempt.attachments?.length" class="mt-4 border-t border-default pt-3">
            <h4 class="text-sm font-medium text-highlighted mb-2">Attachments</h4>
            <div v-for="file in assessment.attempt.attachments" :key="`${file.id}-${file.filename}`" class="flex items-center justify-between gap-3 py-2">
              <div class="min-w-0">
                <p class="text-sm truncate">{{ file.display_name || file.filename }}</p>
                <p class="text-xs text-muted">{{ file.content_type || 'File' }} · {{ file.size || 'Unknown size' }} bytes</p>
              </div>
              <a v-if="file.downloadUrl" :href="file.downloadUrl" target="_blank" rel="noopener noreferrer" class="text-sm text-primary underline shrink-0">Open file</a>
              <UBadge v-else color="warning" variant="subtle">{{ file.download_status }}</UBadge>
            </div>
          </div>
        </UCard>

        <UCard class="mb-4">
          <h3 class="font-semibold text-highlighted mb-3">Canvas rubric snapshot</h3>
          <div v-if="assessment.rubric?.rubric?.length" class="space-y-3">
            <div v-for="criterion in assessment.rubric.rubric" :key="criterion.id" class="border-b border-default pb-3 last:border-0">
              <div class="flex items-center justify-between gap-3">
                <p class="text-sm font-medium">{{ criterion.description || criterion.long_description || criterion.id }}</p>
                <span class="text-xs text-muted">{{ criterion.points }} points</span>
              </div>
              <p v-if="criterion.long_description" class="text-xs text-muted mt-1">{{ criterion.long_description }}</p>
              <div v-if="criterion.ratings?.length" class="mt-2 flex flex-wrap gap-2">
                <UBadge v-for="rating in criterion.ratings" :key="rating.id" color="neutral" variant="subtle">
                  {{ rating.description }} · {{ rating.points }}
                </UBadge>
              </div>
            </div>
            <p class="text-xs text-muted">Rubric version {{ assessment.rubric.version_hash?.slice(0, 12) }} · Captured {{ formatDate(assessment.rubric.captured_at) }}</p>
          </div>
          <p v-else class="text-sm text-muted">No Canvas rubric snapshot was available for this assignment.</p>
        </UCard>

        <UCard>
          <div class="flex items-center justify-between gap-3 mb-3">
            <h3 class="font-semibold text-highlighted">AI grading status</h3>
            <UBadge v-if="assessment.latestJob" :color="assessment.latestJob.status === 'completed' ? 'success' : assessment.latestJob.status === 'failed' ? 'error' : 'info'" variant="subtle">
              {{ assessment.latestJob.status }}
            </UBadge>
            <UBadge v-else color="neutral" variant="subtle">Not requested</UBadge>
          </div>
          <p v-if="assessment.latestJob?.last_error" class="text-sm text-error mb-3">{{ assessment.latestJob.last_error }}</p>
          <div v-if="assessment.latestResult" class="space-y-3">
            <div class="flex flex-wrap gap-4">
              <div>
                <p class="text-xs text-muted">Suggested score</p>
                <p class="text-2xl font-semibold">{{ assessment.latestResult.suggested_score ?? '—' }}<span v-if="assessment.assignment?.points_possible" class="text-sm text-muted"> / {{ assessment.assignment.points_possible }}</span></p>
              </div>
              <div>
                <p class="text-xs text-muted">Model</p>
                <p class="text-sm font-medium">{{ assessment.latestResult.provider }} · {{ assessment.latestResult.model }}</p>
              </div>
            </div>
            <p v-if="assessment.latestResult.overall_feedback" class="text-sm whitespace-pre-wrap">{{ assessment.latestResult.overall_feedback }}</p>
            <div v-if="assessment.latestResult.criterion_feedback?.length" class="space-y-2">
              <div v-for="(criterion, index) in assessment.latestResult.criterion_feedback" :key="index" class="rounded-lg bg-elevated/40 p-3">
                <p class="text-sm font-medium">{{ criterion.criterion || criterion.name || `Criterion ${index + 1}` }}</p>
                <p class="text-sm text-muted mt-1">{{ criterion.feedback || criterion.rationale }}</p>
                <p v-if="criterion.suggested_score != null" class="text-xs text-muted mt-1">Suggested: {{ criterion.suggested_score }}</p>
              </div>
            </div>
          </div>
          <p v-else class="text-sm text-muted">
            {{ assessment.latestJob ? 'The request is waiting for the AI grading worker/provider.' : 'No AI suggestion has been generated for this attempt.' }}
          </p>

          <div v-if="assessment.latestResult" class="border-t border-default mt-4 pt-4">
            <div v-if="assessment.latestReview?.status === 'approved'" class="space-y-3">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <p class="text-sm font-semibold text-highlighted">Examiner-approved grade</p>
                  <p class="text-xs text-muted">Approved {{ formatDate(assessment.latestReview.approved_at) }}</p>
                </div>
                <UBadge color="success" variant="subtle">Approved</UBadge>
              </div>
              <p class="text-lg font-semibold">{{ assessment.latestReview.approved_score ?? assessment.latestReview.approved_grade }}</p>
              <p v-if="assessment.latestReview.examiner_feedback" class="text-sm text-muted whitespace-pre-wrap">{{ assessment.latestReview.examiner_feedback }}</p>
              <div v-if="assessment.latestPublishJob?.status === 'published'" class="space-y-1">
                <UBadge color="success" variant="subtle">Published to Canvas</UBadge>
                <p class="text-xs text-muted">Published {{ formatDate(assessment.latestPublishJob.created_at) }}.</p>
              </div>
              <div v-else class="space-y-1">
                <UButton icon="i-lucide-upload" :loading="publishing" :disabled="['queued', 'processing'].includes(assessment.latestPublishJob?.status)" @click="publishApprovedGrade">
                  Publish approved grade to Canvas
                </UButton>
                <p class="text-xs text-muted">Publishing is a separate, explicit action and will update the Canvas gradebook.</p>
                <p v-if="assessment.latestPublishJob?.last_error" class="text-xs text-error">{{ assessment.latestPublishJob.last_error }}</p>
              </div>
            </div>
            <div v-else class="space-y-3">
              <div>
                <h4 class="text-sm font-semibold text-highlighted">Examiner decision</h4>
                <p class="text-xs text-muted mt-1">Review the AI suggestion, adjust it, and save a draft or approve the final score.</p>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <UFormField label="Approved score">
                  <UInput v-model.number="approvedScore" type="number" min="0" :max="assessment.assignment?.points_possible ?? undefined" class="w-full" />
                </UFormField>
                <UFormField label="Grade (optional)">
                  <UInput v-model="approvedGrade" placeholder="e.g. A, Pass" class="w-full" />
                </UFormField>
              </div>
              <UFormField label="Examiner feedback">
                <UTextarea v-model="examinerFeedback" :rows="4" class="w-full" placeholder="Feedback for the student…" />
              </UFormField>
              <div class="flex flex-wrap gap-2">
                <UButton color="neutral" variant="outline" :loading="savingReview" @click="saveExaminerReview('draft')">Save draft</UButton>
                <UButton :loading="savingReview" @click="saveExaminerReview('approved')">Approve final grade</UButton>
              </div>
              <p class="text-xs text-muted">Approval does not publish the grade. Use the separate publish action after approval.</p>
            </div>
          </div>
        </UCard>
      </template>
    </template>
  </UDashboardPanel>
</template>
