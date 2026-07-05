// server/student/duplicate-tracks.get.js
// GET /api/student/duplicate-tracks
// Returns only the logged-in student's own duplicate-track report rows.
import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const { data: student } = await supabase
    .from('students')
    .select('id')
    .eq('email', user.email)
    .maybeSingle()

  if (!student) {
    return { data: [] }
  }

  const { data, error } = await supabase
    .from('student_duplicate_project_report')
    .select('*')
    .eq('student_id', student.id)
    .order('scraped_at', { ascending: false })

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { data: data || [] }
})
