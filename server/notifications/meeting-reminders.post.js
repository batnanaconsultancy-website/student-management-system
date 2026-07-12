import { createError } from 'h3'
import { serverSupabaseServiceRole } from '#supabase/server'

// POST /api/notifications/meeting-reminders
// Called once a day by a scheduled GitHub Actions workflow (see
// .github/workflows/meeting-reminders.yaml). For every active
// scheduled_meetings row whose weekly recurrence lands on today, finds
// every student in scope (matching program_id/cohort_id, or everyone if
// those are NULL) and creates a student_notifications row for them,
// unless they were already notified for this exact meeting occurrence
// (tracked in scheduled_meeting_notifications so re-runs are safe).
//
// Uses the service role client — like /api/notifications/monitor-status —
// since this is called by a backend cron job with no logged-in user.
// An optional shared secret (CRON_SECRET env var) can be set to require
// callers to pass an x-cron-secret header; if unset, the route behaves
// like the existing monitor-status route (open, matching current convention).
export default defineEventHandler(async (event) => {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const provided = getHeader(event, 'x-cron-secret')
    if (provided !== cronSecret) {
      throw createError({ statusCode: 401, statusMessage: 'Invalid or missing cron secret' })
    }
  }

  const supabase = serverSupabaseServiceRole(event)

  const today = new Date()
  const todayDateStr = today.toISOString().slice(0, 10) // YYYY-MM-DD (UTC)
  const dayOfWeek = today.getUTCDay() // 0 = Sunday … 6 = Saturday

  // 1. Find today's active meetings
  const { data: meetings, error: meetingsError } = await supabase
    .from('scheduled_meetings')
    .select('*')
    .eq('is_active', true)
    .eq('day_of_week', dayOfWeek)
    .lte('starts_on', todayDateStr)
    .or(`ends_on.is.null,ends_on.gte.${todayDateStr}`)

  if (meetingsError) {
    throw createError({ statusCode: 500, statusMessage: meetingsError.message })
  }

  if (!meetings || meetings.length === 0) {
    return { meetings_today: 0, notifications_sent: 0, message: 'No meetings scheduled for today' }
  }

  let totalSent = 0
  const summary = []

  for (const meeting of meetings) {
    // 2. Find students in scope for this meeting
    let studentQuery = supabase
      .from('students')
      .select('id')
      .eq('is_active', true)

    if (meeting.program_id) studentQuery = studentQuery.eq('program_id', meeting.program_id)
    if (meeting.cohort_id) studentQuery = studentQuery.eq('cohort_id', meeting.cohort_id)

    const { data: students, error: studentsError } = await studentQuery

    if (studentsError) {
      console.error(`Failed to load students for meeting ${meeting.id}:`, studentsError.message)
      continue
    }
    if (!students || students.length === 0) continue

    // 3. Exclude students already notified for this exact occurrence
    const { data: alreadyNotified } = await supabase
      .from('scheduled_meeting_notifications')
      .select('student_id')
      .eq('meeting_id', meeting.id)
      .eq('occurrence_date', todayDateStr)

    const notifiedIds = new Set((alreadyNotified || []).map(r => r.student_id))
    const targets = students.filter(s => !notifiedIds.has(s.id))

    if (targets.length === 0) continue

    const timeLabel = meeting.start_time?.slice(0, 5)

    // 4. Create in-app notifications
    const { error: notifError } = await supabase
      .from('student_notifications')
      .insert(targets.map(s => ({
        student_id: s.id,
        title: `Meeting today: ${meeting.title}`,
        body: timeLabel
          ? `Starts at ${timeLabel}.${meeting.meeting_link ? ' ' + meeting.meeting_link : ''}`
          : (meeting.meeting_link || undefined),
        type: 'info'
      })))

    if (notifError) {
      console.error(`Failed to insert notifications for meeting ${meeting.id}:`, notifError.message)
      continue
    }

    // 5. Log so a re-run today doesn't double-notify
    await supabase
      .from('scheduled_meeting_notifications')
      .insert(targets.map(s => ({
        meeting_id: meeting.id,
        student_id: s.id,
        occurrence_date: todayDateStr
      })))

    totalSent += targets.length
    summary.push({ meeting: meeting.title, notified: targets.length })
  }

  return {
    meetings_today: meetings.length,
    notifications_sent: totalSent,
    details: summary
  }
})
