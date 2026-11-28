import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseServiceRole, serverSupabaseUser } from '#supabase/server'
import { writeAuditLog } from '~/server/utils/auditLog'
import { syncCanvasCourse } from '~/server/utils/canvasSync'

// POST /api/admin/canvas/sync
// Body: { canvasCourseId: number }
//
// Pulls everything for ONE Canvas course and upserts it into your DB.
// Caller must be an admin. This is what the "Sync Now" button on
// pages/admin/canvas.vue calls. The actual pull-and-upsert logic lives
// in server/utils/canvasSync.js, shared with Canvas Masters' account-wide
// sync (server/api/admin/canvas-masters/sync.post.js) so both stay in
// sync (pun intended) rather than drifting apart.
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

  const serviceRole = await serverSupabaseServiceRole(event)
  const body = await readBody(event)
  const canvasCourseId = Number(body?.canvasCourseId)
  if (!canvasCourseId || Number.isNaN(canvasCourseId)) {
    throw createError({ statusCode: 400, statusMessage: 'canvasCourseId is required' })
  }

  const { data: job, error: jobError } = await serviceRole
    .from('canvas_sync_jobs')
    .insert({
      canvas_course_id: canvasCourseId,
      job_type: 'course_sync',
      status: 'processing',
      requested_by: user.email,
      attempts: 1,
      locked_at: new Date().toISOString(),
      locked_by: 'admin-request',
    })
    .select('id')
    .single()
  if (jobError) throw createError({ statusCode: 500, statusMessage: jobError.message })

  try {
    const summary = await syncCanvasCourse(serviceRole, canvasCourseId)

    await serviceRole.from('canvas_sync_jobs').update({
      status: 'completed',
      result: summary,
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    }).eq('id', job.id)

    await writeAuditLog(supabase, user.email, 'sync_canvas_course', 'canvas_course', canvasCourseId,
      {
        course_name: summary.courseName,
        students: summary.studentsSynced,
        assignments: summary.assignmentsSynced,
        submissions: summary.submissionsSynced,
        outcomes: summary.outcomesSynced,
        outcome_results: summary.outcomeResultsSynced,
        outcome_alignments: summary.outcomeAlignmentsSynced,
      }, event)

    return { data: summary }
  } catch (err) {
    await serviceRole.from('canvas_sync_jobs').update({
      status: 'failed',
      last_error: String(err.message || 'Canvas sync failed').slice(0, 4000),
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    }).eq('id', job.id)

    if (err.statusCode) throw err
    throw createError({ statusCode: 500, statusMessage: err.message || 'Canvas sync failed' })
  }
})
