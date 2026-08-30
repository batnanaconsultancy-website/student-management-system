import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

// POST /api/admin/canvas-masters/mark-canvas-synced
// Body: { studentsResolved, studentsUnresolved, coursesSynced }
//
// Records "when did the last full Canvas Masters sync finish" for the
// "last synced" label on the page. This is separate from the actual
// sync work (resolve-student.post.js + the regular per-course
// sync.post.js) because that work is orchestrated as many small
// requests from the browser -- there's no single server-side moment
// that "is" the sync finishing, so the browser tells us when its whole
// loop has completed.
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

  const { error: upsertError } = await supabase
    .from('canvas_masters_sync_status')
    .upsert(
      {
        sync_key: 'canvas',
        last_synced_at: new Date().toISOString(),
        summary: {
          students_resolved: body?.studentsResolved ?? null,
          students_unresolved: body?.studentsUnresolved ?? [],
          courses_synced: body?.coursesSynced ?? [],
        },
      },
      { onConflict: 'sync_key' }
    )

  if (upsertError) {
    throw createError({ statusCode: 500, statusMessage: upsertError.message })
  }

  return { data: { ok: true } }
})
