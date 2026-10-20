import { createError } from 'h3'
import { serverSupabaseClient } from '#supabase/server'
import { resolveStudentViewContext } from '~/server/utils/studentView'

export default defineEventHandler(async (event) => {
  const authenticatedClient = await serverSupabaseClient(event)
  const context = await resolveStudentViewContext(event, authenticatedClient)
  const client = context.dataClient
  const student = context.student

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
