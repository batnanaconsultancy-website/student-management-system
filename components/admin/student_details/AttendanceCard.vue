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
    { icon: 'i-lucide-presentation', label: 'Workshops', ...a.workshops, colorType: 'info' },
    { icon: 'i-lucide-users', label: 'Stand-ups', ...a.standups, colorType: 'info' },
    { icon: 'i-lucide-user-check', label: 'Mentoring', ...a.mentoring, colorType: 'info' },
    { icon: 'i-lucide-calendar-check', label: 'Overall', ...a.total, colorType: 'success' },
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
</script>

<template>
  <div>
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
  </div>
</template>
