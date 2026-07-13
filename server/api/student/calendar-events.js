import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'
import { getOccurrenceDates, occurrenceToEvent } from '~/server/utils/meetingOccurrences'

export default defineEventHandler(async (event) => {
  try {
    const user = await serverSupabaseUser(event)

    if (!user) {
      throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    const query = getQuery(event)
    const period = query.period || 'today'
    const month = query.month !== undefined ? parseInt(query.month) : null
    const year = query.year !== undefined ? parseInt(query.year) : null

    // Calculate time range based on period (with optional month/year for calendar view)
    const { timeMin, timeMax } = getTimeRange(period, month, year)

    // Only admin-scheduled meetings are shown on the student calendar —
    // personal Google Calendar events are intentionally NOT merged in here.
    // (Google Calendar sync code is left in place below, disabled, in case
    // it's wanted again later — see ENABLE_GOOGLE_CALENDAR_SYNC.)
    const pinnedEvents = await getPinnedMeetingEvents(event, timeMin, timeMax)

    const ENABLE_GOOGLE_CALENDAR_SYNC = false
    if (!ENABLE_GOOGLE_CALENDAR_SYNC) {
      return { data: pinnedEvents }
    }

    // Get the access token from the request headers (passed from client)
    const accessToken = getHeader(event, 'x-google-token')

    if (!accessToken) {
      return { data: pinnedEvents, error: pinnedEvents.length ? undefined : 'No Google access token provided' }
    }

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(
        timeMin
      )}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (!res.ok) {
      const errorText = await res.text()
      console.error('Google Calendar API error:', errorText)
      return { data: pinnedEvents, error: 'Failed to fetch calendar events' }
    }

    const data = await res.json()
    const googleEvents = data.items || []

    const merged = [...pinnedEvents, ...googleEvents].sort((a, b) => {
      const aStart = new Date(a.start?.dateTime || a.start?.date).getTime()
      const bStart = new Date(b.start?.dateTime || b.start?.date).getTime()
      return aStart - bStart
    })

    return { data: merged }
  } catch (err) {
    console.error('Calendar events handler error:', err)
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err?.message || 'Internal server error'
    })
  }
})

// Fetches active scheduled_meetings visible to this student (RLS-scoped)
// and expands their weekly recurrence into concrete occurrences within range.
async function getPinnedMeetingEvents(event, timeMin, timeMax) {
  try {
    const supabase = await serverSupabaseClient(event)
    const { data: meetings, error } = await supabase
      .from('scheduled_meetings')
      .select('*')
      .eq('is_active', true)

    if (error) {
      console.error('Error fetching scheduled meetings:', error)
      return []
    }

    const events = []
    for (const meeting of meetings || []) {
      const dates = getOccurrenceDates(meeting, timeMin, timeMax)
      for (const date of dates) {
        events.push(occurrenceToEvent(meeting, date))
      }
    }
    return events
  } catch (err) {
    console.error('Error building pinned meeting events:', err)
    return []
  }
}

function getTimeRange(period = 'today', month = null, year = null) {
  let timeMin = new Date()
  let timeMax = new Date()

  if (period === 'week') {
    timeMin.setDate(timeMin.getDate() - timeMin.getDay() + 1)
    timeMin.setHours(0, 0, 0, 0)
    timeMax.setDate(timeMax.getDate() - timeMax.getDay() + 8)
    timeMax.setHours(0, 0, 0, 0)
  } else if (period === 'month') {
    // If month and year are provided, use them (for calendar page navigation)
    if (month !== null && year !== null) {
      timeMin = new Date(year, month, 1)
      timeMin.setHours(0, 0, 0, 0)
      timeMax = new Date(year, month + 1, 0, 23, 59, 59)
    } else {
      // Default to current month
      timeMin.setDate(1)
      timeMin.setHours(0, 0, 0, 0)
      timeMax.setMonth(timeMax.getMonth() + 1, 0)
      timeMax.setHours(23, 59, 59, 999)
    }
  } else if (period === 'today') {
    timeMin.setHours(0, 0, 0, 0)
    timeMax.setHours(23, 59, 59, 999)
  }

  return {
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
  }
}
