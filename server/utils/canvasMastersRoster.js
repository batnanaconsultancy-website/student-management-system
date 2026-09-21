// server/utils/canvasMastersRoster.js
//
import { createError } from 'h3'
import { serverSupabaseUser } from '#supabase/server'
//
// Shared data-building logic for the Canvas Masters roster. Originally
// lived inline in server/api/admin/canvas-masters/roster.get.js; pulled
// out here so the per-student dashboard endpoint
// (server/api/admin/canvas-masters/student/[email].get.js) can build
// the exact same shape for a single student without duplicating every
// query, and so the two can never silently drift apart.
//
// buildCanvasMastersRoster(supabase) returns:
//   {
//     students: [ { studentId, name, email, program, cohortLabel,
//                   canvasSynced, attendance: {...}, courses: [...] }, ... ],
//     syncStatus: { canvas: isoString|null, attendance: isoString|null }
//   }
//
// Reads only from already-synced tables (no live Canvas calls).
// Callers are responsible for their own admin-auth check before calling
// this -- it does no authorization itself.
export async function buildCanvasMastersRoster(supabase) {
  // The fixed roster -- every student we're supposed to show, whether
  // or not they've been Canvas-synced yet.
  const { data: labels, error: labelsError } = await supabase
    .from('canvas_student_labels')
    .select('email, program, cohort_label')

  if (labelsError) {
    throw createError({ statusCode: 500, statusMessage: labelsError.message })
  }
  if (!labels || labels.length === 0) {
    return { students: [], syncStatus: { canvas: null, attendance: null } }
  }

  const rosterEmails = labels.map((l) => l.email.toLowerCase())
  const labelByEmail = new Map(labels.map((l) => [l.email.toLowerCase(), l]))

  // Which of these roster emails have actually shown up in a synced
  // Canvas course (i.e. exist in canvas_students).
  const { data: canvasStudents, error: canvasStudentsError } = await supabase
    .from('canvas_students')
    .select('id, canvas_user_id, name, email')
    .not('email', 'is', null)

  if (canvasStudentsError) {
    throw createError({ statusCode: 500, statusMessage: canvasStudentsError.message })
  }

  const canvasStudentByEmail = new Map(
    (canvasStudents || [])
      .filter((s) => rosterEmails.includes((s.email || '').toLowerCase()))
      .map((s) => [(s.email || '').toLowerCase(), s])
  )

  const syncedStudentIds = [...canvasStudentByEmail.values()].map((s) => s.id)

  // Every (course, student) enrollment for the roster members who HAVE
  // been synced -- the backbone of "which courses is this student
  // enrolled in on Canvas".
  const { data: enrollments, error: enrollmentsError } =
    syncedStudentIds.length > 0
      ? await supabase
          .from('canvas_enrollments')
          .select('canvas_course_id, canvas_student_id')
          .in('canvas_student_id', syncedStudentIds)
      : { data: [], error: null }

  if (enrollmentsError) {
    throw createError({ statusCode: 500, statusMessage: enrollmentsError.message })
  }

  const courseIds = [...new Set((enrollments || []).map((e) => e.canvas_course_id))]

  const [
    { data: courses, error: coursesError },
    { data: outcomes, error: outcomesError },
    { data: alignments, error: alignmentsError },
    { data: assignments, error: assignmentsError },
    { data: submissions, error: submissionsError },
    { data: sheetAttendance, error: attendanceError },
    { data: syncStatusRows, error: syncStatusError },
  ] = await Promise.all([
    courseIds.length > 0
      ? supabase.from('canvas_courses').select('canvas_course_id, name').in('canvas_course_id', courseIds)
      : Promise.resolve({ data: [], error: null }),
    courseIds.length > 0
      ? supabase.from('canvas_outcomes').select('canvas_course_id, canvas_outcome_id, title, group_name').in('canvas_course_id', courseIds)
      : Promise.resolve({ data: [], error: null }),
    courseIds.length > 0
      ? supabase.from('canvas_outcome_alignments').select('canvas_course_id, canvas_outcome_id, canvas_assignment_id').in('canvas_course_id', courseIds)
      : Promise.resolve({ data: [], error: null }),
    courseIds.length > 0
      ? supabase.from('canvas_assignments').select('canvas_course_id, canvas_assignment_id, name').in('canvas_course_id', courseIds)
      : Promise.resolve({ data: [], error: null }),
    syncedStudentIds.length > 0
      ? supabase.from('canvas_submissions').select('canvas_course_id, canvas_assignment_id, canvas_student_id, workflow_state, submitted_at, late').in('canvas_student_id', syncedStudentIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('canvas_sheet_attendance').select('email, meetings_attended, total_duration_minutes').in('email', rosterEmails),
    supabase.from('canvas_masters_sync_status').select('sync_key, last_synced_at'),
  ])

  for (const [name, err] of [
    ['courses', coursesError], ['outcomes', outcomesError], ['alignments', alignmentsError],
    ['assignments', assignmentsError], ['submissions', submissionsError], ['attendance', attendanceError],
    ['syncStatus', syncStatusError],
  ]) {
    if (err) throw createError({ statusCode: 500, statusMessage: `${name}: ${err.message}` })
  }

  const syncStatus = {
    canvas: syncStatusRows?.find((r) => r.sync_key === 'canvas')?.last_synced_at || null,
    attendance: syncStatusRows?.find((r) => r.sync_key === 'attendance')?.last_synced_at || null,
  }

  const attendanceByEmail = new Map((sheetAttendance || []).map((a) => [a.email.toLowerCase(), a]))
  const courseNameById = new Map((courses || []).map((c) => [c.canvas_course_id, c.name]))

  // Attendance percentage is relative to the top attendee within the
  // same program/cohort group (computed across the FULL roster, so a
  // student with zero meetings still correctly shows 0% rather than
  // being excluded from the comparison).
  const meetingsByGroup = new Map()
  for (const email of rosterEmails) {
    const label = labelByEmail.get(email)
    const groupKey = `${label.program}::${label.cohort_label}`
    const attendance = attendanceByEmail.get(email)
    const meetings = attendance?.meetings_attended || 0
    if (!meetingsByGroup.has(groupKey)) meetingsByGroup.set(groupKey, [])
    meetingsByGroup.get(groupKey).push(meetings)
  }
  const maxMeetingsByGroup = new Map(
    [...meetingsByGroup.entries()].map(([key, values]) => [key, Math.max(0, ...values)])
  )

  const assignmentsByCourseAndId = new Map()
  for (const a of assignments || []) {
    assignmentsByCourseAndId.set(`${a.canvas_course_id}::${a.canvas_assignment_id}`, a)
  }

  const alignmentsByCourseAndOutcome = new Map()
  for (const a of alignments || []) {
    const key = `${a.canvas_course_id}::${a.canvas_outcome_id}`
    if (!alignmentsByCourseAndOutcome.has(key)) alignmentsByCourseAndOutcome.set(key, [])
    alignmentsByCourseAndOutcome.get(key).push(a.canvas_assignment_id)
  }

  const submissionByKey = new Map(
    (submissions || []).map((s) => [
      `${s.canvas_course_id}::${s.canvas_assignment_id}::${s.canvas_student_id}`,
      s,
    ])
  )

  const outcomesByCourse = new Map()
  for (const o of outcomes || []) {
    if (!outcomesByCourse.has(o.canvas_course_id)) outcomesByCourse.set(o.canvas_course_id, [])
    outcomesByCourse.get(o.canvas_course_id).push(o)
  }

  const courseIdsByStudent = new Map()
  for (const e of enrollments || []) {
    if (!courseIdsByStudent.has(e.canvas_student_id)) courseIdsByStudent.set(e.canvas_student_id, [])
    courseIdsByStudent.get(e.canvas_student_id).push(e.canvas_course_id)
  }

  const buildCourseList = (canvasStudentId) => {
    const studentCourseIds = [...new Set(courseIdsByStudent.get(canvasStudentId) || [])]
    return studentCourseIds.map((courseId) => {
      const courseOutcomes = outcomesByCourse.get(courseId) || []
      const outcomeList = courseOutcomes.map((outcome) => {
        const alignedAssignmentIds = alignmentsByCourseAndOutcome.get(`${courseId}::${outcome.canvas_outcome_id}`) || []
        const assignmentList = alignedAssignmentIds.map((assignmentId) => {
          const assignment = assignmentsByCourseAndId.get(`${courseId}::${assignmentId}`)
          const submission = submissionByKey.get(`${courseId}::${assignmentId}::${canvasStudentId}`)
          return {
            assignmentId,
            name: assignment?.name || `Assignment ${assignmentId}`,
            submitted: Boolean(submission && submission.workflow_state !== 'unsubmitted'),
            workflowState: submission?.workflow_state || 'unsubmitted',
            submittedAt: submission?.submitted_at || null,
            late: submission?.late || false,
          }
        })
        return {
          outcomeId: outcome.canvas_outcome_id,
          title: outcome.title,
          groupName: outcome.group_name,
          assignments: assignmentList,
        }
      })
      return {
        courseId,
        courseName: courseNameById.get(courseId) || `Course ${courseId}`,
        outcomes: outcomeList,
      }
    })
  }

  // One row per roster email -- synced students get their real Canvas
  // data, unsynced ones get an empty-but-present row so the full
  // roster is always visible.
  const students = labels.map((label) => {
    const email = label.email.toLowerCase()
    const canvasStudent = canvasStudentByEmail.get(email)
    const attendance = attendanceByEmail.get(email)
    const meetingsAttended = attendance?.meetings_attended || 0
    const groupKey = `${label.program}::${label.cohort_label}`
    const maxMeetings = maxMeetingsByGroup.get(groupKey) || 0

    return {
      studentId: canvasStudent?.id || `unsynced:${email}`,
      name: canvasStudent?.name || null,
      email: label.email,
      program: label.program,
      cohortLabel: label.cohort_label,
      canvasSynced: Boolean(canvasStudent),
      attendance: {
        meetingsAttended,
        totalDurationMinutes: attendance?.total_duration_minutes || 0,
        maxMeetingsInCohort: maxMeetings,
        percent: maxMeetings > 0 ? Math.round((meetingsAttended / maxMeetings) * 100) : 0,
      },
      courses: canvasStudent ? buildCourseList(canvasStudent.id) : [],
    }
  })

  // Grouped: Program, then Cohort, then name -- matches how the roster
  // was given to us.
  students.sort((a, b) => {
    const aKey = `${a.program}::${a.cohortLabel}::${a.name || a.email}`
    const bKey = `${b.program}::${b.cohortLabel}::${b.name || b.email}`
    return aKey.localeCompare(bKey)
  })

  return { students, syncStatus }
}

// Shared admin-auth check used by both the roster and student-detail
// endpoints, so "must be an admin" is enforced identically in one
// place.
export async function requireCanvasMastersAdmin(event, supabase) {
  const user = await serverSupabaseUser(event)
  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const { data: callerRow, error: callerError } = await supabase
    .from('admin')
    .select('email')
    .eq('email', user.email)
    .maybeSingle()

  if (callerError) {
    throw createError({ statusCode: 500, statusMessage: callerError.message })
  }
  if (!callerRow) {
    throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
  }

  return user
}
