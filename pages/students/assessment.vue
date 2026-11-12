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
      workshops: {
        count: number
        max: number
        percent: number
        points: number
      }
      mentoring: {
        count: number
        max: number
        percent: number
        points: number
      }
      standups: {
        count: number
        max: number
        percent: number
        points: number
      }
      total_points: number
      audit: {
        uses_ledger: boolean
        legacy: {
          workshops: number | null
          mentoring: number | null
          standups: number | null
        }
        unverified_total: number
        unverified_by_reason: Array<{
          eligibility_status: 'excluded' | 'unresolved'
          reason: string | null
          session_type: string
          count: number
        }>
      }
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
      final_project: {
        has_assignment: boolean
        submission: {
          status: string
          grade: number | string | null
          submitted_at: string | null
        } | null
        presentation: {
          status: string
          grade: number | string | null
          submitted_at: string | null
        } | null
      }
      viva_available: boolean
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

function formatAuditReason(reason: string | null) {
  const labels: Record<string, string> = {
    live_status_blank: 'Live attendance status was blank',
    live_status_unavailable: 'Live-attendance field unavailable in source',
    session_type_not_points_eligible: 'Session type does not count toward attendance points',
    season_schedule_gap: 'No matching Season schedule',
    session_date_in_future: 'Session date is in the future',
    session_date_missing: 'Session date missing',
    student_email_not_found: 'Student could not be matched',
  }
  if (!reason) return 'No reason recorded'
  return labels[reason] || reason.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase())
}

function formatSessionType(type: string) {
  const labels: Record<string, string> = {
    workshop: 'Workshop',
    mentoring: 'Mentoring',
    standup: 'Stand-up',
    squad_meeting: 'Squad Meeting',
    unknown: 'Unknown session type',
  }
  return labels[type] || type.replaceAll('_', ' ')
}

