// server/utils/googleCalendar.js
//
// Talks to ONE shared Google Calendar that the platform owns, using a
// service account (not any individual admin's login). This is why any
// admin in the `admin` table can create/edit/remove a meeting and have it
// reflected on Google: the write always goes through this same credential,
// regardless of which admin clicked the button.
//
// Students never grant any calendar permission themselves. Instead, the
// service account directly shares the calendar with each student's known
// email address (shareCalendarWithEmail, called from
// server/api/auth/ensure-profile.post.js on every login) -- Google adds a
// shared calendar to someone's list automatically the moment it's shared
// with their email, no consent screen involved. All the app needs is the
// email already on file for them.
//
// Setup required (see migrations/README-google-calendar-sync.md):
//   1. Create a Google Cloud service account, enable the Calendar API.
//   2. Create a Google Calendar, share it with the service account email
//      as "Make changes AND manage sharing" (needed so the service account
//      can grant access to individual students via the API).
//   4. Set GOOGLE_CALENDAR_ID, GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL,
//      GOOGLE_CALENDAR_SERVICE_ACCOUNT_PRIVATE_KEY (and optionally
//      GOOGLE_CALENDAR_TIMEZONE) in your environment.
//
// If those aren't configured yet, every function here logs a warning and
// no-ops (returns null) rather than throwing -- meeting create/update/
// remove in the app's own database always succeeds regardless of whether
// Google sync is set up, so this feature can be turned on incrementally.

// import { google } from 'googleapis'

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function getConfig() {
  const config = useRuntimeConfig();
  return {
    calendarId: config.public?.googleCalendarId,
    serviceAccountEmail: config.googleCalendarServiceAccountEmail,
    // Private keys stored in env vars usually have literal "\n" sequences
    // instead of real newlines -- restore them or the JWT signer rejects the key.
    privateKey: config.googleCalendarServiceAccountPrivateKey?.replace(
      /\\n/g,
      "\n",
    ),
    timezone: config.googleCalendarTimezone || "UTC",
  };
}

function isConfigured(cfg) {
  return Boolean(cfg.calendarId && cfg.serviceAccountEmail && cfg.privateKey);
}

let cachedClient = null;
function getCalendarClient(cfg) {
  if (cachedClient) return cachedClient;

  const auth = new google.auth.JWT({
    email: cfg.serviceAccountEmail,
    key: cfg.privateKey,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });

  cachedClient = google.calendar({ version: "v3", auth });
  return cachedClient;
}

function buildRRule(meeting) {
  const parts = [`FREQ=WEEKLY`, `BYDAY=${DAY_CODES[meeting.day_of_week]}`];
  if (meeting.ends_on) {
    // RRULE UNTIL wants a bare date/time in UTC basic format (YYYYMMDD).
    const until = String(meeting.ends_on).replace(/-/g, "");
    parts.push(`UNTIL=${until}T235959Z`);
  }
  return `RRULE:${parts.join(";")}`;
}

