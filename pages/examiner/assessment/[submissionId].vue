<script setup lang="ts">
// pages/examiner/assessment/[submissionId].vue
//
// Final Project assessment page.
//
// SUBMISSION:
// - Supports any number of assigned examiners.
// - Each examiner has an independent grading column.
// - Only the logged-in examiner's DRAFT column is editable.
// - Submitted examiner columns are read-only.
// - Letter grades are calculated per criterion.
// - Each examiner has an independent average, letter grade and decision.
// - Overall result appears only after every assigned examiner submits.
//
// PRESENTATION:
// - Existing presentation behaviour is preserved for now.
// - Presentation will be redesigned separately.

definePageMeta({
  layout: 'examiner',
  middleware: ['examiner'],
})

const route = useRoute()
const submissionId = computed(() => String(route.params.submissionId))
const { showSuccess, showError } = useNotifications()

const loading = ref(true)
const error = ref<string | null>(null)
const data = ref<any>(null)

const grades = ref<Record<string, number | null>>({})
const signatureText = ref('')
const feedback = ref('')
const recommendations = ref('')

const saving = ref(false)
const submitting = ref(false)

const regradingReason = ref('')
const requestingRegrading = ref(false)


// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function round2(value: number) {
  return Math.round(value * 100) / 100
}

function letterGrade(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null
  }

  const grade = Number(value)

  if (grade >= 88) return 'E'
  if (grade >= 74) return 'G'
  if (grade >= 60) return 'S'
  if (grade >= 53) return 'F'
  return 'P'
}

function decisionForGrade(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null
  }

  return Number(value) >= 60 ? 'PASS' : 'FAIL'
}

function letterClass(letter: string | null | undefined) {
  if (!letter) return 'text-muted'

  if (letter === 'E') return 'text-success font-semibold'
  if (letter === 'G') return 'text-primary font-semibold'
  if (letter === 'S') return 'text-warning font-semibold'
  if (letter === 'F') return 'text-error font-semibold'
  if (letter === 'P') return 'text-error font-semibold'

  return 'text-muted'
}

function decisionColor(decision: string | null | undefined) {
  if (decision === 'PASS') return 'success'
  if (decision === 'FAIL') return 'error'
  return 'neutral'
}


// -----------------------------------------------------------------------------
// Fetch
// -----------------------------------------------------------------------------

async function fetchAssessment() {
  loading.value = true
  error.value = null

  try {
    const res = await $fetch(`/api/examiner/assessment/${submissionId.value}`)

    data.value = res?.data

    // -------------------------------------------------------------------------
    // Submission assessment
    // -------------------------------------------------------------------------
    if (data.value?.assessmentType === 'submission') {
      const currentExaminer =
        data.value?.examiners?.find((examiner: any) => examiner.isCurrent) ||
        null

      grades.value = Object.fromEntries(
        (data.value?.criteria || []).map((criterion: any) => [
          criterion.id,
          currentExaminer?.grades?.[criterion.id] ?? null,
        ]),
      )

      signatureText.value = currentExaminer?.signature || ''
      feedback.value = currentExaminer?.feedback || ''
      recommendations.value = currentExaminer?.recommendations || ''

      return
    }

    // -------------------------------------------------------------------------
    // Presentation assessment - preserve existing behaviour
    // -------------------------------------------------------------------------
    grades.value = Object.fromEntries(
      (data.value?.criteria || []).map((criterion: any) => [
        criterion.id,
        criterion.grade,
      ]),
    )

    const ownSignature = data.value?.signatures?.find(
      (signature: any) =>
        signature.examinerId === data.value?.examiner?.id,
    )

    signatureText.value = ownSignature?.signatureText || ''

  } catch (err: any) {
    error.value =
      err?.data?.statusMessage ||
      err?.message ||
      'Unable to load this assessment.'
  } finally {
    loading.value = false
  }
}

onMounted(fetchAssessment)


// -----------------------------------------------------------------------------
// Basic page information
// -----------------------------------------------------------------------------

const isSubmission = computed(
  () => data.value?.assessmentType === 'submission',
)

const isPresentation = computed(
  () => data.value?.assessmentType === 'presentation',
)

const assessmentTitle = computed(() =>
  isPresentation.value
    ? 'Final Project Presentation Assessment'
    : 'Final Project Submission Assessment',
)

const submitLabel = computed(() =>
  isPresentation.value
    ? 'Submit Final Project Presentation'
    : 'Submit Final Project Submission',
)


