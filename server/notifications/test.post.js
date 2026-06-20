import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

// POST /api/notifications/test
// Body: { type: 'email' | 'slack' }
// Sends a real test notification using the notification_settings row
// (recipients / webhook URL) already saved in the database.
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const { data: callerRow } = await supabase
    .from('admin')
    .select('email')
    .eq('email', user.email)
    .maybeSingle()

  if (!callerRow) {
    throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
  }

  const body = await readBody(event)
  const type = body?.type === 'slack' ? 'slack' : 'email'

  const { data: settings, error: settingsError } = await supabase
    .from('notification_settings')
    .select('*')
    .single()

  if (settingsError) {
    throw createError({ statusCode: 500, statusMessage: 'Could not load notification settings' })
  }

  if (type === 'email') {
    const recipients = settings?.email_recipients || []
    if (recipients.length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'No email recipients configured. Add at least one recipient and save before testing.'
      })
    }

    // Uses the nuxt-nodemailer module already configured in nuxt.config.ts
    // (reads NUXT_NODEMAILER_HOST / AUTH_USER / AUTH_PASS from your .env)
    const { sendMail } = useNodeMailer()
    try {
      await sendMail({
        to: recipients,
        subject: 'Test Notification — Student Management System',
        text: `This is a test notification sent by ${user.email} to confirm email alerts are working correctly.`,
        html: `<p>This is a test notification sent by <strong>${user.email}</strong> to confirm email alerts are working correctly.</p>`
      })
    } catch (mailError) {
      throw createError({
        statusCode: 500,
        statusMessage: `Failed to send test email: ${mailError.message || 'Check your NUXT_NODEMAILER_* env vars'}`
      })
    }

    return { message: `Test email sent to ${recipients.length} recipient(s)` }
  }

  // type === 'slack'
  const webhookUrl = settings?.slack_webhook_url
  if (!webhookUrl) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No Slack webhook URL configured. Add one and save before testing.'
    })
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `Test notification sent by ${user.email} — Slack alerts are working correctly.`
      })
    })
    if (!response.ok) {
      throw new Error(`Slack returned status ${response.status}`)
    }
  } catch (slackError) {
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to send Slack test message: ${slackError.message}`
    })
  }

  return { message: 'Test Slack message sent' }
})
