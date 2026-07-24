import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

export default defineEventHandler(async (event) => {
  const client = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const { data: adminRow, error: adminError } = await client
    .from('admin')
    .select('email')
    .eq('email', user.email)
    .maybeSingle()

  if (adminError) {
    throw createError({ statusCode: 500, statusMessage: adminError.message })
  }
  if (!adminRow) {
    throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
  }

  const { data: students, error } = await client
    .from('students')
    .select(`
      id,
      first_name,
      last_name,
      email,
      username,
      workshops_attended,
      standup_attended,
      mentoring_attended,
      cohorts(name),
      programs(name)
    `)

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  const data = (students || []).map((s) => ({
    id: s.id,
    name: `${s.first_name || ''} ${s.last_name || ''}`.trim(),
    email: s.email,
    username: s.username,
    program: s.programs?.name || '',
    cohort: s.cohorts?.name || '',
    workshops_attended: s.workshops_attended || 0,
    standup_attended: s.standup_attended || 0,
    mentoring_attended: s.mentoring_attended || 0,
    total_attended: (s.workshops_attended || 0) + (s.standup_attended || 0) + (s.mentoring_attended || 0),
  }))

  return { data }
})
