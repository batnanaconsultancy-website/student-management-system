<script setup>
// components/admin/student_details/AttendanceCard.vue
//
// Shows this student's attendance as a PERCENTAGE relative to the top
// attendee in their cohort for each category (workshops, stand-ups,
// mentoring, total) -- the top attendee in a category counts as 100%,
// everyone else is scored relative to that. Computing "top in cohort"
// needs every student in the same cohort, not just this one, so it's
// fetched from a dedicated endpoint (server/api/students/:id/cohort-attendance.get.js)
// rather than reusing the raw counts already on the `student` prop.

const props = defineProps({
  student: {
    type: Object,
    required: true,
  },
})

const attendance = ref(null)
const loading = ref(true)
const error = ref(null)

async function fetchCohortAttendance() {
  if (!props.student?.id) return
  loading.value = true
  error.value = null
  try {
    const res = await $fetch(`/api/students/${props.student.id}/cohort-attendance`)
    attendance.value = res?.data || null
  } catch (err) {
    error.value = err?.data?.statusMessage || err.message
  } finally {
    loading.value = false
  }
}

watch(() => props.student?.id, fetchCohortAttendance, { immediate: true })

const stats = computed(() => {
  if (!attendance.value) return []
  const a = attendance.value
  return [
    { icon: 'i-lucide-presentation', label: 'Workshops', ...a.workshops, pointsMax: 3, colorType: 'info' },
    { icon: 'i-lucide-users', label: 'Stand-ups', ...a.standups, pointsMax: 1, colorType: 'info' },
    { icon: 'i-lucide-user-check', label: 'Mentoring', ...a.mentoring, pointsMax: 3, colorType: 'info' },
    { icon: 'i-lucide-calendar-check', label: 'Overall', ...a.total, pointsMax: 7, colorType: 'success' },
  ]
})

const getIconColorClass = (iconColor) => {
  const colorMap = {
    info: 'bg-info/10 ring-info/25 text-blue-500',
    success: 'bg-success/10 ring-success/25 text-green-500',
    error: 'bg-error/10 ring-error/25 text-red-500',
    warning: 'bg-warning/10 ring-warning/25 text-yellow-500',
  }
  return colorMap[iconColor] || 'bg-primary/10 ring-primary/25 text-purple-500'
}

const barColorClass = (iconColor) => {
  const colorMap = {
    info: 'bg-blue-500',
    success: 'bg-green-500',
    error: 'bg-red-500',
    warning: 'bg-yellow-500',
  }
  return colorMap[iconColor] || 'bg-primary'
}

const formatAuditReason = (reason) => {
  const labels = {
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

const formatSessionType = (type) => ({
  workshop: 'Workshop',
  mentoring: 'Mentoring',
  standup: 'Stand-up',
  squad_meeting: 'Squad Meeting',
  unknown: 'Unknown session type',
})[type] || type?.replaceAll('_', ' ')

const formatEligibilityStatus = (status) =>
  status === 'unresolved' ? 'Unresolved' : 'Excluded'
</script>

<template>
  <div>
    <p class="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
      Low-stakes evidence
    </p>
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-clipboard-check" class="size-4 text-muted" />
        <h3 class="text-sm font-medium text-highlighted">Attendance</h3>
      </div>
      <p v-if="attendance" class="text-xs text-muted">
        Relative to top attendee in cohort ({{ attendance.cohortSize }} student{{ attendance.cohortSize === 1 ? '' : 's' }})
      </p>
    </div>

    <div v-if="loading" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <USkeleton v-for="i in 4" :key="i" class="h-24 w-full rounded-lg" />
    </div>

    <div v-else-if="error" class="text-sm text-muted py-4">
      Couldn't load cohort attendance: {{ error }}
    </div>

    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <UPageCard
        v-for="stat in stats"
        :key="stat.label"
        :title="stat.label"
        variant="subtle"
        :icon="stat.icon"
        :ui="{
          container: 'gap-y-1.5',
          wrapper: 'items-start',
          title: 'font-medium text-muted text-xs uppercase',
          leading: `p-2.5 rounded-full ${getIconColorClass(stat.colorType)} ring ring-inset flex-col`,
        }"
        class="hover:z-1 hover:bg-elevated"
      >
        <p class="text-lg lg:text-xl xl:text-xl text-highlighted font-semibold">{{ stat.percent }}%</p>
        <p class="text-sm font-medium text-highlighted mt-1">
          {{ Number(stat.points || 0).toFixed(2) }} / {{ stat.pointsMax.toFixed(2) }} points
        </p>
        <div class="w-full h-1.5 rounded-full bg-elevated overflow-hidden mt-1.5">
          <div
            class="h-full rounded-full transition-all"
            :class="barColorClass(stat.colorType)"
            :style="{ width: `${stat.percent}%` }"
          />
        </div>
        <p class="text-xs text-muted mt-1">{{ stat.value }} / {{ stat.max }} (top attendee)</p>
      </UPageCard>
    </div>

    <div
      v-if="!loading && !error && attendance?.audit?.uses_ledger"
      class="mt-5 rounded-lg border border-default p-4 space-y-4"
    >
      <div>
        <h4 class="text-sm font-semibold text-highlighted">Attendance audit</h4>
        <p class="text-xs text-muted mt-1">
          Verified attendance above remains the only source for current percentages and points.
        </p>
      </div>

      <div>
        <p class="text-sm font-medium text-highlighted">Historical legacy counters</p>
        <p class="text-xs text-muted mb-2">
          Historical and unverified; excluded from current attendance and points.
        </p>
        <div class="grid grid-cols-3 gap-3">
          <div class="rounded-lg bg-elevated p-3">
            <p class="text-xs text-muted">Workshops</p>
            <p class="font-semibold">{{ attendance.audit.legacy.workshops ?? '—' }}</p>
          </div>
          <div class="rounded-lg bg-elevated p-3">
            <p class="text-xs text-muted">Mentoring</p>
            <p class="font-semibold">{{ attendance.audit.legacy.mentoring ?? '—' }}</p>
          </div>
          <div class="rounded-lg bg-elevated p-3">
            <p class="text-xs text-muted">Stand-ups</p>
            <p class="font-semibold">{{ attendance.audit.legacy.standups ?? '—' }}</p>
          </div>
        </div>
      </div>

      <div>
        <div class="flex items-center justify-between gap-2 mb-2">
          <p class="text-sm font-medium text-highlighted">Unverified submissions</p>
          <UBadge color="warning" variant="subtle">
            {{ attendance.audit.unverified_total }} records
          </UBadge>
        </div>
        <p v-if="!attendance.audit.unverified_by_reason.length" class="text-sm text-muted">
          No student-associated unverified submissions were found.
        </p>
        <div v-else class="divide-y divide-default">
          <div
            v-for="(item, index) in attendance.audit.unverified_by_reason"
            :key="`${item.eligibility_status}-${item.reason}-${item.session_type}-${index}`"
            class="py-3 flex flex-wrap justify-between gap-2"
          >
            <div>
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
  </div>
</template>