function buildEventPayload(meeting, timezone) {
  const startTime =
    meeting.start_time?.length === 5
      ? `${meeting.start_time}:00`
      : meeting.start_time;
  const endTime =
    meeting.end_time?.length === 5
      ? `${meeting.end_time}:00`
      : meeting.end_time;

  const payload = {
    summary: meeting.title,
    description: meeting.description || undefined,
    start: {
      dateTime: `${meeting.starts_on}T${startTime}`,
      timeZone: timezone,
    },
    end: {
      dateTime: `${meeting.starts_on}T${endTime}`,
      timeZone: timezone,
    },
    recurrence: [buildRRule(meeting)],
  };

  if (meeting.meeting_link) {
    // Admin provided their own link (Zoom, an existing Meet room, etc.) --
    // respect it, don't generate a competing Google Meet link.
    payload.location = meeting.meeting_link;
  } else {
    // No link provided -- ask Google to generate a real Google Meet link
    // as part of creating/updating this event. Requires
    // conferenceDataVersion: 1 on the API call itself (see callers below).
    payload.conferenceData = {
      createRequest: {
        requestId: `meet-${meeting.id}-${Date.now()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  return payload;
}

/**
 * Creates the recurring event on the shared calendar for a newly-scheduled
 * meeting. If the meeting has no meeting_link, asks Google to generate a
 * real Google Meet link as part of creating the event.
 *
 * Returns { eventId, meetingLink } -- eventId is stored on the
 * scheduled_meetings row (so update/delete can find it later); meetingLink
 * is only populated when one was freshly auto-generated (null if the admin
 * already supplied their own link, or if sync isn't configured / fails).
 */
export async function createSharedCalendarEvent(meeting) {
  const cfg = getConfig();
  if (!isConfigured(cfg)) {
    console.warn(
      "[googleCalendar] Not configured -- skipping calendar sync for meeting",
      meeting.id,
    );
    return { eventId: null, meetingLink: null };
  }

  const needsGeneratedLink = !meeting.meeting_link;

  try {
    const calendar = getCalendarClient(cfg);
    const res = await calendar.events.insert({
      calendarId: cfg.calendarId,
      conferenceDataVersion: needsGeneratedLink ? 1 : undefined,
      requestBody: buildEventPayload(meeting, cfg.timezone),
    });
    return {
      eventId: res.data.id,
      meetingLink: needsGeneratedLink ? res.data.hangoutLink || null : null,
    };
  } catch (err) {
    console.error(
      "[googleCalendar] Failed to create event for meeting",
      meeting.id,
      err?.message || err,
    );
    return { eventId: null, meetingLink: null };
  }
}

/**
 * Updates the existing Google event for a meeting that was edited. If the
 * meeting has no google_event_id yet (e.g. it was created before this
 * feature existed), creates one instead. If the meeting still has no
 * meeting_link (e.g. the admin cleared it to request a fresh one), asks
 * Google to generate one, same as on create.
 *
 * Returns { eventId, meetingLink }, same shape as createSharedCalendarEvent.
 */
export async function updateSharedCalendarEvent(meeting) {
  const cfg = getConfig();
  if (!isConfigured(cfg)) {
    console.warn(
      "[googleCalendar] Not configured -- skipping calendar sync for meeting",
      meeting.id,
    );
    return { eventId: null, meetingLink: null };
  }

  if (!meeting.google_event_id) {
    return createSharedCalendarEvent(meeting);
  }

  const needsGeneratedLink = !meeting.meeting_link;

  try {
    const calendar = getCalendarClient(cfg);
    const res = await calendar.events.patch({
      calendarId: cfg.calendarId,
      eventId: meeting.google_event_id,
      conferenceDataVersion: needsGeneratedLink ? 1 : undefined,
      requestBody: buildEventPayload(meeting, cfg.timezone),
    });
    return {
      eventId: res.data.id,
      meetingLink: needsGeneratedLink ? res.data.hangoutLink || null : null,
    };
  } catch (err) {
    // If the event was deleted out-of-band, fall back to creating a fresh one.
    if (err?.code === 404 || err?.response?.status === 404) {
      console.warn(
        "[googleCalendar] Event missing on Google, recreating for meeting",
        meeting.id,
      );
      return createSharedCalendarEvent(meeting);
    }
    console.error(
      "[googleCalendar] Failed to update event for meeting",
      meeting.id,
      err?.message || err,
    );
    return { eventId: meeting.google_event_id, meetingLink: null };
  }
}

/**
 * Shares the shared meetings calendar directly with a specific email
 * address, using the service account (never the student's own login).
 * This is what makes the calendar show up on a student's personal Google
 * Calendar automatically: Google adds a calendar to someone's list the
 * moment it's shared with their email, with no consent screen and no
 * action needed from them beyond having that Google account. All we need
 * is the email already on file for them.
 *
 * Safe/cheap to call on every login -- if they already have access,
 * Google returns a 409 and we treat that as success.
 */
export async function shareCalendarWithEmail(email) {
  const cfg = getConfig();
  if (!isConfigured(cfg) || !email) return;

  try {
    const calendar = getCalendarClient(cfg);
    await calendar.acl.insert({
      calendarId: cfg.calendarId,
      requestBody: {
        role: "reader",
        scope: { type: "user", value: email },
      },
    });
  } catch (err) {
    const status = err?.code || err?.response?.status;
    if (status === 409) return; // already shared -- fine
    console.error(
      "[googleCalendar] Failed to share calendar with",
      email,
      err?.message || err,
    );
  }
}

/**
 * Deletes the Google event for a removed/cancelled meeting. Safe to call
 * even if the event is already gone.
 */
export async function deleteSharedCalendarEvent(googleEventId) {
  const cfg = getConfig();
  if (!isConfigured(cfg) || !googleEventId) return;

  try {
    const calendar = getCalendarClient(cfg);
    await calendar.events.delete({
      calendarId: cfg.calendarId,
      eventId: googleEventId,
    });
  } catch (err) {
    // Already deleted or never existed -- not an error worth surfacing.
    if (
      err?.code === 404 ||
      err?.response?.status === 404 ||
      err?.code === 410 ||
      err?.response?.status === 410
    ) {
      return;
    }
    console.error(
      "[googleCalendar] Failed to delete event",
      googleEventId,
      err?.message || err,
    );
  }
}
