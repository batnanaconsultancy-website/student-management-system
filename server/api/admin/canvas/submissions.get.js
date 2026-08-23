import { createError, getQuery } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

// GET /api/admin/canvas/submissions?courseId=328
//
// Returns the synced roster + submissions for one course, joined and
// flattened into one row per (student, assignment) pair -- including
// students who haven't submitted anything yet for a given assignment,
// so the dashboard table matches what you'd see in Canvas's own
// gradebook (a full grid, not just the rows that happen to have a
// submission). Reads only from the already-synced canvas_* tables --
// no live Canvas API calls happen here, only on "Sync Now". Caller
// must be an admin.
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
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

  const query = getQuery(event)
  const canvasCourseId = Number(query.courseId)
  if (!canvasCourseId || Number.isNaN(canvasCourseId)) {
    throw createError({ statusCode: 400, statusMessage: 'courseId query param is required' })
  }

  // Enrolled students for this course.
  const { data: enrollments, error: enrollmentsError } = await supabase
    .from('canvas_enrollments')
    .select('canvas_student_id, canvas_students(id, canvas_user_id, name, email)')
    .eq('canvas_course_id', canvasCourseId)

  if (enrollmentsError) {
    throw createError({ statusCode: 500, statusMessage: enrollmentsError.message })
  }

  const students = (enrollments || [])
    .map((e) => e.canvas_students)
    .filter(Boolean)

  // Assignments for this course.
  const { data: assignments, error: assignmentsError } = await supabase
    .from('canvas_assignments')
    .select('canvas_assignment_id, name, due_at, points_possible')
    .eq('canvas_course_id', canvasCourseId)
    .order('due_at', { ascending: true, nullsFirst: false })

  if (assignmentsError) {
    throw createError({ statusCode: 500, statusMessage: assignmentsError.message })
  }

  // Every existing submission for this course.
  const { data: submissions, error: submissionsError } = await supabase
    .from('canvas_submissions')
    .select('*')
    .eq('canvas_course_id', canvasCourseId)

  if (submissionsError) {
    throw createError({ statusCode: 500, statusMessage: submissionsError.message })
  }

  const submissionKey = (assignmentId, studentId) => `${assignmentId}::${studentId}`
  const submissionByKey = new Map(
    (submissions || []).map((s) => [submissionKey(s.canvas_assignment_id, s.canvas_student_id), s])
  )

  // Build one row per (student, assignment) pair. A student with no
  // canvas_submissions row for a given assignment shows as "unsubmitted"
  // rather than being silently omitted -- this mirrors Canvas's own
  // gradebook grid.
  const rows = []
  for (const student of students) {
    for (const assignment of assignments || []) {
      const key = submissionKey(assignment.canvas_assignment_id, student.id)
      const submission = submissionByKey.get(key)
      rows.push({
        student_id: student.id,
        student_name: student.name,
        student_email: student.email,
        assignment_id: assignment.canvas_assignment_id,
        assignment_name: assignment.name,
        due_at: assignment.due_at,
        points_possible: assignment.points_possible,
        submission_type: submission?.submission_type || null,
        submitted_at: submission?.submitted_at || null,
        late: submission?.late || false,
        seconds_late: submission?.seconds_late || 0,
        missing: submission?.missing ?? !submission,
        workflow_state: submission?.workflow_state || 'unsubmitted',
        attempt: submission?.attempt || null,
        score: submission?.score ?? null,
        grade: submission?.grade || null,
        graded_at: submission?.graded_at || null,
        excused: submission?.excused || false,
        preview_url: submission?.preview_url || null,
      })
    }
  }

  const totalPossible = rows.length
  const submittedCount = rows.filter((r) => r.workflow_state !== 'unsubmitted').length

  return {
    data: {
      rows,
      students,
      assignments,
      summary: {
        studentCount: students.length,
        assignmentCount: (assignments || []).length,
        submissionRate: totalPossible > 0 ? Math.round((submittedCount / totalPossible) * 100) : 0,
      },
    },
  }
})
