import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'
import { listCanvasCourses } from '~/server/utils/canvasApi'

// GET /api/admin/canvas/courses
// Returns the courses the configured Canvas token has teacher/TA access to,
// for the course dropdown on pages/admin/canvas.vue. Caller must be an admin.
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

  try {
    const courses = await listCanvasCourses()
    return { data: courses }
  } catch (err) {
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err.message || 'Failed to fetch Canvas courses',
    })
  }
})
