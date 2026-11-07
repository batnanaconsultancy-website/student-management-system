<script setup lang="ts">
definePageMeta({
  layout: 'default',
  middleware: ['admin'],
})
</script>

<template>
  <UDashboardPanel id="assessment-management">
    <template #header>
      <UDashboardNavbar title="Assessment Management">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-6">
        <div>
          <h2 class="text-xl font-semibold text-highlighted">
            Assessment Management
          </h2>
          <p class="text-sm text-muted mt-1">
            Manage formal assessments and review the evidence used to support
            student progression decisions.
          </p>
        </div>

        <UAlert
          color="info"
          variant="subtle"
          title="Assessment portfolio implementation"
          description="The student evidence view is being introduced first. Programme-specific thresholds, faculty student assignments, Assessment Manager permissions and formal review workflows will be enabled only after their rules and access controls are verified."
        />

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <UCard>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-clipboard-check" class="size-5" />
                <h3 class="font-semibold">Final Project Assessment</h3>
              </div>
            </template>

            <p class="text-sm text-muted">
              Existing examiner assignments, submission and presentation
              assessment, moderation and assessment history.
            </p>

            <UButton
              class="mt-4"
              to="/admin/final-project-assessment"
              color="primary"
            >
              Open Final Project Assessment
            </UButton>
          </UCard>

          <UCard>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-folder-check" class="size-5" />
                <h3 class="font-semibold">Student Evidence Portfolio</h3>
              </div>
            </template>

            <p class="text-sm text-muted">
              Low-stakes attendance, medium-stakes project completion and
              Season progress are being connected to a unified portfolio.
            </p>

            <UBadge class="mt-4" color="warning" variant="subtle">
              Evidence overview in development
            </UBadge>
          </UCard>

          <UCard>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-calendar-check" class="size-5" />
                <h3 class="font-semibold">Formal Assessment Reviews</h3>
              </div>
            </template>

            <p class="text-sm text-muted">
              Formal review periods, evidence sufficiency checks and
              Progress Continue / Progress Pause decisions.
            </p>

            <UBadge class="mt-4" color="neutral" variant="subtle">
              Rules configuration pending
            </UBadge>
          </UCard>

          <UCard>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-users" class="size-5" />
                <h3 class="font-semibold">VIVA and Examiner Management</h3>
              </div>
            </template>

            <p class="text-sm text-muted">
              Mini VIVA and final VIVA scheduling, examiner assignment,
              rubrics and recorded outcomes.
            </p>

            <UBadge class="mt-4" color="neutral" variant="subtle">
              Programme rules verification pending
            </UBadge>
          </UCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
