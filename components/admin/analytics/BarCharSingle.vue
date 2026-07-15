<script lang="ts" setup>
type MeetingDataItem = {
  meetingType: string
  attendedMeetings: number
  attendancesPerStudent: number
}

const props = defineProps({
  sumWorkshopAttended: { type: Number, required: true },
  sumStandupAttended: { type: Number, required: true },
  sumMentoringAttended: { type: Number, required: true },
  studentCount: { type: Number, required: true },
});

const MeetingData: MeetingDataItem[] = [
  { meetingType: 'Workshop', attendedMeetings: props.sumWorkshopAttended, attendancesPerStudent: props.studentCount > 0 ? Math.round(props.sumWorkshopAttended / props.studentCount) : 0 },
  { meetingType: 'Standup', attendedMeetings: props.sumStandupAttended, attendancesPerStudent: props.studentCount > 0 ? Math.round(props.sumStandupAttended / props.studentCount) : 0 },
  { meetingType: 'Mentoring', attendedMeetings: props.sumMentoringAttended, attendancesPerStudent: props.studentCount > 0 ? Math.round(props.sumMentoringAttended / props.studentCount) : 0 },
]

const MeetingCategories = {
  attendedMeetings: { name: 'Total Attended', color: '#706fe5' },
  attendancesPerStudent: { name: 'Average Attendances per Student', color: '#ffc400' },
}

const xFormatter = (i: number): string => `${MeetingData[i]?.meetingType}`
const yFormatter = (tick: number) => tick.toString()
</script>

<template>
  <BarChart
    class="w-[80%]"
    :data="MeetingData"
    :height="400"
    :categories="MeetingCategories"
    :y-axis="['attendedMeetings', 'attendancesPerStudent']"
    :group-padding="0"
    :bar-padding="0.1"
    :x-num-ticks="1"
    :radius="10"
    :x-formatter="xFormatter"
    :y-formatter="yFormatter"
    :legend-position="LegendPosition.Top"
    :hide-legend="false"
    :y-grid-line="true"
  />
</template>
