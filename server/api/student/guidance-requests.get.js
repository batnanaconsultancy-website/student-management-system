import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

export default defineEventHandler(async (event) => {
  const client = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const { data: student, error: studentError } = await client
    .from('students')
    .select('id')
    .eq('email', user.email)
    .maybeSingle()

  if (studentError) {
    throw createError({ statusCode: 500, statusMessage: studentError.message })
  }
  if (!student) {
    return { data: [] }
  }

  const { data, error } = await client
    .from('guidance_requests')
    .select('id, categories, message, status, created_at')
    .eq('student_id', student.id)
    .order('created_at', { ascending: false })

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  return { data: data || [] }
})