// -----------------------------------------------------------------------------
// PRESENTATION - existing single-examiner calculation
// -----------------------------------------------------------------------------

const presentationAverageGrade = computed(() => {
  if (!isPresentation.value) return null

  const criteria = data.value?.criteria || []

  if (criteria.length === 0) return null

  const values = criteria.map(
    (criterion: any) => grades.value[criterion.id],
  )

  if (
    values.some(
      (value: any) =>
        value === null ||
        value === undefined ||
        value === '',
    )
  ) {
    return null
  }

  const sum = values.reduce(
    (total: number, value: number) => total + Number(value),
    0,
  )

  return round2(sum / criteria.length)
})


// -----------------------------------------------------------------------------
// SUBMISSION - current examiner
// -----------------------------------------------------------------------------

const currentExaminer = computed(() => {
  if (!isSubmission.value) return null

  return (
    data.value?.examiners?.find(
      (examiner: any) => examiner.isCurrent,
    ) || null
  )
})

const currentExaminerStatus = computed(() =>
  currentExaminer.value?.status || 'DRAFT',
)

const currentExaminerAverage = computed(() => {
  if (!isSubmission.value) return null

  const criteria = data.value?.criteria || []

  if (criteria.length === 0) return null

  const values = criteria.map(
    (criterion: any) => grades.value[criterion.id],
  )

  if (
    values.some(
      (value: any) =>
        value === null ||
        value === undefined ||
        value === '',
    )
  ) {
    return null
  }

  const numericValues = values.map((value: any) => Number(value))

  if (numericValues.some((value: number) => Number.isNaN(value))) {
    return null
  }

  return round2(
    numericValues.reduce(
      (total: number, value: number) => total + value,
      0,
    ) / numericValues.length,
  )
})

const currentExaminerLetter = computed(() =>
  letterGrade(currentExaminerAverage.value),
)

const currentExaminerDecision = computed(() =>
  decisionForGrade(currentExaminerAverage.value),
)


// -----------------------------------------------------------------------------
// Submission overall result
// -----------------------------------------------------------------------------

const overall = computed(() => {
  if (!isSubmission.value) return null

  return data.value?.overall || null
})

const allExaminersSubmitted = computed(() => {
  if (!isSubmission.value) return false

  const examiners = data.value?.examiners || []

  if (examiners.length === 0) return false

  return examiners.every(
    (examiner: any) => examiner.status === 'SUBMITTED',
  )
})


// -----------------------------------------------------------------------------
// Editing state
// -----------------------------------------------------------------------------

const canEditSubmission = computed(() => {
  if (!isSubmission.value) return false

  const isDraft =
    currentExaminerStatus.value === 'DRAFT'

  const isApprovedRegrading =
    currentExaminerStatus.value === 'SUBMITTED' &&
    data.value?.regrading?.approved === true

  return (
    currentExaminer.value?.isCurrent &&
    currentExaminer.value?.canEdit &&
    (isDraft || isApprovedRegrading)
  )
})

const canEditPresentation = computed(() => {
  if (!isPresentation.value) return false

  return !data.value?.isReadOnly
})

const isEditable = computed(() =>
  isSubmission.value
    ? canEditSubmission.value
    : canEditPresentation.value,
)


// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

function validateGrade(
  criterion: any,
  value: number | null,
) {
  if (
    value === null ||
    value === undefined ||
    value === ('' as any)
  ) {
    return true
  }

  const numericValue = Number(value)

  return (
    !Number.isNaN(numericValue) &&
    numericValue >= 0 &&
    numericValue <= Number(criterion.maxGrade)
  )
}

const hasInvalidGrade = computed(() =>
  (data.value?.criteria || []).some(
    (criterion: any) =>
      !validateGrade(
        criterion,
        grades.value[criterion.id],
      ),
  ),
)

const missingSubmissionGrade = computed(() => {
  if (!isSubmission.value) return false

  return (data.value?.criteria || []).some((criterion: any) => {
    const value = grades.value[criterion.id]
    return value === null || value === undefined || value === ""
  })
})


// -----------------------------------------------------------------------------
// Save draft
// -----------------------------------------------------------------------------

