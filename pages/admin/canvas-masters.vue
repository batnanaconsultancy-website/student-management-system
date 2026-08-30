<script setup lang="ts">
// pages/admin/canvas-masters.vue
//
// A fixed roster of masters students, spanning every Canvas course each
// one is enrolled in -- not just one selected course, unlike the
// regular Canvas tab. Click a student to see their Program/Cohort,
// meeting attendance (imported from an external Google Sheet), and a
// nested Course -> Learning Outcome -> Assignment tree showing which
// assignments count toward each outcome and whether they've submitted.
//
// "Sync From Canvas" talks to Canvas directly and account-wide: for
// each roster email, it resolves the Canvas account and lists every
// course they're enrolled in, then syncs each discovered course. This
// is orchestrated as many small requests from the browser (one per
// student, then one per course) rather than a single request that does
// everything server-side -- see the comment above syncFromCanvas() for
// why that split matters on serverless hosting.

definePageMeta({
  layout: 'default',
  middleware: ['admin'],
})

const { showSuccess, showError } = useNotifications()

const students = ref<any[]>([])
const syncStatus = ref<{ canvas: string | null; attendance: string | null }>({ canvas: null, attendance: null })
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const attendanceSyncing = ref(false)
const canvasSyncing = ref(false)
const lastCanvasSyncSummary = ref<any>(null)
const syncProgress = ref<{ stage: string; current: number; total: number; label: string } | null>(null)

const expandedStudentId = ref<string | null>(null)
const expandedCourseKey = ref<string | null>(null)
const expandedOutcomeGroupKey = ref<string | null>(null)
const expandedOutcomeKey = ref<string | null>(null)

async function fetchRoster() {
  loading.value = true
  error.value = null
  try {
    const res = await $fetch('/api/admin/canvas-masters/roster')
    students.value = res?.data?.students || []
    syncStatus.value = res?.data?.syncStatus || { canvas: null, attendance: null }
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err.message
  } finally {
    loading.value = false
  }
}

