import { createError } from 'h3'
import { serverSupabaseServiceRole } from '#supabase/server'

// POST /api/notifications/monitor-status
// Called once a day by the GitHub Actions workflow, after status has
// been recalculated by the RPC function. Compares each student's
// current `status` against `last_notified_status`, and for anyone whose
// status changed to 'At Risk' or 'Monitor' (per notification_settings),
// sends an email/Slack alert, then updates last_notified_status so the
// same change isn't re-notified tomorrow.
//
// Uses the service role client (not the user-session client) because
// this is called by a backend cron job with no logged-in user — there
// is no admin session to check here, unlike the other /api/notifications
// route.
export default defineEventHandler(async (event) => {
  const supabase = serverSupabaseServiceRole(event)

  const { data: settings, error: settingsError } = await supabase
    .from('notification_settings')
    .select('*')
    .single()

  if (settingsError) {
    throw createError({ statusCode: 500, statusMessage: 'Could not load notification settings' })
  }

  // If neither channel is enabled, nothing to do.
  if (!settings?.email_enabled && !settings?.slack_enabled) {
    return { changes_detected: 0, message: 'Notifications are disabled in settings' }
  }

  const { data: students, error: studentsError } = await supabase
    .from('students')
    .select('id, first_name, last_name, email, status, last_notified_status')
    .eq('is_active', true)

  if (studentsError) {
    throw createError({ statusCode: 500, statusMessage: studentsError.message })
  }

  const watchedStatuses = []
  if (settings.notify_on_at_risk) watchedStatuses.push('At Risk')
  if (settings.notify_on_monitor) watchedStatuses.push('Monitor')

  const changed = (students || []).filter((s) => {
    const statusChanged = s.status !== s.last_notified_status
    const isWatchedStatus = watchedStatuses.includes(s.status)
    return statusChanged && isWatchedStatus
  })

  if (changed.length === 0) {
    return { changes_detected: 0, message: 'No status changes requiring notification' }
  }

  const lines = changed.map(
    (s) => `${s.first_name} ${s.last_name} (${s.email}) is now: ${s.status}`
  )
  const summary = `${changed.length} student(s) changed status:\n\n${lines.join('\n')}`

  // Send email
  if (settings.email_enabled && (settings.email_recipients || []).length > 0) {
    try {
      const { sendMail } = useNodeMailer()
      await sendMail({
        to: settings.email_recipients,
        subject: `Student Status Alert — ${changed.length} change(s)`,
        text: summary,
        html: `<p>${changed.length} student(s) changed status:</p><ul>${lines
          .map((l) => `<li>${l}</li>`)
          .join('')}</ul>`
      })
    } catch (err) {
      console.error('Failed to send status-change email:', err)
    }
  }

  // Send Slack
  if (settings.slack_enabled && settings.slack_webhook_url) {
    try {
      await fetch(settings.slack_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: summary })
      })
    } catch (err) {
      console.error('Failed to send status-change Slack message:', err)
    }
  }

  // Mark these students as notified for their current status
  for (const s of changed) {
    await supabase
      .from('students')
      .update({ last_notified_status: s.status })
      .eq('id', s.id)
  }

  return { changes_detected: changed.length }
})
