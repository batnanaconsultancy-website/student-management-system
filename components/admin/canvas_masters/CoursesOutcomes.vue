<script setup lang="ts">
const props = defineProps<{
  student: {
    canvasSynced: boolean
    courses: Array<{
      courseId: number
      courseName: string
      outcomes: Array<{
        outcomeId: number
        title: string
        groupName: string | null
        assignments: Array<{
          assignmentId: number
          name: string
          submitted: boolean
          workflowState: string
          submittedAt: string | null
          late: boolean
        }>
      }>
    }>
  }
}>()

const expandedCourseKey = ref<string | null>(props.student.courses[0] ? String(props.student.courses[0].courseId) : null)
const expandedOutcomeGroupKey = ref<string | null>(null)
const expandedOutcomeKey = ref<string | null>(null)

function toggleCourse(courseId: number) {
  const key = String(courseId)
  expandedCourseKey.value = expandedCourseKey.value === key ? null : key
  expandedOutcomeGroupKey.value = null
  expandedOutcomeKey.value = null
}

function toggleOutcomeGroup(courseId: number, groupName: string) {
  const key = `${courseId}::${groupName}`
  expandedOutcomeGroupKey.value = expandedOutcomeGroupKey.value === key ? null : key
  expandedOutcomeKey.value = null
}

function toggleOutcome(courseId: number, outcomeId: number) {
  const key = `${courseId}::${outcomeId}`
  expandedOutcomeKey.value = expandedOutcomeKey.value === key ? null : key
}

// Canvas courses can define dozens of very granular outcomes (a real
// example: 48 for one course). Shown as one flat list they're hard to
// scan, so this groups them by group_name -- the same field the
// Competency Matrix tab on the regular Canvas page already uses for its
// section headers -- so a course's outcomes read as a handful of named
// categories you can drill into, not 48 undifferentiated rows.
function groupOutcomes(outcomes: any[]) {
  const groups = new Map<string, any[]>()
  for (const o of outcomes) {
    const key = o.groupName || 'Ungrouped'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(o)
  }
  return [...groups.entries()].map(([groupName, groupOutcomesList]) => {
    const totalAssignments = groupOutcomesList.reduce((sum, o) => sum + o.assignments.length, 0)
    const submittedAssignments = groupOutcomesList.reduce(
      (sum, o) => sum + o.assignments.filter((a: any) => a.submitted).length,
      0
    )
    return { groupName, outcomes: groupOutcomesList, totalAssignments, submittedAssignments }
  })
}

function courseSubmissionTotals(course: { outcomes: any[] }) {
  let total = 0
  let submitted = 0
  for (const o of course.outcomes) {
    total += o.assignments.length
    submitted += o.assignments.filter((a: any) => a.submitted).length
  }
  return { total, submitted }
}
</script>