// "Sync From Canvas" used to be a single POST that did everything
// server-side (resolve 24 students, then fully sync every discovered
// course) in one request. On Vercel, that reliably exceeded the
// serverless function's execution time limit -- the function gets
// killed mid-way and the browser just sees a bare 502 with no useful
// message, not a clean error from our own code.
//
// So this is orchestrated here instead, as many small requests:
//   1. one POST /resolve-student per roster email (fast: a couple of
//      Canvas API calls, no course data pulled)
//   2. one POST /api/admin/canvas/sync per DISTINCT course discovered
//      across all students (slower, but still just one course's worth
//      of work -- the same endpoint the regular Canvas page's "Sync
//      Now" button already uses safely)
// Each individual request stays comfortably under any reasonable
// timeout. The tradeoff is it takes longer wall-clock time overall
// (sequential, not parallel) and a failed step doesn't roll back
// earlier ones -- but every write is an upsert, so re-running the
// whole sync after a partial failure is always safe.
async function syncFromCanvas() {
  canvasSyncing.value = true
  const unresolvedEmails: string[] = []
  const courseIdsToSync = new Set<number>()
  let studentsResolved = 0

  try {
    // Guard against the rare case where this is clicked before the
    // initial roster fetch (onMounted) has resolved.
    if (students.value.length === 0) await fetchRoster()
    const emails = students.value.map((s) => s.email)

    syncProgress.value = { stage: 'resolving', current: 0, total: emails.length, label: '' }
    for (const email of emails) {
      syncProgress.value = { stage: 'resolving', current: syncProgress.value!.current + 1, total: emails.length, label: email }
      try {
        const res = await $fetch('/api/admin/canvas-masters/resolve-student', {
          method: 'POST',
          body: { email },
        })
        if (res?.data?.found) {
          studentsResolved += 1
          for (const courseId of res.data.courseIds || []) courseIdsToSync.add(courseId)
        } else {
          unresolvedEmails.push(email)
        }
      } catch (err: any) {
        // A permissions error (account-admin rights missing) applies to
        // every student, not just this one -- stop immediately rather
        // than repeating the same failure 23 more times.
        if (err?.data?.statusCode === 401 || err?.data?.statusCode === 403) {
          throw err
        }
        unresolvedEmails.push(email)
      }
    }

    const courseIds = [...courseIdsToSync]
    const coursesSynced: any[] = []
    syncProgress.value = { stage: 'syncing', current: 0, total: courseIds.length, label: '' }
    for (const courseId of courseIds) {
      syncProgress.value = { stage: 'syncing', current: syncProgress.value!.current + 1, total: courseIds.length, label: `course ${courseId}` }
      const res = await $fetch('/api/admin/canvas/sync', {
        method: 'POST',
        body: { canvasCourseId: courseId },
      })
      coursesSynced.push(res.data)
    }

    lastCanvasSyncSummary.value = { studentsResolved, studentsUnresolved: unresolvedEmails, coursesSynced }

    // Record completion for the "last synced" label. Best-effort: if
    // this write fails for some reason, it shouldn't undo the fact that
    // the sync itself succeeded, so it's not wrapped in the outer catch.
    try {
      await $fetch('/api/admin/canvas-masters/mark-canvas-synced', {
        method: 'POST',
        body: { studentsResolved, studentsUnresolved: unresolvedEmails, coursesSynced: coursesSynced.map((c) => c.courseId) },
      })
    } catch {
      // non-critical, ignore
    }

    showSuccess(
      'Synced from Canvas',
      `${studentsResolved} students resolved, ${coursesSynced.length} course${coursesSynced.length === 1 ? '' : 's'} synced` +
        (unresolvedEmails.length > 0 ? ` (${unresolvedEmails.length} email${unresolvedEmails.length === 1 ? '' : 's'} not found on Canvas)` : '')
    )
    await fetchRoster()
  } catch (err: any) {
    showError('Canvas sync failed', err?.data?.statusMessage || err.message)
  } finally {
    canvasSyncing.value = false
    syncProgress.value = null
  }
}

async function syncAttendanceSheet() {
  attendanceSyncing.value = true
  try {
    const res = await $fetch('/api/admin/canvas-masters/attendance-sync', { method: 'POST', body: {} })
    showSuccess('Attendance synced', `${res.data.studentsSynced} students updated from the sheet`)
    await fetchRoster()
  } catch (err: any) {
    // If no CANVAS_ATTENDANCE_SHEET_URL is configured server-side, offer
    // to paste one in for this sync only, rather than just failing.
    if (err?.data?.statusCode === 400) {
      const url = window.prompt('Paste the Google Sheet URL to sync attendance from:')
      if (url) {
        try {
          const res = await $fetch('/api/admin/canvas-masters/attendance-sync', { method: 'POST', body: { sheetUrl: url } })
          showSuccess('Attendance synced', `${res.data.studentsSynced} students updated from the sheet`)
          await fetchRoster()
        } catch (err2: any) {
          showError('Attendance sync failed', err2?.data?.statusMessage || err2.message)
        }
      }
    } else {
      showError('Attendance sync failed', err?.data?.statusMessage || err.message)
    }
  } finally {
    attendanceSyncing.value = false
  }
}

onMounted(fetchRoster)

function toggleStudent(studentId: string) {
  expandedStudentId.value = expandedStudentId.value === studentId ? null : studentId
  expandedCourseKey.value = null
  expandedOutcomeGroupKey.value = null
  expandedOutcomeKey.value = null
}

function toggleCourse(studentId: string, courseId: number) {
  const key = `${studentId}::${courseId}`
  expandedCourseKey.value = expandedCourseKey.value === key ? null : key
  expandedOutcomeGroupKey.value = null
  expandedOutcomeKey.value = null
}

function toggleOutcomeGroup(studentId: string, courseId: number, groupName: string) {
  const key = `${studentId}::${courseId}::${groupName}`
  expandedOutcomeGroupKey.value = expandedOutcomeGroupKey.value === key ? null : key
  expandedOutcomeKey.value = null
}

