import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'
import { writeAuditLog } from '~/server/utils/auditLog'
import { findCanvasUserByEmail, listUserEnrollments } from '~/server/utils/canvasApi'
import { syncCanvasCourse } from '~/server/utils/canvasSync'

// Account-wide sync makes MANY sequential Canvas API calls (per-student
// email lookup + enrollment listing, then per-course assignments/
// submissions/outcomes/alignments) and can easily run past Vercel's
// default serverless timeout. This raises the ceiling as far as the
// platform allows -- Hobby plans cap at 60s regardless of this value,
// Pro caps at 300s, so if syncs still time out on a large roster, that's
// a plan-tier limit, not something this file can fix alone (see the
// "still timing out?" note in the README).
export const config = {
  maxDuration: 300,
}

// Runs an array of async jobs with at most `limit` running concurrently
// -- plain Promise.all would fire all 24 student lookups (then all
// discovered courses) at once, which risks tripping Canvas's own rate
// limiting. A small worker-pool keeps this fast without doing that.
async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function runNext() {
    const i = nextIndex++
    if (i >= items.length) return
    results[i] = await worker(items[i], i)
    await runNext()
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext))
  return results
}

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
  let permissionError = null

  try {
    // Step 1: resolve every roster email + list their enrollments. These
    // are all independent lookups, so run several in parallel rather
    // than one at a time -- this alone cuts wall-clock time roughly by
    // the concurrency factor.
    await runWithConcurrency(labels, 5, async ({ email }) => {
      if (permissionError) return // a prior lookup already found the real problem; stop wasting calls

      let canvasUser
      try {
        canvasUser = await findCanvasUserByEmail(email)
      } catch (err) {
        // Surface an account-permission problem clearly instead of
        // quietly treating every remaining student as "unresolved" one
        // by one (which would look like 24 typos instead of one
        // permissions issue).
        if (err.statusCode === 401 || err.statusCode === 403) {
          permissionError = createError({
            statusCode: err.statusCode,
            statusMessage:
              'Canvas rejected the account-wide user search. Your CANVAS_TOKEN needs ' +
              'account-admin rights on the account set by CANVAS_ACCOUNT_ID (defaults to ' +
              '"self") to resolve students by email.',
          })
          return
        }
        throw err
      }

      if (!canvasUser) {
        unresolvedEmails.push(email)
        return
      }

      studentsResolved += 1

      const enrollments = await listUserEnrollments(canvasUser.id)
      for (const enrollment of enrollments) {
        if (enrollment.course_id) courseIdsToSync.add(enrollment.course_id)
      }
    })

    if (permissionError) throw permissionError

    // Step 2: sync every discovered course. Skip any course that was
    // already synced in the last 10 minutes -- this makes a *retry*
    // after a timeout much faster (already-synced courses aren't
    // re-pulled), without meaningfully staling anything for normal use.
    const courseIds = [...courseIdsToSync]
    const RECENT_SYNC_WINDOW_MS = 10 * 60 * 1000

    const { data: recentlySynced } = courseIds.length
      ? await supabase
          .from('canvas_courses')
          .select('canvas_course_id, name, synced_at')
          .in('canvas_course_id', courseIds)
      : { data: [] }

    const recentByCourseId = new Map((recentlySynced || []).map((c) => [c.canvas_course_id, c]))
    const now = Date.now()

    const coursesToActuallySync = courseIds.filter((id) => {
      const cached = recentByCourseId.get(id)
      if (!cached) return true
      return now - new Date(cached.synced_at).getTime() > RECENT_SYNC_WINDOW_MS
    })
    const coursesSkipped = courseIds
      .filter((id) => !coursesToActuallySync.includes(id))
      .map((id) => ({ courseId: id, courseName: recentByCourseId.get(id)?.name }))

    // Course syncs are heavier (each does its own internal sequence of
    // Canvas calls), so a smaller concurrency limit here than for the
    // lightweight per-student lookups above.
    const coursesSynced = await runWithConcurrency(coursesToActuallySync, 3, (courseId) =>
      syncCanvasCourse(supabase, courseId)
    )

    await writeAuditLog(supabase, user.email, 'sync_canvas_masters', 'canvas_masters', null,
      {
        students_resolved: studentsResolved,
        students_unresolved: unresolvedEmails,
        courses_synced: coursesSynced.map((c) => ({ id: c.courseId, name: c.courseName })),
        courses_skipped_recent: coursesSkipped,
      }, event)

    return {
      data: {
        studentsResolved,
        studentsUnresolved: unresolvedEmails,
        coursesSynced,
        coursesSkipped,
      },
    }
  } catch (err) {
    if (err.statusCode) throw err
    throw createError({ statusCode: 500, statusMessage: err.message || 'Canvas Masters sync failed' })
  }
})
