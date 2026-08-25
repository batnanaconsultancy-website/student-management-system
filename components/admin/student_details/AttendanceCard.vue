<script setup>
// components/admin/student_details/AttendanceCard.vue
//
// Shows the same three attendance counters as the admin Attendance page
// (pages/admin/attendance.vue), but scoped to a single student, on their
// profile page. Uses the exact same fields already returned by
// GET /api/students/:id (workshops_attended, standup_attended,
// mentoring_attended -- that route does `select('*')` on `students`, so
// no API changes were needed to add this).

const props = defineProps({
  student: {
    type: Object,
    required: true,
  },
})

const stats = computed(() => {
  const workshops = props.student.workshops_attended || 0
  const standups = props.student.standup_attended || 0
  const mentoring = props.student.mentoring_attended || 0

  return [
    {
      icon: 'i-lucide-presentation',
      label: 'Workshops Attended',
      value: workshops,
      colorType: 'info',
    },
    {
      icon: 'i-lucide-users',
      label: 'Stand-ups Attended',
      value: standups,
      colorType: 'info',
    },
    {
      icon: 'i-lucide-user-check',
      label: 'Mentoring Attended',
      value: mentoring,
      colorType: 'info',
    },
    {
      icon: 'i-lucide-calendar-check',
      label: 'Total Attendances',
      value: workshops + standups + mentoring,
      colorType: 'success',
    },
  ]
})

const getIconColor = (iconColor) => {
  const colorMap = {
    info: 'text-blue-500',
    success: 'text-green-500',
    error: 'text-red-500',
    warning: 'text-yellow-500',
  }
  return colorMap[iconColor] || 'text-purple-500'
}

const getIconColorClass = (iconColor) => {
  const colorMap = {
    info: 'bg-info/10 ring-info/25 text-blue-500',
    success: 'bg-success/10 ring-success/25 text-green-500',
    error: 'bg-error/10 ring-error/25 text-red-500',
    warning: 'bg-warning/10 ring-warning/25 text-yellow-500',
  }
  return colorMap[iconColor] || 'bg-primary/10 ring-primary/25 text-purple-500'
}
</script>

<template>
  <div>
    <div class="flex items-center gap-2 mb-3">
      <UIcon name="i-lucide-clipboard-check" class="size-4 text-muted" />
      <h3 class="text-sm font-medium text-highlighted">Attendance</h3>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
  </div>
</template>