async function handleSaveDraft() {
  if (!isEditable.value) return

  if (hasInvalidGrade.value) {
    showError(
      'Invalid grades',
      'Check that every grade is between 0 and 100.',
    )
    return
  }

  saving.value = true

  try {
    await $fetch(
      `/api/examiner/assessment/${submissionId.value}/save`,
      {
        method: 'POST',
        body: {
          grades: grades.value,
          signatureText: signatureText.value,
          feedback: feedback.value,
          recommendations: recommendations.value,
        },
      },
    )

    showSuccess('Draft saved')

    await fetchAssessment()

  } catch (err: any) {
    showError(
      'Failed to save',
      err?.data?.statusMessage ||
        err?.message ||
        'Please try again.',
    )
  } finally {
    saving.value = false
  }
}


// -----------------------------------------------------------------------------
// Submit
// -----------------------------------------------------------------------------

async function handleSubmit() {
  if (!isEditable.value) return

  if (hasInvalidGrade.value) {
    showError(
      'Invalid grades',
      'Check that every grade is between 0 and 100.',
    )
    return
  }

  if (isSubmission.value && missingSubmissionGrade.value) {
    showError(
      'Missing grades',
      'Every criterion needs a grade before you can submit.',
    )
    return
  }

  if (!isSubmission.value) {
    const missing = (data.value?.criteria || []).some(
      (criterion: any) =>
        grades.value[criterion.id] === null ||
        grades.value[criterion.id] === undefined,
    )

    if (missing) {
      showError(
        'Missing grades',
        'Every criterion needs a grade before you can submit.',
      )
      return
    }
  }

  if (!String(signatureText.value ?? '').trim()) {
    showError(
      'Signature required',
      'Type your full name as your signature before submitting.',
    )
    return
  }

  const confirmationMessage = isSubmission.value
    ? 'Submit your Final Project Submission assessment? Once submitted, your grades become read-only unless an administrator approves a re-grading request.'
    : 'Submit this assessment? Once submitted, grades become read-only and can only be changed if an admin reopens it.'

  if (!confirm(confirmationMessage)) return

  submitting.value = true

  try {
    const response = await $fetch(
      `/api/examiner/assessment/${submissionId.value}/submit`,
      {
        method: 'POST',
        body: {
          grades: grades.value,
          signatureText: signatureText.value,
          feedback: feedback.value,
          recommendations: recommendations.value,
        },
      },
    )

    if (isSubmission.value) {
      if (response?.data?.overall?.available) {
        showSuccess(
          'Assessment submitted',
          'All assigned examiners have now submitted. The overall result has been calculated.',
        )
      } else {
        showSuccess(
          'Assessment submitted',
          'Your assessment has been submitted. The overall result will be calculated after all assigned examiners submit.',
        )
      }
    } else {
      showSuccess(
        'Assessment submitted',
        'The admin has been notified.',
      )
    }

    await fetchAssessment()

  } catch (err: any) {
    showError(
      'Failed to submit',
      err?.data?.statusMessage ||
        err?.message ||
        'Please try again.',
    )
  } finally {
    submitting.value = false
  }
}


// -----------------------------------------------------------------------------
// Request re-grading
// -----------------------------------------------------------------------------

async function handleRequestRegrading() {
  if (!isSubmission.value) return

  const reason = regradingReason.value.trim()

  if (!reason) {
    showError(
      'Reason required',
      'Please explain why you are requesting permission to re-grade this assessment.',
    )
    return
  }

  if (reason.length > 2000) {
    showError(
      'Reason too long',
      'The re-grading reason must be 2000 characters or fewer.',
    )
    return
  }

  if (data.value?.regrading?.approved === true) {
    showError(
      'Re-grading already approved',
      'You already have permission to re-grade this assessment.',
    )
    return
  }

  if (data.value?.regrading?.request?.status === 'PENDING') {
    showError(
      'Request already pending',
      'Your re-grading request is already waiting for administrator review.',
    )
    return
  }

  if (
    !confirm(
      'Submit this re-grading request to the administrator?'
    )
  ) {
    return
  }

  requestingRegrading.value = true

  try {
    await $fetch(
      `/api/examiner/assessment/${submissionId.value}/request-regrading`,
      {
        method: 'POST',
        body: {
          reason,
        },
      },
    )

    showSuccess(
      'Re-grading requested',
      'Your request has been sent to the administrator for review.',
    )

    regradingReason.value = ''

    await fetchAssessment()
  } catch (err: any) {
    showError(
      'Failed to request re-grading',
      err?.data?.statusMessage ||
        err?.message ||
        'Please try again.',
    )
  } finally {
    requestingRegrading.value = false
  }
}
</script>

