import { createError } from 'h3'
import {
  serverSupabaseClient,
  serverSupabaseServiceRole,
  serverSupabaseUser,
} from '#supabase/server'

export default defineEventHandler(async (event) => {
  let user
  try {
    user = await serverSupabaseUser(event)
  } catch (error) {
    const message = String(error?.statusMessage || error?.message || '')
    if (message === 'Auth session missing!') {
      throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
    }
    throw error
  }

  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const client = await serverSupabaseClient(event)
  const { data: adminRow, error: adminError } = await client
    .from('admin')
    .select('email')
    .eq('email', user.email)
    .maybeSingle()

  if (adminError) {
    console.error('Admin attendance authorization check failed')
    throw createError({ statusCode: 500, statusMessage: 'Unable to verify admin access' })
  }

  if (!adminRow) {
    throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
  }

  const serviceClient = serverSupabaseServiceRole(event)
  const { data: rows, error } = await serviceClient.rpc(
    'get_admin_attendance_students_v2'
  )

  if (error) {
    console.error('Admin attendance v2 RPC failed:', error.message)
    throw createError({
      statusCode: 500,
      statusMessage: 'Unable to load attendance data',
    })
  }

  const data = (rows || []).map((row) => ({
    id: row.student_id,
    name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
    email: row.email,
    username: row.username,
    program: row.program_name || '',
    program_id: row.program_id,
    cohort: row.cohort_name || '',
    cohort_id: row.cohort_id,

    workshops_attended: row.workshops ?? 0,
    standup_attended: row.standups ?? 0,
    mentoring_attended: row.mentoring ?? 0,
    squad_meeting_attended: row.squad_meetings ?? 0,
    total_attended: row.overall ?? 0,

    cohort_pct: row.overall_percent,
    workshop_pct: row.workshops_percent,
    standup_pct: row.standups_percent,
    mentoring_pct: row.mentoring_percent,
    squad_meeting_pct: row.squad_meetings_percent,
    cohort_top_attendee: row.overall_max,

    uses_ledger: row.uses_ledger,
    actual_points: row.actual_points,
    reporting_date: row.reporting_date,
    calendar_coverage_status: row.calendar_coverage_status,

    scheduled_workshops_attended: row.scheduled_workshops_attended,
    scheduled_workshops_total: row.scheduled_workshops_total,
    scheduled_workshops_percent: row.scheduled_workshops_percent,

    scheduled_mentoring_attended: row.scheduled_mentoring_attended,
    scheduled_mentoring_total: row.scheduled_mentoring_total,
    scheduled_mentoring_percent: row.scheduled_mentoring_percent,

    scheduled_standups_attended: row.scheduled_standups_attended,
    scheduled_standups_total: row.scheduled_standups_total,
    scheduled_standups_percent: row.scheduled_standups_percent,

    scheduled_squad_meetings_attended: row.scheduled_squad_meetings_attended,
    scheduled_squad_meetings_total: row.scheduled_squad_meetings_total,
    scheduled_squad_meetings_percent: row.scheduled_squad_meetings_percent,
  }))

  return { data }
})
