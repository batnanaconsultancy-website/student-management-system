// server/student/duplicate-tracks.get.js
// GET /api/student/duplicate-tracks
// Returns only the logged-in student's own duplicate-track report rows.
import { createError } from 'h3'
import { serverSupabaseClient } from '#supabase/server'
import { resolveStudentViewContext } from '~/server/utils/studentView'

export default defineEventHandler(async (event) => {
  const authenticatedClient = await serverSupabaseClient(event)
  const context = await resolveStudentViewContext(event, authenticatedClient)
  const supabase = context.dataClient
  const student = context.student

  const { data, error } = await supabase
    .from('student_duplicate_project_report')
    .select('*')
    .eq('student_id', student.id)
    .order('scraped_at', { ascending: false })

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { data: data || [] }
})
