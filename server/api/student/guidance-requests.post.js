// server/api/student/guidance-requests.post.js
// POST /api/student/guidance-requests
// Body: { categories: string[], message?: string }
//
// Submits a guidance/request ticket for the logged-in student, then
// fires a best-effort Slack notification (using the same webhook config
// admins already set for status alerts) and an email to Isadora
// (always, regardless of notification_settings -- she's the designated
// contact for these requests specifically) via the already-configured
// nuxt-nodemailer SMTP integration. Neither notification failing blocks
// the submission itself from succeeding.

import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser, serverSupabaseServiceRole } from '#supabase/server'
import { GUIDANCE_CATEGORIES, GUIDANCE_REQUEST_WORD_LIMIT } from '~/constants/options'
import { countWords } from '~/utils/wordCount'

const ISADORA_EMAIL = 'isadora@amsterdam.tech'

export default defineEventHandler(async (event) => {
  const client = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const body = await readBody(event)
  const categories = Array.isArray(body?.categories) ? body.categories : []
  const message = typeof body?.message === 'string' ? body.message.trim() : ''

  if (categories.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Select at least one category' })
  }
  const invalidCategories = categories.filter((c) => !GUIDANCE_CATEGORIES.includes(c))
  if (invalidCategories.length > 0) {
    throw createError({ statusCode: 400, statusMessage: `Unrecognized category: ${invalidCategories.join(', ')}` })
  }
  if (countWords(message) > GUIDANCE_REQUEST_WORD_LIMIT) {
    throw createError({ statusCode: 400, statusMessage: `Message must be ${GUIDANCE_REQUEST_WORD_LIMIT} words or fewer` })
  }

  // Look up the student's own id from their session email.
  const { data: student, error: studentError } = await client
    .from('students')
    .select('id, first_name, last_name, email')
    .eq('email', user.email)
    .maybeSingle()

  if (studentError) {
    throw createError({ statusCode: 500, statusMessage: studentError.message })
  }
  if (!student) {
    throw createError({ statusCode: 404, statusMessage: 'Student record not found for this account' })
  }

  const { data: created, error: insertError } = await client
    .from('guidance_requests')
    .insert({ student_id: student.id, categories, message: message || null })
    .select('id, categories, message, status, created_at')
    .single()

  if (insertError) {
    throw createError({ statusCode: 500, statusMessage: insertError.message })
  }

  // Notifications are best-effort -- log failures, never fail the
  // request the student just successfully submitted over them.
  const studentName = `${student.first_name || ''} ${student.last_name || ''}`.trim() || student.email

  try {
    await notifySlack(event, studentName, student.email, categories, message)
  } catch (err) {
    console.error('[guidance-requests] Slack notification failed:', err?.message || err)
  }

  try {
    await notifyEmail(studentName, student.email, categories, message)
  } catch (err) {
    console.error('[guidance-requests] Email notification failed:', err?.message || err)
  }

  return { success: true, data: created }
})

async function notifySlack(event, studentName, studentEmail, categories, message) {
  const serviceClient = serverSupabaseServiceRole(event)
  const { data: settings } = await serviceClient
    .from('notification_settings')
    .select('slack_enabled, slack_webhook_url')
    .maybeSingle()

  if (!settings?.slack_enabled || !settings?.slack_webhook_url) return

  await $fetch(settings.slack_webhook_url, {
    method: 'POST',
    body: {
      text: `New guidance request from ${studentName}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: '📩 New Guidance & Request submission', emoji: true },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Student:*\n${studentName}` },
            { type: 'mrkdwn', text: `*Email:*\n${studentEmail}` },
            { type: 'mrkdwn', text: `*Categories:*\n${categories.join(', ')}` },
          ],
        },
        message
          ? { type: 'section', text: { type: 'mrkdwn', text: `*Message:*\n${message}` } }
          : null,
        { type: 'context', elements: [{ type: 'mrkdwn', text: `Submitted: ${new Date().toLocaleString()}` }] },
      ].filter(Boolean),
    },
  })
}

async function notifyEmail(studentName, studentEmail, categories, message) {
  const { sendMail } = useNodeMailer()

  const categoriesHtml = categories.map((c) => `<li>${c}</li>`).join('')

  await sendMail({
    to: ISADORA_EMAIL,
    subject: `New Guidance & Request submission -- ${studentName}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto;">
        <h2>New Guidance & Request submission</h2>
        <p><strong>Student:</strong> ${studentName}<br>
           <strong>Email:</strong> ${studentEmail}</p>
        <p><strong>Categories:</strong></p>
        <ul>${categoriesHtml}</ul>
        ${message ? `<p><strong>Message:</strong><br>${message}</p>` : ''}
        <p style="color:#6c757d;font-size:12px;">Submitted: ${new Date().toLocaleString()}</p>
      </div>
    `,
    text: `New Guidance & Request submission\n\nStudent: ${studentName}\nEmail: ${studentEmail}\nCategories: ${categories.join(', ')}\n${message ? `Message: ${message}\n` : ''}\nSubmitted: ${new Date().toLocaleString()}`,
  })
}
