import { createError } from 'h3'
import { serverSupabaseServiceRole } from '#supabase/server'

// POST /api/notifications/pipeline-failed
// Called by GitHub Actions when the daily data scraper fails.
// No user session — uses service role to read notification_settings,
// then emails/Slacks the configured recipients.
// Body: { run_number, run_id, repo }
export default defineEventHandler(async (event) => {
  const supabase = serverSupabaseServiceRole(event)
  const body = await readBody(event)

  const { run_number, run_id, repo } = body || {}

  const { data: settings, error: settingsError } = await supabase
    .from('notification_settings')
    .select('*')
    .single()

  if (settingsError) {
    throw createError({ statusCode: 500, statusMessage: 'Could not load notification settings' })
  }

  if (!settings?.email_enabled && !settings?.slack_enabled) {
    return { message: 'Notifications are disabled — pipeline failure not forwarded' }
  }

  const runUrl = `https://github.com/${repo}/actions/runs/${run_id}`
  const subject = `⚠️ Daily Data Scraper Failed — Run #${run_number}`
  const text = [
    `The daily student data pipeline failed on run #${run_number}.`,
    ``,
    `This means student progress, attendance, and status data was NOT updated for today.`,
    ``,
    `View the full logs here: ${runUrl}`,
    ``,
    `Common causes:`,
    `  • Qwasar login credentials expired (SCRAPER_USERNAME / SCRAPER_PASSWORD)`,
    `  • Google credentials file expired or revoked`,
    `  • Supabase project paused (happens on free tier after inactivity)`,
    `  • A database permission issue (check the log for "permission denied")`,
  ].join('\n')

  if (settings.email_enabled && (settings.email_recipients || []).length > 0) {
    try {
      const { sendMail } = useNodeMailer()
      await sendMail({
        to: settings.email_recipients,
        subject,
        text,
        html: text.replace(/\n/g, '<br>').replace(runUrl, `<a href="${runUrl}">${runUrl}</a>`)
      })
    } catch (err) {
      console.error('Failed to send pipeline failure email:', err)
    }
  }

  if (settings.slack_enabled && settings.slack_webhook_url) {
    try {
      await fetch(settings.slack_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `${subject}\n\n${text}`
        })
      })
    } catch (err) {
      console.error('Failed to send pipeline failure Slack message:', err)
    }
  }

  return { message: 'Pipeline failure notification sent' }
})
