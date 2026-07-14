# Shared Google Calendar sync — setup

Meetings created/edited/removed by any admin (`server/api/meetings/*`) now
sync to one shared Google Calendar, and it's shared directly with every
student's known email address on login — it just shows up on their
personal Google Calendar automatically. No extra consent screen, no
action from them beyond logging in as usual.

## 1. Run the DB migration

```
migrations/2026-07-14-add-google-event-id-to-scheduled-meetings.sql
```

Adds `google_event_id` to `scheduled_meetings` so the app can find/update/
delete the right Google event later.

## 2. Create a Google Cloud service account

This is the credential the *platform* uses to write events and grant
access — it's not tied to any individual admin, so any admin in the
system can create/edit meetings and have them sync correctly, and it's
what shares the calendar with each student.

1. In [Google Cloud Console](https://console.cloud.google.com), create/select a project.
2. Enable the **Google Calendar API** for that project.
3. Create a **Service Account** (IAM & Admin → Service Accounts).
4. Create a JSON key for it and download it. You'll need two values from
   that file: `client_email` and `private_key`.

## 3. Create the shared calendar

1. In any Google account, create a new calendar (e.g. "Program Meetings").
2. Open its settings → **Share with specific people** → add the service
   account's `client_email` with **"Make changes AND manage sharing"**
   permission. This higher level (not just "make changes to events") is
   required because the service account needs to grant read access to
   each student's email on your behalf.
3. Copy the calendar's **Calendar ID** from Settings → "Integrate calendar"
   (looks like `xxxxxxx@group.calendar.google.com`).

The calendar does **not** need to be public — access is granted per
student, individually, by email, the first time they log in.

## 4. Set environment variables

```
GOOGLE_CALENDAR_ID=xxxxxxx@group.calendar.google.com
GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
GOOGLE_CALENDAR_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_CALENDAR_TIMEZONE=America/New_York   # optional, defaults to UTC
```

The private key must keep its `\n` line breaks — most hosting providers
let you paste it as a single-line env var with literal `\n` sequences; the
app converts them back to real newlines automatically.

`GOOGLE_CALENDAR_ID` is also read from the public runtime config (it's
just an ID, not a secret) so the student calendar page can build the
"Add to my Google Calendar" link and embedded view.

## 5. `npm install`

Adds the `googleapis` package used to talk to the Calendar API.

## How students get access

`server/api/auth/ensure-profile.post.js` runs on every login and calls
`shareCalendarWithEmail(user.email)` — a direct Calendar ACL grant, made
server-side by the service account, using only the email already on file
for them. Google adds the calendar to that person's Google Calendar
automatically the moment it's shared with their email; no OAuth
consent screen, no extra scope, no action from the student beyond
logging in like they already do. It's safe to call on every login —
if they already have access, Google just returns "already shared" and
nothing changes.

## What happens without this setup

Nothing breaks. `server/utils/googleCalendar.js` checks whether it's
configured before making any Google API call — if the env vars aren't
set, meeting create/update/remove still work normally in the app's own
database, and login/role-check still works, they just don't touch Google
at all. You can turn this on later without re-deploying anything else.

## No re-consent needed

Unlike an earlier version of this plan, the Google OAuth login scope was
**not** changed — students still only grant `calendar.readonly` as
before (a pre-existing, currently-unused scope), and nothing new is asked
of them at login.
