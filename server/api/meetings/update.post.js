// server/meetings/update.post.js
// POST /api/meetings/update
// Body: { id, ...any of the create.post.js fields }
import { writeAuditLog } from '~/server/utils/auditLog'
import { updateSharedCalendarEvent, deleteSharedCalendarEvent } from '~/server/utils/googleCalendar'
import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

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
  const id = body?.id

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'id is required' })
  }

  const updates = {}
  const allowedFields = [
    'title', 'description', 'meeting_link', 'day_of_week', 'start_time', 'end_time',
    'starts_on', 'ends_on', 'program_id', 'cohort_id', 'is_active'
  ]
  for (const field of allowedFields) {
    if (body[field] !== undefined) updates[field] = body[field]
  }

  if (updates.title !== undefined) updates.title = String(updates.title).trim()
  if (updates.day_of_week !== undefined) {
    const d = Number(updates.day_of_week)
    if (!Number.isInteger(d) || d < 0 || d > 6) {
      throw createError({ statusCode: 400, statusMessage: 'day_of_week must be an integer between 0 and 6' })
    }
    updates.day_of_week = d
  }
  if (updates.start_time && updates.end_time && updates.end_time <= updates.start_time) {
    throw createError({ statusCode: 400, statusMessage: 'end_time must be after start_time' })
  }

  if (Object.keys(updates).length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No fields to update' })
  }

  const { data, error } = await supabase
    .from('scheduled_meetings')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  // Sync to the shared Google Calendar. Deactivating a meeting removes it
  // from the calendar entirely (students no longer see it in-app either,
  // so it shouldn't linger on their Google Calendar). Any other edit
  // (time, title, recurrence, link, or reactivating) updates/recreates it.
  if (updates.is_active === false) {
    if (data.google_event_id) {
      await deleteSharedCalendarEvent(data.google_event_id)
      const { error: syncError } = await supabase
        .from('scheduled_meetings')
        .update({ google_event_id: null })
        .eq('id', id)
      if (syncError) {
        console.error('Failed to clear google_event_id for meeting', id, syncError)
      } else {
        data.google_event_id = null
      }
    }
  } else {
    const { eventId: googleEventId, meetingLink: generatedMeetingLink } = await updateSharedCalendarEvent(data)
    if (googleEventId) {
      const syncUpdates = {}
      if (googleEventId !== data.google_event_id) syncUpdates.google_event_id = googleEventId
      if (generatedMeetingLink && !data.meeting_link) syncUpdates.meeting_link = generatedMeetingLink
      if (Object.keys(syncUpdates).length > 0) {
        const { error: syncError } = await supabase
          .from('scheduled_meetings')
          .update(syncUpdates)
          .eq('id', id)
        if (syncError) {
          console.error('Failed to store google_event_id for meeting', id, syncError)
        } else {
          Object.assign(data, syncUpdates)
        }
      }
    }
  }

  await writeAuditLog(supabase, user.email, 'update_scheduled_meeting', 'scheduled_meeting', id, updates, event)

  return { data, message: 'Meeting updated' }
})
