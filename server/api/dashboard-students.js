import { serverSupabaseClient } from '#supabase/server'

export default defineEventHandler(async (event) => {
  try {
    const client = await serverSupabaseClient(event)

    const { data: students, error } = await client.from('students').select(`
      id,
      first_name,
      last_name,
      email,
      status,
      account_status,
      student_class,
      username,
      cohorts(name),
      programs(name),
      points_assigned,
      profile_image_url
    `)

    if (error) {
      console.error('Error fetching students:', error)
      throw createError({ statusCode: 500, statusMessage: error.message })
    }

    return { data: students || [] }
  } catch (err) {
    console.error('Dashboard students handler error:', err)
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err?.message || 'Internal server error'
    })
  }
})