<template>
  <UDashboardPanel
    id="examiner-assessment-form"
    :ui="{ body: 'overflow-auto' }"
  >
    <template #header>
      <UDashboardNavbar
        :title="
          data?.student?.name
            ? `${assessmentTitle} — ${data.student.name}`
            : assessmentTitle
        "
      >
        <template #leading>
          <UDashboardSidebarCollapse />

          <UButton
            to="/examiner/dashboard"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            size="sm"
            class="ml-1"
          >
            Back
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <!-- Loading -->
      <div
        v-if="loading"
        class="space-y-4"
      >
        <USkeleton class="h-10 w-1/2" />
        <USkeleton class="h-20 w-full" />
        <USkeleton class="h-96 w-full" />
      </div>

      <!-- Error -->
      <div
        v-else-if="error"
        class="flex items-center justify-center h-64"
      >
        <UCard class="max-w-md">
          <div class="text-center space-y-3">
            <UIcon
              name="i-lucide-alert-triangle"
              class="size-8 text-error mx-auto"
            />

            <h3 class="text-lg font-semibold">
              Can't open this assessment
            </h3>

            <p class="text-muted text-sm">
              {{ error }}
            </p>
          </div>
        </UCard>
      </div>

      <!-- Main -->
      <div
        v-else-if="data"
        class="w-full max-w-[1800px] mx-auto space-y-6"
      >

        <!-- ================================================================ -->
        <!-- SUBMISSION -->
        <!-- ================================================================ -->

        <template v-if="isSubmission">

          <!-- Status -->
          <div class="flex flex-wrap items-center gap-2">
            <UBadge
              v-if="currentExaminerStatus === 'SUBMITTED'"
              color="success"
              variant="subtle"
            >
              Your assessment submitted
            </UBadge>

            <UBadge
              v-else
              color="warning"
              variant="subtle"
            >
              Your assessment is a draft
            </UBadge>

            <UBadge
              v-if="allExaminersSubmitted"
              color="success"
              variant="subtle"
            >
              All examiners submitted
            </UBadge>

            <UBadge
              v-else
              color="neutral"
              variant="subtle"
            >
              Waiting for all examiners
            </UBadge>
          </div>


          <!-- Explanation -->
          <UAlert
            v-if="!allExaminersSubmitted"
            color="info"
            variant="subtle"
            icon="i-lucide-info"
            title="Overall result pending"
            :description="`${data.examiners?.filter((e: any) => e.status === 'SUBMITTED').length || 0} of ${data.examiners?.length || 0} assigned examiners have submitted. The overall average and final decision will be calculated after everyone submits.`"
          />


          <!-- Grading table -->
          <UCard>
            <template #header>
              <div class="flex flex-col gap-1">
                <p class="font-semibold text-highlighted text-lg">
                  Final Report Grading Grid
                </p>

                <p class="text-sm text-muted">
                  Each examiner grades independently. You can edit only your own column.
                </p>
              </div>
            </template>

            <div class="overflow-x-auto">
              <table class="w-full min-w-[950px] border-collapse">
                <thead>
                  <tr class="border-b border-default">
                    <th
                      class="text-left p-3 font-semibold text-sm min-w-[280px]"
                    >
                      Assessment Criterion
                    </th>

                    <th
                      v-for="examiner in data.examiners"
                      :key="examiner.id"
                      class="p-3 text-center font-semibold text-sm min-w-[220px]"
                    >
                      <div class="space-y-1">
                        <div class="text-highlighted">
                          {{ examiner.name }}
                        </div>

                        <div class="text-xs text-muted">
                          {{ examiner.email }}
                        </div>

                        <UBadge
                          v-if="examiner.isCurrent"
                          color="primary"
                          variant="subtle"
                          size="xs"
                        >
                          You
                        </UBadge>

                        <UBadge
                          v-else-if="examiner.status === 'SUBMITTED'"
                          color="success"
                          variant="subtle"
                          size="xs"
                        >
                          Submitted
                        </UBadge>

                        <UBadge
                          v-else
                          color="neutral"
                          variant="subtle"
                          size="xs"
                        >
                          Not submitted
                        </UBadge>
                      </div>
                    </th>
                  </tr>
                </thead>

                <tbody>
                  <tr
                    v-for="criterion in data.criteria"
                    :key="criterion.id"
                    class="border-b border-default align-top"
                  >
                    <!-- Criterion -->
                    <td class="p-3">
                      <div class="font-medium text-sm">
                        {{ criterion.label }}
                      </div>

                      <div
                        v-if="criterion.description"
                        class="text-xs text-muted mt-1 leading-relaxed"
                      >
                        {{ criterion.description }}
                      </div>

                      <div class="text-xs text-muted mt-1">
                        Maximum: {{ criterion.maxGrade }}
                      </div>
                    </td>

                    <!-- Examiner columns -->
                    <td
                      v-for="examiner in data.examiners"
                      :key="`${examiner.id}-${criterion.id}`"
                      class="p-3 text-center"
                    >
                      <!-- Current examiner -->
                      <template v-if="examiner.isCurrent">
                        <div class="flex flex-col items-center gap-2">
                          <UInput
                            v-model.number="grades[criterion.id]"
                            type="number"
                            :min="0"
                            :max="criterion.maxGrade"
                            :disabled="!canEditSubmission"
                            class="w-28"
                            :color="
                              !validateGrade(
                                criterion,
                                grades[criterion.id],
                              )
                                ? 'error'
                                : undefined
                            "
                          />

                          <div
                            v-if="
                              grades[criterion.id] !== null &&
                              grades[criterion.id] !== undefined &&
                              grades[criterion.id] !== ''
                            "
                            class="text-sm"
                          >
                            <span
                              :class="
                                letterClass(
                                  letterGrade(
                                    Number(grades[criterion.id]),
                                  ),
                                )
                              "
                            >
                              {{
                                letterGrade(
                                  Number(grades[criterion.id]),
                                )
                              }}
                            </span>
                          </div>

                          <span
                            v-else
                            class="text-xs text-muted"
                          >
                            —
                          </span>
                        </div>
                      </template>

                      <!-- Other examiner -->
                      <template v-else>
                        <div
                          v-if="examiner.status === 'SUBMITTED'"
                          class="flex flex-col items-center gap-1"
                        >
                          <div class="text-base font-semibold">
                            {{ examiner.grades?.[criterion.id] ?? '—' }}
                          </div>

                          <div
                            class="text-sm"
                            :class="
                              letterClass(
                                letterGrade(
                                  examiner.grades?.[criterion.id],
                                ),
                              )
                            "
                          >
                            {{
                              letterGrade(
                                examiner.grades?.[criterion.id],
                              ) || '—'
                            }}
                          </div>
                        </div>

                        <span
                          v-else
                          class="text-muted"
                        >
                          —
                        </span>
                      </template>
                    </td>
                  </tr>
                </tbody>

                <!-- Examiner averages -->
                <tfoot>
                  <tr class="border-t-2 border-default">
                    <td class="p-4 font-semibold">
                      Average Grade
                    </td>

                    <td
                      v-for="examiner in data.examiners"
                      :key="`average-${examiner.id}`"
                      class="p-4 text-center"
                    >
                      <template
                        v-if="examiner.isCurrent"
                      >
                        <div
                          v-if="currentExaminerAverage !== null"
                          class="space-y-1"
                        >
                          <div class="text-xl font-bold text-highlighted">
                            {{ currentExaminerAverage }}
                          </div>

                          <div
                            class="font-semibold"
                            :class="
                              letterClass(
                                currentExaminerLetter,
                              )
                            "
                          >
                            {{ currentExaminerLetter }}
                          </div>

                          <UBadge
                            :color="
                              decisionColor(
                                currentExaminerDecision,
                              )"
                            variant="subtle"
                          >
                            {{ currentExaminerDecision }}
                          </UBadge>
                        </div>

                        <span
                          v-else
                          class="text-muted"
                        >
                          —
                        </span>
                      </template>

                      <template v-else>
                        <div
                          v-if="
                            examiner.status === 'SUBMITTED' &&
                            examiner.averageGrade !== null &&
                            examiner.averageGrade !== undefined
                          "
                          class="space-y-1"
                        >
                          <div class="text-xl font-bold text-highlighted">
                            {{ examiner.averageGrade }}
                          </div>

                          <div
                            class="font-semibold"
                            :class="
                              letterClass(
                                examiner.letterGrade,
                              )
                            "
                          >
                            {{ examiner.letterGrade || '—' }}
                          </div>

                          <UBadge
                            :color="
                              decisionColor(
                                examiner.decision,
                              )
                            "
                            variant="subtle"
                          >
                            {{ examiner.decision || '—' }}
                          </UBadge>
                        </div>

                        <span
                          v-else
                          class="text-muted"
                        >
                          —
                        </span>
                      </template>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </UCard>


          <!-- Feedback / recommendations -->
          <div
            class="grid grid-cols-1 xl:grid-cols-2 gap-6"
          >

            <!-- Examiner feedback -->
            <UCard>
              <template #header>
                <div>
                  <p class="font-semibold text-highlighted">
                    Feedback
                  </p>

                  <p class="text-xs text-muted mt-1">
                    Your feedback is saved with your assessment.
                  </p>
                </div>
              </template>

              <UTextarea
                v-model="feedback"
                :disabled="!canEditSubmission"
                :rows="6"
                placeholder="Enter your feedback for the student..."
                class="w-full"
              />

              <!-- Other examiner feedback -->
              <div
                v-if="
                  data.examiners?.some(
                    (examiner: any) =>
                      !examiner.isCurrent &&
                      examiner.status === 'SUBMITTED' &&
                      examiner.feedback,
                  )
                "
                class="mt-5 space-y-3"
              >
                <p class="text-sm font-medium text-highlighted">
                  Other examiner feedback
                </p>

                <div
                  v-for="examiner in data.examiners"
                  :key="`feedback-${examiner.id}`"
                >
                  <div
                    v-if="
                      !examiner.isCurrent &&
                      examiner.status === 'SUBMITTED' &&
                      examiner.feedback
                    "
                    class="rounded-lg border border-default p-3 bg-elevated/30"
                  >
                    <div class="text-xs font-semibold mb-1">
                      {{ examiner.name }}
                    </div>

                    <p class="text-sm text-muted whitespace-pre-wrap">
                      {{ examiner.feedback }}
                    </p>
                  </div>
                </div>
              </div>
            </UCard>


            <!-- Recommendations -->
            <UCard>
              <template #header>
                <div>
                  <p class="font-semibold text-highlighted">
                    Recommendations
                  </p>

                  <p class="text-xs text-muted mt-1">
                    Enter recommendations for improvement or next steps.
                  </p>
                </div>
              </template>

              <UTextarea
                v-model="recommendations"
                :disabled="!canEditSubmission"
                :rows="6"
                placeholder="Enter your recommendations..."
                class="w-full"
              />

              <!-- Other examiner recommendations -->
              <div
                v-if="
                  data.examiners?.some(
                    (examiner: any) =>
                      !examiner.isCurrent &&
                      examiner.status === 'SUBMITTED' &&
                      examiner.recommendations,
                  )
                "
                class="mt-5 space-y-3"
              >
                <p class="text-sm font-medium text-highlighted">
                  Other examiner recommendations
                </p>

                <div
                  v-for="examiner in data.examiners"
                  :key="`recommendation-${examiner.id}`"
                >
                  <div
                    v-if="
                      !examiner.isCurrent &&
                      examiner.status === 'SUBMITTED' &&
                      examiner.recommendations
                    "
                    class="rounded-lg border border-default p-3 bg-elevated/30"
                  >
                    <div class="text-xs font-semibold mb-1">
                      {{ examiner.name }}
                    </div>

                    <p class="text-sm text-muted whitespace-pre-wrap">
                      {{ examiner.recommendations }}
                    </p>
                  </div>
                </div>
              </div>
            </UCard>
          </div>


          <!-- Signatures -->
          <UCard>
            <template #header>
              <div>
                <p class="font-semibold text-highlighted">
                  Examiner Signatures
                </p>

                <p class="text-xs text-muted mt-1">
                  Each examiner signs their own assessment.
                </p>
              </div>
            </template>

            <div
              class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
            >
              <div
                v-for="examiner in data.examiners"
                :key="`signature-${examiner.id}`"
                class="rounded-lg border border-default p-4"
              >
                <div class="flex items-center justify-between gap-2 mb-3">
                  <div>
                    <p class="font-medium text-sm">
                      {{ examiner.name }}
                    </p>

                    <p class="text-xs text-muted">
                      {{ examiner.email }}
                    </p>
                  </div>

                  <UBadge
                    v-if="examiner.status === 'SUBMITTED'"
                    color="success"
                    variant="subtle"
                    size="xs"
                  >
                    Submitted
                  </UBadge>

                  <UBadge
                    v-else
                    color="neutral"
                    variant="subtle"
                    size="xs"
                  >
                    Draft
                  </UBadge>
                </div>

                <!-- Own signature -->
                <template v-if="examiner.isCurrent">
                  <UInput
                    v-model="signatureText"
                    :disabled="!canEditSubmission"
                    placeholder="Type your full name"
                    class="w-full"
                  />
                </template>

                <!-- Other examiner signature -->
                <template v-else>
                  <UInput
                    :model-value="
                      examiner.signature ||
                      '(not yet signed)'
                    "
                    disabled
                    class="w-full"
                  />
                </template>
              </div>
            </div>
          </UCard>


          <!-- Overall result -->
          <UCard>
            <template #header>
              <div>
                <p class="font-semibold text-highlighted text-lg">
                  Overall Final Project Result
                </p>

                <p class="text-sm text-muted mt-1">
                  The overall result is calculated only after every assigned examiner submits.
                </p>
              </div>
            </template>

            <div
              v-if="overall?.available && allExaminersSubmitted"
              class="grid grid-cols-1 md:grid-cols-3 gap-6"
            >
              <div class="text-center">
                <p class="text-xs text-muted">
                  Overall Average
                </p>

                <p class="text-3xl font-bold text-highlighted mt-1">
                  {{ overall.averageGrade }}
                </p>
              </div>

              <div class="text-center">
                <p class="text-xs text-muted">
                  Letter Grade
                </p>

                <p
                  class="text-3xl font-bold mt-1"
                  :class="letterClass(overall.letterGrade)"
                >
                  {{ overall.letterGrade }}
                </p>
              </div>

              <div class="text-center">
                <p class="text-xs text-muted">
                  Final Decision
                </p>

                <div class="mt-2">
                  <UBadge
                    :color="
                      decisionColor(
                        overall.decision,
                      )
                    "
                    variant="subtle"
                    size="lg"
                  >
                    {{ overall.decision }}
                  </UBadge>
                </div>
              </div>
            </div>

            <div
              v-else
              class="text-center py-6"
            >
              <UIcon
                name="i-lucide-hourglass"
                class="size-8 text-muted mx-auto mb-2"
              />

              <p class="font-medium text-highlighted">
                Overall result pending
              </p>

              <p class="text-sm text-muted mt-1">
                {{
                  data.examiners?.filter(
                    (examiner: any) =>
                      examiner.status === 'SUBMITTED',
                  ).length || 0
                }}
                of
                {{ data.examiners?.length || 0 }}
                examiners have submitted.
              </p>
            </div>
          </UCard>


          <!-- Actions -->
          <div
            v-if="canEditSubmission"
            class="flex flex-col sm:flex-row justify-end gap-3"
          >
            <UButton
              color="neutral"
              variant="outline"
              :loading="saving"
              @click="handleSaveDraft"
            >
              Save Draft
            </UButton>

            <UButton
              :loading="submitting"
              @click="handleSubmit"
            >
              Submit Final Project Submission
            </UButton>
          </div>

          <!-- Submitted / re-grading state -->
          <div
            v-else-if="currentExaminerStatus === 'SUBMITTED'"
            class="space-y-4"
          >
            <!-- Approved re-grading -->
            <UAlert
              v-if="data?.regrading?.approved === true"
              color="warning"
              variant="subtle"
              icon="i-lucide-unlock"
              title="Re-grading approved"
              description="An administrator has approved your re-grading request. You may now edit your assessment and submit the revised grades."
            />

            <!-- Pending request -->
            <template v-else-if="data?.regrading?.request?.status === 'PENDING'">
              <UAlert
                color="warning"
                variant="subtle"
                icon="i-lucide-clock"
                title="Your assessment has been submitted"
                :description="
                  `Your re-grading request #${data.regrading.request.requestNumber} is waiting for administrator review. Your grades remain read-only until the request is approved.`
                "
              />
            </template>

            <!-- Submitted with no pending approval -->
            <template v-else>
              <UAlert
                color="success"
                variant="subtle"
                icon="i-lucide-lock"
                title="Your assessment has been submitted"
                description="Your grades and assessment are now read-only. If you need to correct your assessment, you must request administrator permission to re-grade it."
              />

              <UCard>
                <template #header>
                  <div class="space-y-1">
                    <p class="font-medium text-highlighted">
                      Request Re-grading
                    </p>

                    <p class="text-sm text-muted">
                      Explain why you need to make changes to your submitted
                      assessment. The administrator will review your request
                      before editing is enabled.
                    </p>
                  </div>
                </template>

                <div class="space-y-3">
                  <UTextarea
                    v-model="regradingReason"
                    :rows="5"
                    :maxlength="2000"
                    placeholder="Explain the reason for requesting re-grading..."
                    :disabled="requestingRegrading"
                  />

                  <div class="flex justify-between items-center gap-3">
                    <span class="text-xs text-muted">
                      {{ regradingReason.length }}/2000 characters
                    </span>

                    <UButton
                      color="warning"
                      icon="i-lucide-send"
                      :loading="requestingRegrading"
                      :disabled="!regradingReason.trim()"
                      @click="handleRequestRegrading"
                    >
                      Request Re-grading
                    </UButton>
                  </div>
                </div>
              </UCard>
            </template>
          </div>

        </template>


        <!-- ================================================================ -->
        <!-- PRESENTATION - OLD FORM PRESERVED -->
        <!-- ================================================================ -->

        <template v-else-if="isPresentation">

          <UBadge
            v-if="data.isReadOnly"
            color="success"
            variant="subtle"
          >
            Submitted — read-only
          </UBadge>

          <UAlert
            v-else-if="data.reopenReason"
            color="warning"
            variant="subtle"
            title="Reopened for correction"
            :description="data.reopenReason"
          />

          <!-- Criteria table -->
          <UCard>
            <template #header>
              <p class="font-medium text-highlighted">
                Assessment Criteria
              </p>
            </template>

            <div class="space-y-3">
              <div
                v-for="criterion in data.criteria"
                :key="criterion.id"
                class="flex items-center justify-between gap-4"
              >
                <label class="text-sm">
                  {{ criterion.label }}
                </label>

                <div class="flex items-center gap-2 shrink-0">
                  <UInput
                    v-model.number="grades[criterion.id]"
                    type="number"
                    :min="0"
                    :max="criterion.maxGrade"
                    :disabled="data.isReadOnly"
                    class="w-24"
                    :color="
                      !validateGrade(
                        criterion,
                        grades[criterion.id],
                      )
                        ? 'error'
                        : undefined
                    "
                  />

                  <span class="text-xs text-muted w-16">
                    / {{ criterion.maxGrade }}
                  </span>
                </div>
              </div>
            </div>

            <div
              class="mt-4 pt-4 border-t border-default flex items-center justify-between"
            >
              <span class="font-medium">
                Average Grade
              </span>

              <span class="text-xl font-semibold text-highlighted">
                {{ presentationAverageGrade ?? '—' }}
              </span>
            </div>
          </UCard>


          <!-- Examiner info -->
          <UCard>
            <template #header>
              <p class="font-medium text-highlighted">
                Examiner Information
              </p>
            </template>

            <div class="space-y-3">
              <div>
                <label class="block text-xs text-muted mb-1">
                  Examiner Name
                </label>

                <UInput
                  :model-value="data.examiner?.name"
                  disabled
                  class="w-full"
                />
              </div>

              <div>
                <label class="block text-xs text-muted mb-1">
                  {{
                    data.coExaminers?.length
                      ? 'Examiner 1 Signature (you)'
                      : 'Examiner Signature'
                  }}
                </label>

                <UInput
                  v-model="signatureText"
                  placeholder="Type your full name to sign"
                  :disabled="data.isReadOnly"
                  class="w-full"
                />
              </div>

              <div
                v-for="co in data.coExaminers"
                :key="co.id"
              >
                <label class="block text-xs text-muted mb-1">
                  Examiner 2 Name
                </label>

                <UInput
                  :model-value="co.name"
                  disabled
                  class="w-full mb-1.5"
                />

                <label class="block text-xs text-muted mb-1">
                  Examiner 2 Signature
                </label>

                <UInput
                  :model-value="
                    data.signatures?.find(
                      (signature: any) =>
                        signature.examinerId === co.id,
                    )?.signatureText ||
                    '(not yet signed)'
                  "
                  disabled
                  class="w-full"
                />
              </div>
            </div>
          </UCard>


          <div
            v-if="!data.isReadOnly"
            class="flex justify-end gap-2"
          >
            <UButton
              color="neutral"
              variant="outline"
              :loading="saving"
              @click="handleSaveDraft"
            >
              Save Draft
            </UButton>

            <UButton
              :loading="submitting"
              @click="handleSubmit"
            >
              {{ submitLabel }}
            </UButton>
          </div>

        </template>

      </div>
    </template>
  </UDashboardPanel>
</template>

