// server/utils/meetingOccurrences.js
// Shared helper for expanding a scheduled_meetings row's weekly recurrence
// rule into concrete occurrence dates, and for shaping an occurrence as a
// calendar-events.js-compatible "event" object (same shape the frontend
// already expects from the Google Calendar API: summary/start/end/location).

function toDateOnly(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// Returns an array of Date objects (date-only) where `meeting` recurs
// between rangeStart and rangeEnd (inclusive), respecting starts_on/ends_on.
export function getOccurrenceDates(meeting, rangeStart, rangeEnd) {
  const occurrences = []

  const windowStart = toDateOnly(new Date(Math.max(
    new Date(rangeStart).getTime(),
    new Date(meeting.starts_on).getTime()
  )))
  const windowEnd = meeting.ends_on
    ? toDateOnly(new Date(Math.min(new Date(rangeEnd).getTime(), new Date(meeting.ends_on).getTime())))
    : toDateOnly(new Date(rangeEnd))

  if (windowStart > windowEnd) return occurrences

  // Advance to the first matching day_of_week on/after windowStart
  const cursor = new Date(windowStart)
  const offset = (meeting.day_of_week - cursor.getDay() + 7) % 7
  cursor.setDate(cursor.getDate() + offset)

  while (cursor <= windowEnd) {
    occurrences.push(new Date(cursor))
    cursor.setDate(cursor.getDate() + 7)
  }

  return occurrences
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function toLocalIso(date, timeString) {
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  // timeString is 'HH:MM' or 'HH:MM:SS' from Postgres TIME
  const time = timeString.length === 5 ? `${timeString}:00` : timeString
  return `${y}-${m}-${d}T${time}`
}

// Shapes one occurrence as an event object matching the Google Calendar
// event shape already used throughout the frontend (event.summary,
// event.start.dateTime, event.end.dateTime, event.location, event.hangoutLink).
export function occurrenceToEvent(meeting, date) {
  return {
    id: `scheduled-meeting-${meeting.id}-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`,
    summary: meeting.title,
    description: meeting.description || undefined,
    start: { dateTime: toLocalIso(date, meeting.start_time) },
    end: { dateTime: toLocalIso(date, meeting.end_time) },
    location: meeting.meeting_link || undefined,
    hangoutLink: meeting.meeting_link || undefined,
    source: 'scheduled_meeting',
    pinned: true,
    meeting_id: meeting.id
  }
}