function formatEligibilityStatus(status: string) {
  return status === 'unresolved' ? 'Unresolved' : 'Excluded'
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
              Percentages compare your recorded attendance with the highest
              count in your cohort for each category; they are not percentages
              of all sessions offered. Points are calculated from these
              percentages using the category weights.
            </p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <UCard>
              <p class="text-sm text-muted">Workshops</p>
              <p class="text-2xl font-semibold">
                {{ formatProgress(lowStakes?.workshops.percent ?? 0) }}
              </p>
              <p class="text-sm font-medium mt-2">
                {{ (lowStakes?.workshops.points ?? 0).toFixed(2) }} / 3.00 points
              </p>
              <p class="text-xs text-muted mt-1">
                {{ lowStakes?.workshops.count ?? 0 }} / {{ lowStakes?.workshops.max ?? 0 }} attendances
              </p>
            </UCard>

            <UCard>
              <p class="text-sm text-muted">Mentoring</p>
              <p class="text-2xl font-semibold">
                {{ formatProgress(lowStakes?.mentoring.percent ?? 0) }}
              </p>
              <p class="text-sm font-medium mt-2">
                {{ (lowStakes?.mentoring.points ?? 0).toFixed(2) }} / 3.00 points
              </p>
              <p class="text-xs text-muted mt-1">
                {{ lowStakes?.mentoring.count ?? 0 }} / {{ lowStakes?.mentoring.max ?? 0 }} attendances
              </p>
            </UCard>

            <UCard>
              <p class="text-sm text-muted">Stand-ups</p>
              <p class="text-2xl font-semibold">
                {{ formatProgress(lowStakes?.standups.percent ?? 0) }}
              </p>
              <p class="text-sm font-medium mt-2">
                {{ (lowStakes?.standups.points ?? 0).toFixed(2) }} / 1.00 points
              </p>
              <p class="text-xs text-muted mt-1">
                {{ lowStakes?.standups.count ?? 0 }} / {{ lowStakes?.standups.max ?? 0 }} attendances
              </p>
            </UCard>

            <UCard>
              <p class="text-sm text-muted">Total attendance points</p>
              <p class="text-2xl font-semibold">
                {{ (lowStakes?.total_points ?? 0).toFixed(2) }} / 7.00
              </p>
              <p class="text-xs text-muted mt-2">Sum of weighted category points</p>
            </UCard>
          </div>

          <UCard v-if="lowStakes?.audit.uses_ledger">
            <div class="space-y-4">
              <div>
                <h3 class="font-semibold text-highlighted">Attendance audit</h3>
                <p class="text-sm text-muted mt-1">
                  Verified attendance above is the only attendance used for percentages and points.
                </p>
              </div>

              <div>
                <h4 class="text-sm font-medium text-highlighted">Historical legacy counters</h4>
                <p class="text-xs text-muted mb-2">
                  Historical and unverified. These values are not added to current attendance or points.
                </p>
                <div class="grid grid-cols-3 gap-3">
                  <div class="rounded-lg bg-elevated p-3">
                    <p class="text-xs text-muted">Workshops</p>
                    <p class="text-lg font-semibold">{{ lowStakes.audit.legacy.workshops ?? '—' }}</p>
                  </div>
                  <div class="rounded-lg bg-elevated p-3">
                    <p class="text-xs text-muted">Mentoring</p>
                    <p class="text-lg font-semibold">{{ lowStakes.audit.legacy.mentoring ?? '—' }}</p>
                  </div>
                  <div class="rounded-lg bg-elevated p-3">
                    <p class="text-xs text-muted">Stand-ups</p>
                    <p class="text-lg font-semibold">{{ lowStakes.audit.legacy.standups ?? '—' }}</p>
                  </div>
                </div>
              </div>

              <div>
                <div class="flex items-center justify-between gap-3 mb-2">
                  <h4 class="text-sm font-medium text-highlighted">Unverified submissions</h4>
                  <UBadge color="warning" variant="subtle">
                    {{ lowStakes.audit.unverified_total }} records
                  </UBadge>
                </div>
                <p v-if="!lowStakes.audit.unverified_by_reason.length" class="text-sm text-muted">
                  No student-associated unverified submissions were found.
                </p>
                <div v-else class="divide-y divide-default">
                  <div
                    v-for="(item, index) in lowStakes.audit.unverified_by_reason"
                    :key="`${item.eligibility_status}-${item.reason}-${item.session_type}-${index}`"
                    class="py-3 flex flex-wrap items-start justify-between gap-2"
                  >
                    <div class="min-w-0">
                      <p class="text-sm font-medium text-highlighted">{{ formatAuditReason(item.reason) }}</p>
                      <p class="text-xs text-muted mt-1">
                        {{ formatEligibilityStatus(item.eligibility_status) }} · {{ formatSessionType(item.session_type) }}
                      </p>
                    </div>
                    <span class="text-sm font-semibold tabular-nums">{{ item.count }}</span>
                  </div>
                </div>
              </div>
            </div>
          </UCard>

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
                  {{
                    season.is_completed
                      ? 'Season completed'
                      : season.progress_percentage <= 0
                        ? 'Not started'
                        : 'In progress'
                  }}
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
            <div class="space-y-4">
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

              <div v-if="assessment.high_stakes.final_project.has_assignment" class="grid gap-4 sm:grid-cols-2">
                <div class="rounded-lg bg-elevated p-3 space-y-1">
                  <p class="font-medium text-highlighted">Submission</p>
                  <p class="text-sm text-muted">
                    {{ assessment.high_stakes.final_project.submission?.status || 'No submission record' }}
                  </p>
                  <p
                    v-if="assessment.high_stakes.final_project.submission?.status === 'SUBMITTED' && assessment.high_stakes.final_project.submission.grade != null"
                    class="text-sm font-medium text-highlighted"
                  >
                    Grade: {{ assessment.high_stakes.final_project.submission.grade }}
                  </p>
                </div>

                <div class="rounded-lg bg-elevated p-3 space-y-1">
                  <p class="font-medium text-highlighted">Presentation</p>
                  <p class="text-sm text-muted">
                    {{ assessment.high_stakes.final_project.presentation?.status || 'No presentation record' }}
                  </p>
                  <p
                    v-if="assessment.high_stakes.final_project.presentation?.status === 'SUBMITTED' && assessment.high_stakes.final_project.presentation.grade != null"
                    class="text-sm font-medium text-highlighted"
                  >
                    Grade: {{ assessment.high_stakes.final_project.presentation.grade }}
                  </p>
                </div>
              </div>

              <p v-else class="text-sm text-muted">
                No active Final Project Assessment assignment is recorded.
              </p>

              <p class="text-sm text-muted">
                VIVA: {{ assessment.high_stakes.viva_available ? 'Evidence available' : 'VIVA evidence is not yet integrated into this dashboard.' }}
              </p>
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
