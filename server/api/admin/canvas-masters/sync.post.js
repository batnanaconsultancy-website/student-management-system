import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'
import { writeAuditLog } from '~/server/utils/auditLog'
import { findCanvasUserByEmail, listUserEnrollments } from '~/server/utils/canvasApi'
import { syncCanvasCourse } from '~/server/utils/canvasSync'

// POST /api/admin/canvas-masters/sync
//
// Talks to Canvas directly, account-wide, for the whole masters roster
// in one click -- unlike the regular Canvas page, which only knows
// about courses an admin has manually picked from a dropdown. For every
// email in canvas_student_labels:
//   1. resolve their Canvas user account (findCanvasUserByEmail)
//   2. list every course they're enrolled in as a student, anywhere in
//      the account (listUserEnrollments)
//   3. sync every one of those courses (syncCanvasCourse, shared with
//      the regular Canvas page's per-course "Sync Now")
//
// Requires CANVAS_TOKEN to have account-admin rights on CANVAS_ACCOUNT_ID
// (defaults to "self") -- that's what makes step 1/2 possible without
// already knowing which course to look in. If the token doesn't have
// that level of access, Canvas will 401/403 on the user search and this
// route surfaces that clearly rather than silently finding nothing.
//
// A student whose email doesn't resolve to a Canvas account (typo,
// never logged in, deactivated) is skipped and reported, not treated as
// a hard failure -- one bad email shouldn't block syncing the other 23.
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

  const { data: labels, error: labelsError } = await supabase
    .from('canvas_student_labels')
    .select('email')

  if (labelsError) {
    throw createError({ statusCode: 500, statusMessage: labelsError.message })
  }
  if (!labels || labels.length === 0) {
    return { data: { studentsResolved: 0, studentsUnresolved: [], coursesSynced: [] } }
  }

  const unresolvedEmails = []
  const courseIdsToSync = new Set()
  let studentsResolved = 0

  try {
    for (const { email } of labels) {
      let canvasUser
      try {
        canvasUser = await findCanvasUserByEmail(email)
      } catch (err) {
        // Surface an account-permission problem immediately and clearly,
        // rather than quietly treating every remaining student as
        // "unresolved" one by one (which would look like 24 typos
        // instead of one permissions issue).
        if (err.statusCode === 401 || err.statusCode === 403) {
          throw createError({
            statusCode: err.statusCode,
            statusMessage:
              'Canvas rejected the account-wide user search. Your CANVAS_TOKEN needs ' +
              'account-admin rights on the account set by CANVAS_ACCOUNT_ID (defaults to ' +
              '"self") to resolve students by email.',
          })
        }
        throw err
      }

      if (!canvasUser) {
        unresolvedEmails.push(email)
        continue
      }

      studentsResolved += 1

      const enrollments = await listUserEnrollments(canvasUser.id)
      for (const enrollment of enrollments) {
        if (enrollment.course_id) courseIdsToSync.add(enrollment.course_id)
      }
    }

    const coursesSynced = []
    for (const courseId of courseIdsToSync) {
      const summary = await syncCanvasCourse(supabase, courseId)
      coursesSynced.push(summary)
    }

    await writeAuditLog(supabase, user.email, 'sync_canvas_masters', 'canvas_masters', null,
      {
        students_resolved: studentsResolved,
        students_unresolved: unresolvedEmails,
        courses_synced: coursesSynced.map((c) => ({ id: c.courseId, name: c.courseName })),
      }, event)

    return {
      data: {
        studentsResolved,
        studentsUnresolved: unresolvedEmails,
        coursesSynced,
      },
    }
  } catch (err) {
    if (err.statusCode) throw err
    throw createError({ statusCode: 500, statusMessage: err.message || 'Canvas Masters sync failed' })
  }
})
