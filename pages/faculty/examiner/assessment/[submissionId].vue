<script setup lang="ts">
// pages/faculty/examiner/assessment/[submissionId].vue
//
// FORM 1 / FORM 2 from the spec (Sections 9-14): the actual grading
// form, used for both "submission" and "presentation" assessment
// types. The assessment_type returned by the API drives the title
// and submit button label.
//
// Read-only once SUBMITTED (Section 19), unless an admin has reopened it.

definePageMeta({
  layout: "faculty" as any,
  middleware: ["faculty", "examiner"] as any,
});

const route = useRoute();
const submissionId = computed(() => String(route.params.submissionId));

const { showSuccess, showError } = useNotifications();

const loading = ref(true);
const error = ref<string | null>(null);
const data = ref<any>(null);

// Indexed lookups can return undefined.
const grades = ref<Record<string, number | null | undefined>>({});

const signatureText = ref("");
const saving = ref(false);
const submitting = ref(false);

async function fetchAssessment() {
  loading.value = true;
  error.value = null;

  try {
    const res = await $fetch(`/api/examiner/assessment/${submissionId.value}`);

    data.value = res?.data;

    grades.value = Object.fromEntries(
      (data.value?.criteria || []).map((c: any) => [c.id, c.grade]),
    );

    // Pre-fill own signature if already signed.
    const ownSignature = data.value?.signatures?.find(
      (s: any) => s.examinerId === data.value?.examiner?.id,
    );

    signatureText.value = ownSignature?.signatureText || "";
  } catch (err: any) {
    error.value =
      err?.data?.statusMessage ||
      err?.message ||
      "Unable to load this assessment.";
  } finally {
    loading.value = false;
  }
}

onMounted(fetchAssessment);

const averageGrade = computed(() => {
  const criteria = data.value?.criteria || [];

  if (criteria.length === 0) {
    return null;
  }

  const values = criteria.map((c: any) => grades.value[c.id]);

  if (
    values.some((v: number | null | undefined) => v === null || v === undefined)
  ) {
    return null;
  }

  const sum = values.reduce(
    (total: number, value: number | null | undefined) => total + Number(value),
    0,
  );

  return Math.round((sum / criteria.length) * 100) / 100;
});

const assessmentTitle = computed(() =>
  data.value?.assessmentType === "presentation"
    ? "Final Project Presentation Assessment"
    : "Final Project Submission Assessment",
);

const submitLabel = computed(() =>
  data.value?.assessmentType === "presentation"
    ? "Submit Final Project Presentation"
    : "Submit Final Project Submission",
);

function validateGrade(
  criterion: any,
  value: number | null | undefined,
): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return false;
  }

  return numericValue >= 0 && numericValue <= Number(criterion.maxGrade);
}

const hasInvalidGrade = computed(() =>
  (data.value?.criteria || []).some(
    (c: any) => !validateGrade(c, grades.value[c.id]),
  ),
);

async function handleSaveDraft() {
  saving.value = true;

  try {
    await $fetch(`/api/examiner/assessment/${submissionId.value}/save`, {
      method: "POST",
      body: {
        grades: grades.value,
        signatureText: signatureText.value,
      },
    });

    showSuccess("Draft saved");

    await fetchAssessment();
  } catch (err: any) {
    showError(
      "Failed to save",
      err?.data?.statusMessage || err?.message || "Please try again.",
    );
  } finally {
    saving.value = false;
  }
}

