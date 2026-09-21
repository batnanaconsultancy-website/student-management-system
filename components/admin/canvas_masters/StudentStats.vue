<script setup lang="ts">
const props = defineProps<{
  student: {
    attendance: {
      meetingsAttended: number
      maxMeetingsInCohort: number
      percent: number
      totalDurationMinutes: number
    }
    courses: Array<{ outcomes: Array<{ assignments: Array<{ submitted: boolean; late: boolean }> }> }>
  }
}>()

function formatMinutes(mins: number) {
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// Flatten every assignment across every course/outcome so we can show
// one overall submission-rate figure, the same underlying data the old
// inline accordion showed per-outcome but rolled up to a single number
// for a quick read.
const submissionTotals = computed(() => {
  let total = 0
  let submitted = 0
  let late = 0
  for (const course of props.student.courses) {
    for (const outcome of course.outcomes) {
      for (const a of outcome.assignments) {
        total += 1
        if (a.submitted) submitted += 1
        if (a.late) late += 1
      }
    }
  }
  return { total, submitted, late, rate: total > 0 ? Math.round((submitted / total) * 100) : null }
})

const stats = computed(() => [
  {
    icon: 'i-lucide-video',
    label: 'Meetings Attended',
    value: `${props.student.attendance.meetingsAttended} / ${props.student.attendance.maxMeetingsInCohort}`,
    colorType: 'info',
  },
  {
    icon: 'i-lucide-percent',
    label: 'Attendance (of top attendee)',
    value: `${props.student.attendance.percent}%`,
    colorType: props.student.attendance.percent >= 75 ? 'success' : props.student.attendance.percent >= 40 ? 'warning' : 'error',
  },
  {
    icon: 'i-lucide-clock',
    label: 'Time in Meetings',
    value: formatMinutes(props.student.attendance.totalDurationMinutes),
    colorType: 'info',
  },
  {
    icon: 'i-lucide-graduation-cap',
    label: 'Courses Enrolled',
    value: props.student.courses.length,
    colorType: 'info',
  },
  {
    icon: 'i-lucide-check-circle',
    label: 'Assignments Submitted',
    value: submissionTotals.value.total > 0
      ? `${submissionTotals.value.submitted} / ${submissionTotals.value.total}`
      : 'N/A',
    colorType: submissionTotals.value.rate === null
      ? 'info'
      : submissionTotals.value.rate === 100
        ? 'success'
        : submissionTotals.value.rate >= 50
          ? 'warning'
          : 'error',
  },
  {
    icon: 'i-lucide-alert-triangle',
    label: 'Late Submissions',
    value: submissionTotals.value.late,
    colorType: submissionTotals.value.late > 0 ? 'warning' : 'success',
  },
])

const getIconColor = (iconColor: string) => {
  const colorMap: Record<string, string> = {
    info: 'text-blue-500',
    success: 'text-green-500',
    error: 'text-red-500',
    warning: 'text-yellow-500',
  }
  return colorMap[iconColor] || 'text-purple-500'
}

const getIconColorClass = (iconColor: string) => {
  const colorMap: Record<string, string> = {
    info: 'bg-info/10 ring-info/25 text-blue-500',
    success: 'bg-success/10 ring-success/25 text-green-500',
    error: 'bg-error/10 ring-error/25 text-red-500',
    warning: 'bg-warning/10 ring-warning/25 text-yellow-500',
  }
  return colorMap[iconColor] || 'bg-primary/10 ring-primary/25 text-purple-500'
}
</script>

<template>
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 h-full">
    <UPageCard
      v-for="stat in stats"
      :key="stat.label"
      :title="stat.label"
      variant="subtle"
      :icon="stat.icon"
      :ui="{
        leadingIcon: `${getIconColor(stat.colorType)} `,
        container: 'gap-y-1.5',
        wrapper: 'items-start',
        title: 'font-medium text-muted text-xs uppercase',
        leading: `p-2.5 rounded-full ${getIconColorClass(stat.colorType)} ring ring-inset flex-col`,
      }"
      class="hover:z-1 hover:bg-elevated"
    >
      <p class="text-lg lg:text-xl xl:text-xl text-highlighted font-semibold">{{ stat.value }}</p>
    </UPageCard>
  </div>
</template>
