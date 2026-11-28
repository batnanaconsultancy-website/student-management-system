import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseServiceRole } from '#supabase/server'
import { requireFinalProjectAdmin } from '~/server/utils/finalProjectAuth'
import { listCanvasCourses } from '~/server/utils/canvasApi'

// GET /api/admin/canvas/courses
// Returns every course visible to the configured account token. Discovery
// does not classify a course as Bachelor or Masters.
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  await requireFinalProjectAdmin(event, supabase)

  try {
    const courses = await listCanvasCourses()
    const serviceRole = await serverSupabaseServiceRole(event)
    const syncedAt = new Date().toISOString()
    const rows = courses.map((course) => ({
      canvas_course_id: course.id,
      name: course.name,
      course_code: course.course_code,
      account_id: course.account_id,
      workflow_state: course.workflow_state,
      enrollment_term_id: course.enrollment_term_id,
      start_at: course.start_at,
      end_at: course.end_at,
      course_metadata: course.metadata || {},
      synced_at: syncedAt,
    }))

    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await serviceRole
        .from('canvas_courses')
        .upsert(rows.slice(i, i + 100), { onConflict: 'canvas_course_id' })
      if (error) throw error
    }

    return {
      data: courses.map(({ metadata, ...course }) => course),
      discovered: courses.length,
      source: 'configured_canvas_account',
    }
  } catch (err) {
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err.message || 'Failed to discover Canvas courses',
    })
  }
})