async function handleSubmit() {
  if (hasInvalidGrade.value) {
    showError(
      "Invalid grades",
      "Check that every grade is within its allowed range.",
    );

    return;
  }

  const missing = (data.value?.criteria || []).some(
    (c: any) => grades.value[c.id] === null || grades.value[c.id] === undefined,
  );

  if (missing) {
    showError(
      "Missing grades",
      "Every criterion needs a grade before you can submit.",
    );

    return;
  }

  if (!signatureText.value.trim()) {
    showError(
      "Signature required",
      "Type your name as your signature before submitting.",
    );

    return;
  }

  if (
    !confirm(
      "Submit this assessment? Once submitted, grades become read-only and can only be changed if an admin reopens it.",
    )
  ) {
    return;
  }

  submitting.value = true;

  try {
    await $fetch(`/api/examiner/assessment/${submissionId.value}/submit`, {
      method: "POST",
      body: {
        grades: grades.value,
        signatureText: signatureText.value,
      },
    });

    showSuccess("Assessment submitted", "The admin has been notified.");

    await fetchAssessment();
  } catch (err: any) {
    showError(
      "Failed to submit",
      err?.data?.statusMessage || err?.message || "Please try again.",
    );
  } finally {
    submitting.value = false;
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
            to="/faculty/examiner"
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
      <div v-if="loading" class="space-y-3 max-w-2xl">
        <USkeleton class="h-8 w-1/2" />

        <USkeleton v-for="i in 4" :key="i" class="h-10 w-full" />
      </div>

      <div v-else-if="error" class="flex items-center justify-center h-64">
        <UCard class="max-w-md">
          <div class="text-center space-y-3">
            <UIcon
              name="i-lucide-alert-triangle"
              class="size-8 text-error mx-auto"
            />

            <h3 class="text-lg font-semibold">Can't open this assessment</h3>

            <p class="text-muted text-sm">
              {{ error }}
            </p>
          </div>
        </UCard>
      </div>

      <div v-else-if="data" class="max-w-2xl space-y-6">
        <UBadge v-if="data.isReadOnly" color="success" variant="subtle">
          Submitted
          {{ data.status === "SUBMITTED" ? "— read-only" : "" }}
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
            <p class="font-medium text-highlighted">Assessment Criteria</p>
          </template>

          <div class="space-y-3">
            <div
              v-for="c in data.criteria"
              :key="c.id"
              class="flex items-center justify-between gap-4"
            >
              <label class="text-sm">
                {{ c.label }}
              </label>

              <div class="flex items-center gap-2 shrink-0">
                <UInput
                  v-model.number="grades[c.id]"
                  type="number"
                  :min="0"
                  :max="c.maxGrade"
                  :disabled="data.isReadOnly"
                  class="w-24"
                  :color="!validateGrade(c, grades[c.id]) ? 'error' : undefined"
                />

                <span class="text-xs text-muted w-16">
                  / {{ c.maxGrade }}
                </span>
              </div>
            </div>
          </div>

          <div
            class="mt-4 pt-4 border-t border-default flex items-center justify-between"
          >
            <span class="font-medium"> Average Grade </span>

            <span class="text-xl font-semibold text-highlighted">
              {{ averageGrade ?? "—" }}
            </span>
          </div>
        </UCard>

        <!-- Examiner information -->
        <UCard>
          <template #header>
            <p class="font-medium text-highlighted">Examiner Information</p>
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
                    ? "Examiner 1 Signature (you)"
                    : "Examiner Signature"
                }}
              </label>

              <UInput
                v-model="signatureText"
                placeholder="Type your full name to sign"
                :disabled="data.isReadOnly"
                class="w-full"
              />
            </div>

            <div v-for="co in data.coExaminers" :key="co.id">
              <label class="block text-xs text-muted mb-1">
                Examiner 2 Name
              </label>

              <UInput :model-value="co.name" disabled class="w-full mb-1.5" />

              <label class="block text-xs text-muted mb-1">
                Examiner 2 Signature
              </label>

              <UInput
                :model-value="
                  data.signatures?.find((s: any) => s.examinerId === co.id)
                    ?.signatureText || '(not yet signed)'
                "
                disabled
                class="w-full"
              />
            </div>
          </div>
        </UCard>

        <div v-if="!data.isReadOnly" class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="outline"
            :loading="saving"
            @click="handleSaveDraft"
          >
            Save Draft
          </UButton>

          <UButton :loading="submitting" @click="handleSubmit">
            {{ submitLabel }}
          </UButton>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
