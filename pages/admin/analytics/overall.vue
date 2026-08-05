<script setup>
definePageMeta({
  layout: "default",
  middleware: ["admin"],
});

import BarCharSingle from '~/components/admin/analytics/BarCharSingle.vue';
import StudentStatCard from '~/components/StudentStatCard.vue';
import { useAttendance } from '~/composables/useAttendance';
import { onMounted, ref } from 'vue'

// reactive analytics data (will be populated from the API)
const attendanceOverall = ref(null)
const attendanceWorkshop = ref(null)
const attendanceMentoring = ref(null)
const attendanceStandup = ref(null)

const attendanceOverallPct = ref(null)

const SumWorkshopAttended = ref(0)
const SumMentoringAttended = ref(0)
const SumStandupAttended = ref(0)
const studentCount = ref(0)
const overallMax = ref(0)

const isDataFetched = ref(false)

const { data: attendanceData, dataByCohort, error: attendanceError, loading: attendanceLoading, fetchAttendance, fetchAttendanceByCohort } = useAttendance()

onMounted(async () => {
  await fetchAttendance()
  await fetchAttendanceByCohort()
  const metrics = attendanceData.value ?? []
  for (const m of metrics) {
    if (m.metric === 'overall_avg') attendanceOverall.value = m.value
    if (m.metric === 'workshop_avg') attendanceWorkshop.value = m.value
    if (m.metric === 'mentoring_avg') attendanceMentoring.value = m.value
    if (m.metric === 'standup_avg') attendanceStandup.value = m.value
    if (m.metric === 'overall_pct') attendanceOverallPct.value = m.value
    if (m.metric === 'workshop_attended') SumWorkshopAttended.value = m.count
    if (m.metric === 'mentoring_attended') SumMentoringAttended.value = m.count
    if (m.metric === 'standup_attended') SumStandupAttended.value = m.count
    if (m.metric === 'student_count') studentCount.value = m.count
    if (m.metric === 'overall_max') overallMax.value = m.count
  }
  isDataFetched.value = true
})
</script>

<template>
    <div class="flex items-center gap-2 mb-1">
      <h2 class="text-sm font-medium text-muted uppercase tracking-wide">Overall Attendance %</h2>
      <UTooltip
        arrow
        text="No 'expected sessions' count is tracked, so % is relative: each student's attended sessions divided by the highest attended count org-wide, averaged across all students. 100% = matches the top attendee."
        :delay-duration="0"
      >
        <UIcon name="i-lucide-info" class="text-muted size-4 cursor-pointer" />
      </UTooltip>
    </div>

    <div class="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 md:gap-4 mb-4 sm:mb-6">
      <StudentStatCard
        title="Attendance % (vs top student)"
        :count="attendanceOverallPct"
        suffix="%"
        icon="i-lucide-percent"
        icon-color="success"
        rounded-class="rounded-lg"
      />

      <StudentStatCard
        title="Top Attendee (sessions)"
        :count="overallMax"
        icon="i-lucide-trophy"
        icon-color="warning"
        rounded-class="rounded-lg"
      />
    </div>

    <div class="grid grid-cols-1 grid-rows-2 gap-4 sm:gap-6 md:grid-cols-2 md:grid-rows-2 lg:grid-cols-2 lg:grid-rows-2 lg:gap-4 xl:grid-cols-4 xl:grid-rows-1 xl:gap-px">
        <StudentStatCard
            title="Avg Attendance / Student"
            :count="attendanceOverall"
            icon="i-pajamas:tachometer"
            icon-color="info"
            rounded-class="rounded-lg xl:rounded-none xl:rounded-l-lg"
        />

        <StudentStatCard
            title="Avg Workshops / Student"
            :count="attendanceWorkshop"
            icon="i-pajamas:terminal"
            icon-color="info"
            rounded-class="rounded-lg xl:rounded-none"
        />

        <StudentStatCard
            title="Avg Mentorings / Student"
            :count="attendanceMentoring"
            icon="i-pajamas:issue-type-enhancement"
            icon-color="info"
            rounded-class="rounded-lg xl:rounded-none"
        />

        <StudentStatCard
            title="Avg Stand-Ups / Student"
            :count="attendanceStandup"
            icon="i-pajamas:image-comment-light"
            icon-color="info"
            rounded-class="rounded-lg xl:rounded-none xl:rounded-r-lg"
        />
    </div>

    <UCard
      class="flex flex-col items-center overflow-y-auto h-full"
      :ui="{
        root: 'relative sm:min-h-[600px]',
        header: 'w-full border-b border-border px-4 xl:px-6 flex items-center gap-2 sticky top-0 z-10',
        body: 'w-full flex justify-center items-center h-full',
      }"
    >
      <template #header>
          <h1 class="text-highlighted text-lg font-semibold">Attendance Overview</h1>

          <UTooltip arrow text="Shows total attended sessions and average attendances per student, for each meeting type." :delay-duration="0">
              <UIcon name="i-lucide-info" class="text-muted text-currentColor size- cursor-pointer" />
          </UTooltip>
      </template>

        <BarCharSingle
          v-if="isDataFetched"
          :sumWorkshopAttended="SumWorkshopAttended"
          :sumStandupAttended="SumStandupAttended"
          :sumMentoringAttended="SumMentoringAttended"
          :studentCount="studentCount"
        />
    </UCard>
</template>