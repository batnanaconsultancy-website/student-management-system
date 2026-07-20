// server/student/report-issue.post.js
// POST /api/student/report-issue
// Body: { type: string, description: string }
// Creates a student_issues record AND creates a notification for all admins.
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
    .select('id, first_name, last_name, email')
    .eq('email', user.email)
    .maybeSingle()

  if (!student) throw createError({ statusCode: 404, statusMessage: 'Student record not found' })

  const body = await readBody(event)
  const type = typeof body?.type === 'string' ? body.type.trim() : ''
  const description = typeof body?.description === 'string' ? body.description.trim() : ''

  if (!type || !description) {
    throw createError({ statusCode: 400, statusMessage: 'type and description are required' })
  }

  const { data, error } = await supabase
    .from('student_issues')
    .insert({
      student_id: student.id,
      type,
      description,
      status: 'open'
    })
    .select('id')
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  // Create an admin notification for this issue
  const { data: admins } = await supabase.from('admin').select('email')
  if (admins && admins.length > 0) {
    await supabase.from('admin_notifications').insert(
      admins.map(a => ({
        admin_email: a.email,
        type: 'student_issue',
        title: `Issue reported by ${student.first_name} ${student.last_name}`,
        body: `${type}: ${description}`,
        entity_type: 'student_issue',
        entity_id: data.id,
        is_read: false
      }))
    )
  }

  return { data, message: 'Issue reported successfully. An admin will review it shortly.' }
})