<template>
  <UCard :ui="{ body: '!p-0' }">
    <template #header>
      <p class="font-medium text-highlighted">Courses, Outcomes &amp; Submissions</p>
    </template>

    <div v-if="!student.canvasSynced" class="px-6 py-6 text-sm text-muted">
      Not resolved on Canvas yet — use "Sync From Canvas" on the roster page. If it still doesn't
      resolve after that, this email may not match a Canvas account (typo, or the student hasn't
      logged into Canvas yet).
    </div>
    <div v-else-if="student.courses.length === 0" class="px-6 py-6 text-sm text-muted">
      Resolved on Canvas, but not currently enrolled in any course as a student.
    </div>

    <div v-else class="divide-y divide-default">
      <div v-for="c in student.courses" :key="c.courseId">
        <button
          class="w-full flex items-center justify-between gap-3 px-6 py-3 text-left hover:bg-elevated/40 transition-colors"
          @click="toggleCourse(c.courseId)"
        >
          <span class="flex items-center gap-2 text-sm font-medium text-highlighted">
            <UIcon name="i-lucide-graduation-cap" class="size-4 text-muted" />
            {{ c.courseName }}
          </span>
          <span class="flex items-center gap-2 shrink-0">
            <UBadge color="neutral" variant="subtle" size="sm">{{ groupOutcomes(c.outcomes).length }} outcome groups</UBadge>
            <UBadge
              :color="courseSubmissionTotals(c).total > 0 && courseSubmissionTotals(c).submitted === courseSubmissionTotals(c).total ? 'success' : 'neutral'"
              variant="subtle"
              size="sm"
            >
              {{ courseSubmissionTotals(c).submitted }}/{{ courseSubmissionTotals(c).total }} submitted
            </UBadge>
            <UIcon
              :name="expandedCourseKey === String(c.courseId) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              class="size-4 text-muted"
            />
          </span>
        </button>

        <!-- Learning outcome groups within this course -->
        <div v-if="expandedCourseKey === String(c.courseId)" class="bg-elevated/20">
          <div v-if="c.outcomes.length === 0" class="px-10 py-2 text-xs text-muted">
            No learning outcomes synced for this course.
          </div>
          <div v-for="g in groupOutcomes(c.outcomes)" :key="g.groupName" class="border-t border-default">
            <button
              class="w-full flex items-center justify-between gap-3 px-10 py-2 text-left hover:bg-elevated/40 transition-colors"
              @click="toggleOutcomeGroup(c.courseId, g.groupName)"
            >
              <span class="text-sm font-medium text-highlighted">{{ g.groupName }}</span>
              <span class="flex items-center gap-2 shrink-0">
                <UBadge color="neutral" variant="subtle" size="sm">{{ g.outcomes.length }} outcomes</UBadge>
                <UBadge
                  :color="g.totalAssignments > 0 && g.submittedAssignments === g.totalAssignments ? 'success' : 'neutral'"
                  variant="subtle"
                  size="sm"
                >
                  {{ g.submittedAssignments }}/{{ g.totalAssignments }} submitted
                </UBadge>
                <UIcon
                  :name="expandedOutcomeGroupKey === `${c.courseId}::${g.groupName}` ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                  class="size-3.5 text-muted"
                />
              </span>
            </button>

            <!-- Individual outcomes within this group -->
            <div v-if="expandedOutcomeGroupKey === `${c.courseId}::${g.groupName}`" class="bg-elevated/20">
              <div v-for="o in g.outcomes" :key="o.outcomeId" class="border-t border-default">
                <button
                  class="w-full flex items-center justify-between gap-3 px-14 py-2 text-left hover:bg-elevated/40 transition-colors"
                  @click="toggleOutcome(c.courseId, o.outcomeId)"
                >
                  <span class="text-sm text-highlighted">{{ o.title }}</span>
                  <span class="flex items-center gap-2 shrink-0">
                    <UBadge color="neutral" variant="subtle" size="sm">
                      {{ o.assignments.filter((a) => a.submitted).length }}/{{ o.assignments.length }} submitted
                    </UBadge>
                    <UIcon
                      :name="expandedOutcomeKey === `${c.courseId}::${o.outcomeId}` ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                      class="size-3.5 text-muted"
                    />
                  </span>
                </button>

                <!-- Assignments aligned to this outcome -->
                <div v-if="expandedOutcomeKey === `${c.courseId}::${o.outcomeId}`" class="px-16 pb-2 space-y-1">
                  <div v-if="o.assignments.length === 0" class="text-xs text-muted py-1 pl-4">
                    No assignments aligned to this outcome in Canvas.
                  </div>
                  <div
                    v-for="a in o.assignments"
                    :key="a.assignmentId"
                    class="flex items-center justify-between gap-3 py-1 pl-4 text-xs"
                  >
                    <span class="flex items-center gap-1.5 text-muted">
                      <UIcon
                        :name="a.submitted ? 'i-lucide-check-circle-2' : 'i-lucide-circle'"
                        class="size-3.5 shrink-0"
                        :class="a.submitted ? 'text-success' : 'text-muted'"
                      />
                      {{ a.name }}
                    </span>
                    <span class="flex items-center gap-1.5 shrink-0 text-muted">
                      <UBadge v-if="a.late" color="warning" variant="subtle" size="sm">late</UBadge>
                      {{ a.submitted ? 'Submitted' : 'Not submitted' }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </UCard>
</template>
