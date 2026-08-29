import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'
import { findCanvasUserByEmail, listUserEnrollments } from '~/server/utils/canvasApi'

// POST /api/admin/canvas-masters/resolve-student
// Body: { email: string }
//
// Does ONLY the fast part of connecting a masters student to Canvas:
// resolve their account by email, then list every course they're
// enrolled in account-wide. Deliberately does NOT sync those courses'
// data (assignments/submissions/outcomes) -- that's a separate, much
// slower operation (server/api/admin/canvas/sync.post.js) that the
// browser calls per-course afterward.
//
// This split exists because Vercel serverless functions have a hard
// execution time limit. Resolving 24 students and fully syncing every
// course they're enrolled in, all inside one request, reliably exceeds
// that limit and the function gets killed mid-way with a bare 502 --
// not a clean error from our own code, just Vercel terminating the
// invocation. Doing "resolve one student" as its own fast request (a
// couple of Canvas API calls, no course data pulled) keeps every single
// request comfortably under any reasonable timeout, and the whole
// multi-student, multi-course sync is orchestrated client-side instead,
// one small request at a time, with visible progress.
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
  const email = (body?.email || '').trim()
  if (!email) {
    throw createError({ statusCode: 400, statusMessage: 'email is required' })
  }

  try {
    const canvasUser = await findCanvasUserByEmail(email)

    if (!canvasUser) {
      return { data: { email, found: false, courseIds: [] } }
    }

    const enrollments = await listUserEnrollments(canvasUser.id)
    const courseIds = [...new Set(enrollments.map((e) => e.course_id).filter(Boolean))]

    return {
      data: {
        email,
        found: true,
        canvasUserId: canvasUser.id,
        name: canvasUser.name || canvasUser.short_name || null,
        courseIds,
      },
    }
  } catch (err) {
    if (err.statusCode === 401 || err.statusCode === 403) {
      throw createError({
        statusCode: err.statusCode,
        statusMessage:
          'Canvas rejected the account-wide user search. Your CANVAS_TOKEN needs ' +
          'account-admin rights on the account set by CANVAS_ACCOUNT_ID (defaults to ' +
          '"self") to resolve students by email.',
      })
    }
    if (err.statusCode) throw err
    throw createError({ statusCode: 500, statusMessage: err.message || 'Failed to resolve student' })
  }
})
