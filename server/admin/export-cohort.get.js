import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

// GET /api/admin/export-cohort?cohort_name=Mar26
// Returns CSV of all students in the cohort with their progress data
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })

  const { data: callerRow } = await supabase
    .from('admin').select('email').eq('email', user.email).maybeSingle()
  if (!callerRow) throw createError({ statusCode: 403, statusMessage: 'Admin access required' })

  const { cohort_name } = getQuery(event)

  let q = supabase
    .from('students')
    .select(`
      first_name, last_name, email, username,
      account_status, status, points, exercises_completed,
      workshops_attended, standup_attended, mentoring_attended, points_assigned,
      last_login,
      cohorts:cohort_id(name),
      programs:program_id(name)
    `)
    .order('last_name', { ascending: true })

  if (cohort_name) {
    const { data: cohortRows } = await supabase
      .from('cohorts').select('id').eq('name', cohort_name)
    const ids = (cohortRows || []).map(c => c.id)
    if (ids.length > 0) q = q.in('cohort_id', ids)
  }

  const { data, error } = await q
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  // Build CSV
  const headers = [
    'Last Name', 'First Name', 'Email', 'Qwasar ID',
    'Programme', 'Cohort', 'Account Status', 'Progress Status',
    'Points', 'Exercises', 'Workshops', 'Standups', 'Mentoring', 'Attendance Points',
    'Last Login'
  ]

  const rows = (data || []).map(s => [
    s.last_name,
    s.first_name,
    s.email,
    s.username || '',
    s.programs?.name || '',
    s.cohorts?.name || '',
    s.account_status,
    s.status || 'Unknown',
    s.points,
    s.exercises_completed,
    s.workshops_attended,
    s.standup_attended,
    s.mentoring_attended,
    s.points_assigned,
    s.last_login ? new Date(s.last_login).toLocaleDateString('en-GB') : ''
  ].map(v => `"${String(v).replace(/"/g, '""')}"`))

  const csv = [headers.map(h => `"${h}"`).join(','), ...rows.map(r => r.join(','))].join('\n')

  const filename = cohort_name
    ? `cohort-${cohort_name.replace(/\s/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`
    : `all-students-${new Date().toISOString().slice(0, 10)}.csv`

  setResponseHeaders(event, {
    'Content-Type': 'text/csv',
    'Content-Disposition': `attachment; filename="${filename}"`
  })

  return csv
})
