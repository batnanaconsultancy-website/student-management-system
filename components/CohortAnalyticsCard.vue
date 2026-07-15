<script setup>
const props = defineProps({
  cohort: {
    type: Object,
    required: true,
  },
});

const stats = computed(() => [
  {
    label: 'Workshop',
    value: props.cohort.attended?.workshop,
    avg: props.cohort.averages?.workshop,
    icon: 'i-lucide-presentation',
  },
  {
    label: 'Standup',
    value: props.cohort.attended?.standup,
    avg: props.cohort.averages?.standup,
    icon: 'i-lucide-users',
  },
  {
    label: 'Mentoring',
    value: props.cohort.attended?.mentoring,
    avg: props.cohort.averages?.mentoring,
    icon: 'i-lucide-message-circle',
  },
]);
</script>

<template>
  <UCard
    class="group transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5"
    :ui="{
      root: 'overflow-hidden',
      header: 'pb-2',
      body: 'pt-0',
    }"
  >
    <template #header>
      <div class="flex items-start justify-between">
        <div>
          <h3 class="text-lg font-semibold text-highlighted group-hover:text-primary transition-colors">
            {{ cohort.cohort_name }}
          </h3>
          <div class="flex items-center gap-1.5 mt-1">
            <UIcon name="i-lucide-users" class="size-3.5 text-muted" />
            <span class="text-sm text-muted">
              {{ cohort.students_count }} student{{ cohort.students_count !== 1 ? 's' : '' }}
            </span>
          </div>
        </div>
      </div>
    </template>

    <!-- Overall average + per-type stats -->
    <div class="flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-6">
      <!-- Overall: total attended sessions this cohort has logged, and the
           average per student -- real numbers, not a percentage of an
           "expected" total that has no real data source. -->
      <div class="flex-shrink-0 text-center">
        <p class="text-3xl font-semibold text-highlighted">
          {{ cohort.averages?.overall ?? 'N/A' }}
        </p>
        <p class="text-xs text-muted mt-1">Avg attended / student</p>
      </div>

      <!-- Stats Grid -->
      <div class="grid grid-cols-3 gap-1 w-full sm:w-auto">
        <div
          v-for="stat in stats"
          :key="stat.label"
          class="rounded-lg p-2 sm:p-2.5 transition-colors"
        >
          <div class="flex items-center gap-1.5 mb-1">
            <UIcon :name="stat.icon" class="size-3.5 text-muted" />
            <span class="text-xs text-muted truncate">{{ stat.label }}</span>
          </div>
          <p class="text-base sm:text-lg font-semibold">
            {{ stat.value ?? 0 }}
          </p>
          <p class="text-xs text-muted">
            {{ stat.avg ?? 0 }} avg/student
          </p>
        </div>
      </div>
    </div>
  </UCard>
</template>
