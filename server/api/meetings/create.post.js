// server/meetings/create.post.js
// POST /api/meetings/create
// Body: { title, description?, meeting_link?, day_of_week, start_time, end_time,
//         starts_on?, ends_on?, program_id?, cohort_id?, is_active? }
import { writeAuditLog } from '~/server/utils/auditLog'
import { createSharedCalendarEvent } from '~/server/utils/googleCalendar'
import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

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

  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const description = typeof body?.description === 'string' ? body.description.trim() : null
  const meetingLink = typeof body?.meeting_link === 'string' ? body.meeting_link.trim() : null
  const dayOfWeek = Number(body?.day_of_week)
  const startTime = body?.start_time
  const endTime = body?.end_time
  const startsOn = body?.starts_on || new Date().toISOString().slice(0, 10)
  const endsOn = body?.ends_on || null
  const programId = body?.program_id || null
  const cohortId = body?.cohort_id || null
  const isActive = body?.is_active !== false

  if (!title) {
    throw createError({ statusCode: 400, statusMessage: 'Title is required' })
  }
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    throw createError({ statusCode: 400, statusMessage: 'day_of_week must be an integer between 0 (Sunday) and 6 (Saturday)' })
  }
  if (!startTime || !endTime) {
    throw createError({ statusCode: 400, statusMessage: 'start_time and end_time are required' })
  }
  if (endTime <= startTime) {
    throw createError({ statusCode: 400, statusMessage: 'end_time must be after start_time' })
  }

  const { data, error } = await supabase
    .from('scheduled_meetings')
    .insert({
      title,
      description,
      meeting_link: meetingLink,
      day_of_week: dayOfWeek,
      start_time: startTime,
      end_time: endTime,
      starts_on: startsOn,
      ends_on: endsOn,
      program_id: programId,
      cohort_id: cohortId,
      is_active: isActive,
      created_by: user.email
    })
    .select('*')
    .single()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  // Sync to the shared Google Calendar. If this fails or isn't configured,
  // the meeting still exists in the app -- we don't fail the whole request
  // over a calendar sync issue, just log it and move on without the ID.
  // If no meeting_link was given, Google may have generated a Meet link --
  // store that back too so it shows up in the app and stays attached to
  // this meeting for future edits.
  const { eventId: googleEventId, meetingLink: generatedMeetingLink } = await createSharedCalendarEvent(data)
  if (googleEventId) {
    const syncUpdates = { google_event_id: googleEventId }
    if (generatedMeetingLink) {
      syncUpdates.meeting_link = generatedMeetingLink
    }
    const { error: syncError } = await supabase
      .from('scheduled_meetings')
      .update(syncUpdates)
      .eq('id', data.id)
    if (syncError) {
      console.error('Failed to store google_event_id for meeting', data.id, syncError)
    } else {
      Object.assign(data, syncUpdates)
    }
  }

  await writeAuditLog(supabase, user.email, 'create_scheduled_meeting', 'scheduled_meeting', data.id,
    { title, day_of_week: DAY_NAMES[dayOfWeek], start_time: startTime, end_time: endTime }, event)

  return { data, message: `"${title}" scheduled every ${DAY_NAMES[dayOfWeek]}` }
})
