<script setup lang="ts">
definePageMeta({
  layout: 'custom',
  middleware: ['auth', 'student-only'],
})

interface AssessmentResponse {
  data: {
    student: {
      name: string
      email: string
      program_name: string | null
      cohort_name: string | null
    }
    low_stakes: {
      workshops: number
      mentoring: number
      standups: number
      points: number
      recorded_points: number
      target: number | null
      target_note: string
    }
    medium_stakes: {
      completed_projects: number
      total_projects: number
      projects: Array<{
        id: string
        name: string
        description: string | null
        season_name: string
        is_completed: boolean
      }>
      qwasar_credit_enabled: boolean
      note: string
    }
    season_progress: Array<{
      season_id: string
      season_name: string
      progress_percentage: number
      is_completed: boolean
    }>
    high_stakes: {
      final_project_assessment_available: boolean
      note: string
    }
    is_student_view: boolean
  }
}

const { data: response, pending, error, refresh } =
  await useFetch<AssessmentResponse>('/api/student/assessment')

const assessment = computed(() => response.value?.data)
const lowStakes = computed(() => assessment.value?.low_stakes)
const mediumStakes = computed(() => assessment.value?.medium_stakes)

function formatProgress(value: number) {
  return `${Math.max(0, Math.min(100, value || 0)).toFixed(0)}%`
}
</script>

<template>
  <UDashboardPanel id="student-assessment">
    <template #header>
      <UDashboardNavbar title="Student Assessment">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            size="sm"
            :loading="pending"
            @click="refresh()"
          >
            Refresh
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="pending" class="space-y-4">
        <USkeleton class="h-24 w-full" />
        <USkeleton class="h-40 w-full" />
        <USkeleton class="h-40 w-full" />
      </div>

      <UAlert
        v-else-if="error"
        color="error"
        variant="subtle"
        title="Unable to load your assessment"
        :description="error.message || 'Please try again later.'"
      />

      <div v-else-if="assessment" class="space-y-6">
        <UCard>
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 class="text-xl font-semibold text-highlighted">
                {{ assessment.student.name || 'Student' }}
              </h2>
              <p class="text-sm text-muted">{{ assessment.student.email }}</p>
              <p class="text-sm text-muted mt-1">
                {{ assessment.student.program_name || 'Programme not assigned' }}
                <span v-if="assessment.student.cohort_name">
                  · {{ assessment.student.cohort_name }}
                </span>
              </p>
            </div>
            <UBadge v-if="assessment.is_student_view" color="info" variant="subtle">
              Student View
            </UBadge>
          </div>
        </UCard>

        <section class="space-y-3">
          <div>
            <h2 class="text-lg font-semibold text-highlighted">Low-stakes evidence</h2>
            <p class="text-sm text-muted">
              Recorded participation in workshops, mentoring and stand-ups.
            </p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <UCard>
              <p class="text-sm text-muted">Workshops</p>
              <p class="text-2xl font-semibold">{{ lowStakes?.workshops }}</p>
              <p class="text-xs text-muted">3 points per attendance</p>
            </UCard>
            <UCard>
              <p class="text-sm text-muted">Mentoring</p>
              <p class="text-2xl font-semibold">{{ lowStakes?.mentoring }}</p>
              <p class="text-xs text-muted">3 points per attendance</p>
            </UCard>
            <UCard>
              <p class="text-sm text-muted">Stand-ups</p>
              <p class="text-2xl font-semibold">{{ lowStakes?.standups }}</p>
              <p class="text-xs text-muted">1 point per attendance</p>
            </UCard>
            <UCard>
              <p class="text-sm text-muted">Recorded attendance points</p>
              <p class="text-2xl font-semibold">{{ lowStakes?.recorded_points }}</p>
              <p class="text-xs text-muted">Cumulative total</p>
            </UCard>
          </div>

          <UAlert
            color="info"
            variant="subtle"
            title="How to interpret this evidence"
            :description="lowStakes?.target_note"
          />
        </section>

        <section class="space-y-3">
          <div>
            <h2 class="text-lg font-semibold text-highlighted">Medium-stakes evidence</h2>
            <p class="text-sm text-muted">
              SIS project completion records associated with your programme.
            </p>
          </div>

          <UCard>
            <div class="flex flex-wrap justify-between gap-3">
              <div>
                <p class="text-sm text-muted">Completed projects</p>
                <p class="text-2xl font-semibold">
                  {{ mediumStakes?.completed_projects }} / {{ mediumStakes?.total_projects }}
                </p>
              </div>
            </div>

            <UDivider class="my-4" />

            <div v-if="mediumStakes?.projects.length" class="divide-y divide-default">
              <div
                v-for="project in mediumStakes.projects"
                :key="project.id"
                class="py-3 flex items-start justify-between gap-3"
              >
                <div class="min-w-0">
                  <p class="font-medium text-highlighted">{{ project.name }}</p>
                  <p class="text-xs text-muted">{{ project.season_name }}</p>
                  <p v-if="project.description" class="text-sm text-muted mt-1">
                    {{ project.description }}
                  </p>
                </div>
                <UBadge
                  :color="project.is_completed ? 'success' : 'neutral'"
                  variant="subtle"
                >
                  {{ project.is_completed ? 'Completed' : 'Not completed' }}
                </UBadge>
              </div>
            </div>
            <p v-else class="text-sm text-muted py-3">
              No programme projects are currently available.
            </p>
          </UCard>

          <UAlert color="warning" variant="subtle" :description="mediumStakes?.note" />
        </section>

        <section class="space-y-3">
          <div>
            <h2 class="text-lg font-semibold text-highlighted">Season progress</h2>
            <p class="text-sm text-muted">
              Progress records are shown by Season, separately from assessment decisions.
            </p>
          </div>

          <UCard>
            <div v-if="assessment.season_progress.length" class="space-y-5">
              <div
                v-for="season in assessment.season_progress"
                :key="season.season_id"
                class="space-y-2"
              >
                <div class="flex justify-between gap-3">
                  <span class="font-medium">{{ season.season_name }}</span>
                  <span class="text-sm text-muted">
                    {{ formatProgress(season.progress_percentage) }}
                  </span>
                </div>
                <UProgress :model-value="season.progress_percentage" />
                <p class="text-xs text-muted">
                  {{ season.is_completed ? 'Season completed' : 'In progress' }}
                </p>
              </div>
            </div>
            <p v-else class="text-sm text-muted">
              No Season progress records are available yet.
            </p>
          </UCard>
        </section>

        <section class="space-y-3">
          <div>
            <h2 class="text-lg font-semibold text-highlighted">High-stakes assessment</h2>
            <p class="text-sm text-muted">
              Formal assessment and VIVA evidence.
            </p>
          </div>

          <UCard>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p class="font-medium text-highlighted">Final Project Assessment</p>
                <p class="text-sm text-muted">{{ assessment.high_stakes.note }}</p>
              </div>
              <UButton
                to="/students/final-project-assessment"
                color="primary"
                variant="outline"
              >
                View Final Project Assessment
              </UButton>
            </div>
          </UCard>
        </section>

        <p class="text-xs text-muted">
          This page presents recorded evidence. It does not calculate a progression
          decision or determine whether you have passed an assessment period.
        </p>
      </div>
    </template>
  </UDashboardPanel>
</template>