function toggleOutcome(studentId: string, courseId: number, outcomeId: number) {
  const key = `${studentId}::${courseId}::${outcomeId}`
  expandedOutcomeKey.value = expandedOutcomeKey.value === key ? null : key
}

// Canvas courses can define dozens of very granular outcomes (a real
// example: 48 for one course). Shown as one flat list they're hard to
// scan, so this groups them by group_name -- the same field the
// Competency Matrix tab on the regular Canvas page already uses for its
// section headers (e.g. "Machine Learning Modeling") -- so a course's
// outcomes read as a handful of named categories you can drill into,
// not 48 undifferentiated rows.
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

function formatMinutes(mins: number) {
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function formatSyncDate(iso: string) {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.round(diffMs / 60000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.round(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' at ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

const filteredStudents = computed(() => {
  if (!search.value.trim()) return students.value
  const q = search.value.trim().toLowerCase()
  return students.value.filter(
    (s) =>
      s.name?.toLowerCase().includes(q) ||
      s.email?.toLowerCase().includes(q) ||
      s.cohortLabel?.toLowerCase().includes(q) ||
      s.program?.toLowerCase().includes(q)
  )
})

const summary = computed(() => {
  const total = students.value.length
  const synced = students.value.filter((s) => s.canvasSynced).length
  const programs = new Set(students.value.map((s) => s.program)).size
  const cohorts = new Set(students.value.map((s) => `${s.program}::${s.cohortLabel}`)).size
  return { total, synced, programs, cohorts }
})
</script>

<template>
  <UDashboardPanel id="canvas-masters">
    <template #header>
      <UDashboardNavbar title="Canvas Masters">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            label="Sync Attendance Sheet"
            icon="i-lucide-calendar-clock"
            color="neutral"
            variant="subtle"
            size="sm"
            :loading="attendanceSyncing"
            @click="syncAttendanceSheet"
          />
          <UButton
            label="Sync From Canvas"
            icon="i-lucide-refresh-cw"
            color="primary"
            size="sm"
            :loading="canvasSyncing"
            :disabled="canvasSyncing"
            @click="syncFromCanvas"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <!-- Last-synced status line. No "clear before syncing" action --
           every sync is an upsert on Canvas's own IDs (or on email for
           attendance), so re-syncing just refreshes existing rows
           rather than duplicating anything. This is here so it's clear
           at a glance how fresh the data on screen is. -->
      <div class="flex items-center gap-4 flex-wrap text-xs text-muted mb-4">
        <span class="flex items-center gap-1.5">
          <UIcon name="i-lucide-graduation-cap" class="size-3.5" />
          Canvas data: {{ syncStatus.canvas ? `last synced ${formatSyncDate(syncStatus.canvas)}` : 'never synced' }}
        </span>
        <span class="flex items-center gap-1.5">
          <UIcon name="i-lucide-calendar-clock" class="size-3.5" />
          Attendance: {{ syncStatus.attendance ? `last synced ${formatSyncDate(syncStatus.attendance)}` : 'never synced' }}
        </span>
      </div>

      <!-- Live progress while "Sync From Canvas" is running, since it's
           orchestrated as many small requests and can take a while for
           a large roster. -->
      <UCard v-if="canvasSyncing && syncProgress" variant="subtle" class="mb-6" :ui="{ body: '!py-3' }">
        <p class="text-xs text-muted">
          <UIcon name="i-lucide-refresh-cw" class="size-3.5 animate-spin inline mr-1" />
          <template v-if="syncProgress.stage === 'resolving'">
            Resolving students on Canvas… ({{ syncProgress.current }}/{{ syncProgress.total }}{{ syncProgress.label ? ` — ${syncProgress.label}` : '' }})
          </template>
          <template v-else>
            Syncing courses… ({{ syncProgress.current }}/{{ syncProgress.total }}{{ syncProgress.label ? ` — ${syncProgress.label}` : '' }})
          </template>
          This runs as several small requests, so it's normal for this to take a while for a large roster.
        </p>
      </UCard>
      <UCard v-else-if="lastCanvasSyncSummary" variant="subtle" class="mb-6" :ui="{ body: '!py-3' }">
        <p class="text-xs text-muted">
          Last sync just now: {{ lastCanvasSyncSummary.studentsResolved }} students resolved,
          {{ lastCanvasSyncSummary.coursesSynced.length }} course{{ lastCanvasSyncSummary.coursesSynced.length === 1 ? '' : 's' }} synced
          <template v-if="lastCanvasSyncSummary.studentsUnresolved.length > 0">
            · {{ lastCanvasSyncSummary.studentsUnresolved.length }} email{{ lastCanvasSyncSummary.studentsUnresolved.length === 1 ? '' : 's' }} not found on Canvas ({{ lastCanvasSyncSummary.studentsUnresolved.join(', ') }})
          </template>
        </p>
      </UCard>

      <!-- Summary stat cards -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <UCard>
          <p class="text-xs text-muted uppercase tracking-wide">Masters Students</p>
          <p class="text-2xl font-semibold">{{ summary.total }}</p>
        </UCard>
        <UCard>
          <p class="text-xs text-muted uppercase tracking-wide">Canvas-Synced</p>
          <p class="text-2xl font-semibold">{{ summary.synced }} / {{ summary.total }}</p>
        </UCard>
        <UCard>
          <p class="text-xs text-muted uppercase tracking-wide">Programs</p>
          <p class="text-2xl font-semibold">{{ summary.programs }}</p>
        </UCard>
        <UCard>
          <p class="text-xs text-muted uppercase tracking-wide">Cohorts</p>
          <p class="text-2xl font-semibold">{{ summary.cohorts }}</p>
        </UCard>
      </div>

      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="Search students, cohorts, or programs..."
        class="mb-4 w-full sm:w-96"
      />

      <div v-if="loading" class="text-sm text-muted py-8 text-center">Loading...</div>
      <div v-else-if="error" class="text-sm text-muted py-8 text-center">
        Couldn't load the roster: {{ error }}
      </div>
      <div v-else-if="filteredStudents.length === 0" class="text-sm text-muted py-8 text-center">
        No masters students match your search.
      </div>

      <div v-else class="rounded-lg border border-default divide-y divide-default">
        <div v-for="s in filteredStudents" :key="s.studentId">
          <!-- Student row -->
          <button
            class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-elevated/40 transition-colors"
            @click="toggleStudent(s.studentId)"
          >
            <div class="size-8 rounded-full bg-elevated flex items-center justify-center shrink-0">
              <UIcon name="i-lucide-user" class="size-4 text-muted" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-highlighted truncate">{{ s.name || s.email }}</p>
              <p class="text-xs text-muted truncate">{{ s.email }}</p>
            </div>
            <UBadge color="neutral" variant="subtle" size="sm">{{ s.program }} · {{ s.cohortLabel }}</UBadge>
            <UBadge v-if="!s.canvasSynced" color="warning" variant="subtle" size="sm">Not synced yet</UBadge>
            <div class="hidden sm:flex items-center gap-1.5 text-xs text-muted w-32 shrink-0">
              <UIcon name="i-lucide-video" class="size-3.5" />
              {{ s.attendance.meetingsAttended }} meetings ({{ s.attendance.percent }}%)
            </div>
            <UIcon
              :name="expandedStudentId === s.studentId ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              class="size-4 text-muted shrink-0"
            />
          </button>

          <!-- Expanded: attendance detail + courses -->
          <div v-if="expandedStudentId === s.studentId" class="bg-elevated/20">
            <!-- Attendance detail -->
            <div class="px-6 py-3 border-b border-default flex items-center gap-4 flex-wrap text-xs text-muted">
              <span class="flex items-center gap-1.5">
                <UIcon name="i-lucide-video" class="size-3.5" />
                {{ s.attendance.meetingsAttended }} / {{ s.attendance.maxMeetingsInCohort }} meetings (top attendee in cohort)
              </span>
              <span class="flex items-center gap-1.5">
                <UIcon name="i-lucide-clock" class="size-3.5" />
                {{ formatMinutes(s.attendance.totalDurationMinutes) }} total
              </span>
              <UBadge color="neutral" variant="subtle" size="sm">{{ s.attendance.percent }}% of top attendee</UBadge>
            </div>

            <div v-if="!s.canvasSynced" class="px-6 py-3 text-xs text-muted">
              Not resolved on Canvas yet — click "Sync From Canvas" above. If it still doesn't
              resolve after that, this email may not match a Canvas account (typo, or the
              student hasn't logged into Canvas yet).
            </div>
            <div v-else-if="s.courses.length === 0" class="px-6 py-3 text-xs text-muted">
              Resolved on Canvas, but not currently enrolled in any course as a student.
            </div>

            <!-- Courses -->
            <div v-for="c in s.courses" :key="c.courseId" class="border-b border-default last:border-b-0">
              <button
                class="w-full flex items-center justify-between gap-3 px-6 py-2.5 text-left hover:bg-elevated/40 transition-colors"
                @click="toggleCourse(s.studentId, c.courseId)"
              >
                <span class="flex items-center gap-2 text-sm text-highlighted">
                  <UIcon name="i-lucide-graduation-cap" class="size-3.5 text-muted" />
                  {{ c.courseName }}
                </span>
                <span class="flex items-center gap-2 shrink-0">
                  <UBadge color="neutral" variant="subtle" size="sm">{{ groupOutcomes(c.outcomes).length }} outcome groups</UBadge>
                  <UIcon
                    :name="expandedCourseKey === `${s.studentId}::${c.courseId}` ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                    class="size-3.5 text-muted"
                  />
                </span>
              </button>

              <!-- Learning outcome groups within this course -->
              <div v-if="expandedCourseKey === `${s.studentId}::${c.courseId}`" class="bg-elevated/20">
                <div v-if="c.outcomes.length === 0" class="px-10 py-2 text-xs text-muted">
                  No learning outcomes synced for this course.
                </div>
                <div v-for="g in groupOutcomes(c.outcomes)" :key="g.groupName" class="border-t border-default">
                  <button
                    class="w-full flex items-center justify-between gap-3 px-10 py-2 text-left hover:bg-elevated/40 transition-colors"
                    @click="toggleOutcomeGroup(s.studentId, c.courseId, g.groupName)"
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
                        :name="expandedOutcomeGroupKey === `${s.studentId}::${c.courseId}::${g.groupName}` ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                        class="size-3.5 text-muted"
                      />
                    </span>
                  </button>

                  <!-- Individual outcomes within this group -->
                  <div v-if="expandedOutcomeGroupKey === `${s.studentId}::${c.courseId}::${g.groupName}`" class="bg-elevated/20">
                    <div v-for="o in g.outcomes" :key="o.outcomeId" class="border-t border-default">
                      <button
                        class="w-full flex items-center justify-between gap-3 px-14 py-2 text-left hover:bg-elevated/40 transition-colors"
                        @click="toggleOutcome(s.studentId, c.courseId, o.outcomeId)"
                      >
                        <span class="text-sm text-highlighted">{{ o.title }}</span>
                        <span class="flex items-center gap-2 shrink-0">
                          <UBadge color="neutral" variant="subtle" size="sm">
                            {{ o.assignments.filter(a => a.submitted).length }}/{{ o.assignments.length }} submitted
                          </UBadge>
                          <UIcon
                            :name="expandedOutcomeKey === `${s.studentId}::${c.courseId}::${o.outcomeId}` ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                            class="size-3.5 text-muted"
                          />
                        </span>
                      </button>

                      <!-- Assignments aligned to this outcome -->
                      <div
                        v-if="expandedOutcomeKey === `${s.studentId}::${c.courseId}::${o.outcomeId}`"
                        class="px-16 pb-2 space-y-1"
                      >
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
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
