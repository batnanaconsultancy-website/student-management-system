<script setup>
definePageMeta({
  layout: "default",
  middleware: ["admin"],
});

import { useAttendance } from '~/composables/useAttendance';
import { onMounted, ref, computed } from 'vue';

const { dataByCohort, error: attendanceError, loading: attendanceLoading, fetchAttendanceByCohort } = useAttendance();

// Search and filter states
const searchQuery = ref('');
const selectedSortOption = ref('name');

const sortOptions = [
  { label: 'Cohort Name', value: 'name' },
  { label: 'Student Count', value: 'students' },
  { label: 'Overall Avg / Student', value: 'overall' },
  { label: 'Workshop Avg / Student', value: 'workshop' },
];

onMounted(async () => {
  await fetchAttendanceByCohort();
});

// Computed property for filtered and sorted cohorts
const filteredCohorts = computed(() => {
  if (!dataByCohort.value) return [];

  let cohorts = [...dataByCohort.value];

  // Filter by search query
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    cohorts = cohorts.filter(c =>
      c.cohort_name?.toLowerCase().includes(query)
    );
  }

  // Sort based on selected option
  cohorts.sort((a, b) => {
    switch (selectedSortOption.value) {
      case 'name':
        return (a.cohort_name || '').localeCompare(b.cohort_name || '');
      case 'students':
        return (b.students_count || 0) - (a.students_count || 0);
      case 'overall':
        return (b.averages?.overall || 0) - (a.averages?.overall || 0);
      case 'workshop':
        return (b.averages?.workshop || 0) - (a.averages?.workshop || 0);
      default:
        return 0;
    }
  });

  return cohorts;
});

// Calculate overall statistics across all cohorts
const overallStats = computed(() => {
  if (!dataByCohort.value || dataByCohort.value.length === 0) {
    return {
      totalCohorts: 0,
      totalStudents: 0,
      avgOverallAttendance: null,
      avgWorkshopAttendance: null,
    };
  }

  const totalStudents = dataByCohort.value.reduce((sum, c) => sum + (c.students_count || 0), 0);

  // Calculate weighted averages
  let overallSum = 0;
  let overallWeight = 0;
  let workshopSum = 0;
  let workshopWeight = 0;

  dataByCohort.value.forEach(c => {
    const studentCount = c.students_count || 0;
    if (c.averages?.overall != null) {
      overallSum += c.averages.overall * studentCount;
      overallWeight += studentCount;
    }
    if (c.averages?.workshop != null) {
      workshopSum += c.averages.workshop * studentCount;
      workshopWeight += studentCount;
    }
  });

  return {
    totalCohorts: dataByCohort.value.length,
    totalStudents,
    avgOverallAttendance: overallWeight > 0 ? Math.round((overallSum / overallWeight) * 100) / 100 : null,
    avgWorkshopAttendance: workshopWeight > 0 ? Math.round((workshopSum / workshopWeight) * 100) / 100 : null,
  };
});
</script>

<template>
  <div class="space-y-6">
    <!-- Summary Cards -->
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-px">
      <StudentStatCard
        title="Total Cohorts"
        :count="overallStats.totalCohorts"
        icon="i-pajamas:users"
        icon-color="info"
        rounded-class="rounded-lg xl:rounded-none xl:rounded-l-lg"
      />

      <StudentStatCard
        title="Total Students"
        :count="overallStats.totalStudents"
        icon="i-lucide:graduation-cap"
        icon-color="success"
        rounded-class="rounded-lg xl:rounded-none xl:rounded-r-lg"
      />
    </div>

    <!-- Filters and Search -->
    <div class="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
      <UInput
        v-model="searchQuery"
        icon="i-lucide-search"
        placeholder="Search cohorts..."
        class="w-full sm:w-72"
      />

      <USelect
        v-model="selectedSortOption"
        :items="sortOptions"
        placeholder="Sort by..."
        class="w-full sm:w-48"
      />
    </div>

    <!-- Loading State -->
    <div v-if="attendanceLoading" class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
      <USkeleton class="h-48 rounded-lg" v-for="i in 6" :key="i" />
    </div>

    <!-- Error State -->
    <UCard v-else-if="attendanceError" class="text-center py-12">
      <div class="flex flex-col items-center gap-4">
        <div class="flex size-16 items-center justify-center rounded-full bg-error/10">
          <UIcon name="i-lucide-alert-circle" class="size-8 text-error" />
        </div>
        <div>
          <p class="text-lg font-medium text-highlighted">Error Loading Data</p>
          <p class="text-sm text-muted mt-1">{{ attendanceError }}</p>
        </div>
        <UButton color="primary" variant="soft" @click="fetchAttendanceByCohort">
          Try Again
        </UButton>
      </div>
    </UCard>

    <!-- Empty State -->
    <UCard v-else-if="filteredCohorts.length === 0" class="text-center py-12">
      <div class="flex flex-col items-center gap-4">
        <div class="flex size-16 items-center justify-center rounded-full bg-muted/10">
          <UIcon name="i-lucide-inbox" class="size-8 text-muted" />
        </div>
        <div>
          <p class="text-lg font-medium text-highlighted">No Cohorts Found</p>
          <p class="text-sm text-muted mt-1">
            {{ searchQuery ? 'Try adjusting your search query' : 'No cohort data available' }}
          </p>
        </div>
      </div>
    </UCard>

    <!-- Cohort Cards Grid -->
    <div v-else class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
      <CohortAnalyticsCard
        v-for="cohort in filteredCohorts"
        :key="cohort.cohort_name"
        :cohort="cohort"
      />
    </div>
  </div>
</template>
