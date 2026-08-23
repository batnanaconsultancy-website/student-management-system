import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'
import { writeAuditLog } from '~/server/utils/auditLog'
import {
  getCanvasCourse,
  listCanvasStudents,
  listCanvasAssignments,
  listAssignmentSubmissions,
} from '~/server/utils/canvasApi'

// POST /api/admin/canvas/sync
// Body: { canvasCourseId: number }
//
// Pulls the student roster, assignments, and submissions for one Canvas
// course from the Canvas REST API and upserts them into canvas_students /
// canvas_enrollments / canvas_assignments / canvas_submissions. Caller
// must be an admin. This is what the "Sync Now" button on
// pages/admin/canvas.vue calls.
//
// Order matters: students are upserted first so we have their internal
// UUIDs (canvas_students.id) on hand before writing submissions, since
// canvas_submissions.canvas_student_id is a foreign key to that table
// rather than storing name/email inline on every submission row.
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

  const body = await readBody(event)
  const canvasCourseId = Number(body?.canvasCourseId)
  if (!canvasCourseId || Number.isNaN(canvasCourseId)) {
    throw createError({ statusCode: 400, statusMessage: 'canvasCourseId is required' })
  }

  try {
    // 1. Confirm the course exists / token has access.
    const course = await getCanvasCourse(canvasCourseId)

    // 2. Roster -> canvas_students + canvas_enrollments.
    // studentIdByCanvasUserId maps Canvas's numeric user id -> our UUID,
    // rebuilt from the upsert's returned rows so it covers students who
    // were already in the table from a previous sync too.
    const rosterUsers = await listCanvasStudents(canvasCourseId)
    const studentIdByCanvasUserId = new Map()

    if (rosterUsers.length > 0) {
      const studentRows = rosterUsers.map((u) => ({
        canvas_user_id: u.id,
        name: u.name || u.short_name || null,
        email: u.email || u.login_id || null,
        synced_at: new Date().toISOString(),
      }))

      const { data: upsertedStudents, error: studentsError } = await supabase
        .from('canvas_students')
        .upsert(studentRows, { onConflict: 'canvas_user_id' })
        .select('id, canvas_user_id')

      if (studentsError) {
        throw createError({ statusCode: 500, statusMessage: studentsError.message })
      }

      for (const row of upsertedStudents) {
        studentIdByCanvasUserId.set(row.canvas_user_id, row.id)
      }

      const enrollmentRows = upsertedStudents.map((row) => ({
        canvas_course_id: canvasCourseId,
        canvas_student_id: row.id,
        synced_at: new Date().toISOString(),
      }))

      const { error: enrollmentsError } = await supabase
        .from('canvas_enrollments')
        .upsert(enrollmentRows, { onConflict: 'canvas_course_id,canvas_student_id' })

      if (enrollmentsError) {
        throw createError({ statusCode: 500, statusMessage: enrollmentsError.message })
      }
    }

    // 3. Assignments.
    const assignments = await listCanvasAssignments(canvasCourseId)
    const assignmentRows = assignments.map((a) => ({
      canvas_course_id: canvasCourseId,
      canvas_assignment_id: a.id,
      name: a.name || `Assignment ${a.id}`,
      due_at: a.due_at || null,
      points_possible: a.points_possible ?? null,
      synced_at: new Date().toISOString(),
    }))

    if (assignmentRows.length > 0) {
      const { error: assignmentsError } = await supabase
        .from('canvas_assignments')
        .upsert(assignmentRows, { onConflict: 'canvas_course_id,canvas_assignment_id' })
      if (assignmentsError) {
        throw createError({ statusCode: 500, statusMessage: assignmentsError.message })
      }
    }

    // 4. Submissions, one Canvas request per assignment (Canvas has no
    // single "all submissions for a course" endpoint). Any submission
    // from a user not already in studentIdByCanvasUserId (e.g. the
    // Canvas "Test Student", or someone who's dropped the roster since)
    // is upserted into canvas_students on the fly so no submission is lost.
    let submissionCount = 0
    for (const assignment of assignments) {
      const submissions = await listAssignmentSubmissions(canvasCourseId, assignment.id)
      const usableSubmissions = submissions.filter((s) => s.user_id || s.user?.id)

      const missingUsers = usableSubmissions
        .map((s) => s.user)
        .filter((u) => u?.id && !studentIdByCanvasUserId.has(u.id))

      if (missingUsers.length > 0) {
        const dedupedRows = [...new Map(missingUsers.map((u) => [u.id, u])).values()].map((u) => ({
          canvas_user_id: u.id,
          name: u.name || u.short_name || null,
          email: u.email || u.login_id || null,
          synced_at: new Date().toISOString(),
        }))

        const { data: extraStudents, error: extraStudentsError } = await supabase
          .from('canvas_students')
          .upsert(dedupedRows, { onConflict: 'canvas_user_id' })
          .select('id, canvas_user_id')

        if (extraStudentsError) {
          throw createError({ statusCode: 500, statusMessage: extraStudentsError.message })
        }
        for (const row of extraStudents) {
          studentIdByCanvasUserId.set(row.canvas_user_id, row.id)
        }
      }

      const submissionRows = usableSubmissions
        .map((s) => {
          const canvasUserId = s.user?.id ?? s.user_id
          const canvasStudentId = studentIdByCanvasUserId.get(canvasUserId)
          if (!canvasStudentId) return null // shouldn't happen after the backfill above
          return {
            canvas_course_id: canvasCourseId,
            canvas_assignment_id: assignment.id,
            canvas_student_id: canvasStudentId,
            submission_type: s.submission_type || null,
            submitted_at: s.submitted_at || null,
            late: Boolean(s.late),
            seconds_late: s.seconds_late || 0,
            missing: Boolean(s.missing),
            workflow_state: s.workflow_state || null,
            attempt: s.attempt ?? null,
            score: s.score ?? null,
            grade: s.grade != null ? String(s.grade) : null,
            graded_at: s.graded_at || null,
            excused: Boolean(s.excused),
            preview_url: s.preview_url || null,
            synced_at: new Date().toISOString(),
          }
        })
        .filter(Boolean)

      if (submissionRows.length > 0) {
        const { error: submissionsError } = await supabase
          .from('canvas_submissions')
          .upsert(submissionRows, {
            onConflict: 'canvas_course_id,canvas_assignment_id,canvas_student_id',
          })
        if (submissionsError) {
          throw createError({ statusCode: 500, statusMessage: submissionsError.message })
        }
        submissionCount += submissionRows.length
      }
    }

    await writeAuditLog(supabase, user.email, 'sync_canvas_course', 'canvas_course', canvasCourseId,
      {
        course_name: course.name,
        students: rosterUsers.length,
        assignments: assignmentRows.length,
        submissions: submissionCount,
      }, event)

    return {
      data: {
        courseId: canvasCourseId,
        courseName: course.name,
        studentsSynced: rosterUsers.length,
        assignmentsSynced: assignmentRows.length,
        submissionsSynced: submissionCount,
      },
    }
  } catch (err) {
    if (err.statusCode) throw err
    throw createError({ statusCode: 500, statusMessage: err.message || 'Canvas sync failed' })
  }
})
