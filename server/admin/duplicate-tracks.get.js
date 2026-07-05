// server/admin/duplicate-tracks.get.js
// GET /api/admin/duplicate-tracks
// Returns every student_duplicate_project_report row (students
// deliberately tracking an extra season/course, e.g. an extra-fee
// Fullstack/Backend add-on), for the admin-facing report page.
import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const { data: callerRow } = await supabase
    .from('admin')
    .select('email')
    .eq('email', user.email)
    .maybeSingle()

  if (!callerRow) {
    throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
  }

  const { data, error } = await supabase
    .from('student_duplicate_project_report')
    .select('*')
    .order('scraped_at', { ascending: false })

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { data: data || [] }
})
