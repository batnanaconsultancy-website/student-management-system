# AIT Student Management System

A full-stack student management platform for Amsterdam Tech built with Nuxt 4, Supabase, and Python data pipelines.

## Tech Stack

- **Frontend/Backend**: Nuxt 4 (Vue 3) + TypeScript
- **Database**: Supabase (PostgreSQL + Auth + RLS)
- **Styling**: Tailwind CSS v4 + Nuxt UI
- **Automation**: GitHub Actions (daily cron)
- **Data Pipeline**: Python 3.11 scripts

## Project Structure

```
final_project/
├── .github/workflows/        # GitHub Actions CI/CD (daily scraper)
├── .vscode/                  # Recommended extensions + editor settings
├── assets/css/               # Tailwind + global styles
├── components/                # Vue components (admin + student)
├── composables/               # Shared Vue composables
├── constants/                 # App-wide constants
├── layouts/                   # default.vue (admin) + custom.vue (student)
├── middleware/                 # Auth guards (admin, student-only, global)
├── pages/                      # File-based routing
│   ├── admin/                  # Admin dashboard, cohorts, analytics, management
│   ├── auth/                   # OAuth callback
│   └── students/                # Student portal (incl. AI-Mentor tab)
├── public/                      # Static assets + student_grades.json cache
├── schema.sql                   # Complete Supabase PostgreSQL schema
├── scripts/                     # Python data pipeline
│   ├── main.py                  # Orchestrator (--full / --quick / --attendance)
│   ├── data_processor.py        # Qwasar scraper + DB updater
│   ├── analytics.py             # Weekly progress snapshots
│   ├── student_management.py    # Expected-season calc + status RPC call
│   ├── update_attendance.py     # Google Sheets → Supabase
│   ├── update_points_assigned.py
│   ├── update_slack_ids.js
│   └── utils.py                 # Shared Supabase/auth utilities
├── server/                      # Nuxt server API routes
│   ├── student/                  # Student-facing endpoints
│   └── students/                 # Admin student endpoints
├── types/                       # TypeScript type definitions
└── utils/                       # Utility functions (logger, etc.)
```

## Setup

### 1. Create a new Supabase project

1. Go to https://supabase.com → New Project
2. Open SQL Editor → paste the entire contents of `schema.sql` → Run
3. Authentication → Providers → Google → add your OAuth Client ID + Secret
4. Add redirect URLs: `https://<project>.supabase.co/auth/v1/callback` and `http://localhost:3000/auth/confirm`
5. Add your first admin:
   ```sql
   INSERT INTO admin (email) VALUES ('your@email.com');
   ```

### 2. Environment variables

Copy `.env.example` to `.env` and fill in your values:

```bash
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_KEY=<anon-public-key>
SUPABASE_ROLE_KEY=<service-role-key>
SCRAPER_USERNAME=<qwasar-username>
SCRAPER_PASSWORD=<qwasar-password>
```

### 3. Install and run the web app

```bash
npm install
npm run dev
```

App runs at **http://localhost:3000**

### 4. Python data pipeline (optional, for local testing)

```bash
cd scripts
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r ../requirements.txt
python main.py --full --scrape  # full pipeline with live scraping
python main.py --quick          # status + analytics only, no scraping
python main.py --attendance     # sync attendance from Google Sheets
```

### 5. GitHub Actions secrets (for the daily cron job)

In your repo: Settings → Secrets and variables → Actions, add:

- `SUPABASE_URL`
- `SUPABASE_KEY`
- `SUPABASE_ROLE_KEY`
- `SCRAPER_USERNAME`
- `SCRAPER_PASSWORD`
- `GOOGLE_CREDENTIALS_JSON` (service account JSON for Sheets access)
- `APP_URL` (your deployed app's base URL, used for the notification webhook)

The workflow at `.github/workflows/daily-data-scraper.yaml` runs automatically at 06:00 UTC daily, or can be triggered manually from the Actions tab with a choice of `full`, `quick`, or `data-only` modes.

## Features

**Admin**

- Student roster management (CSV import, manual edit)
- Cohort, program, and season configuration
- Attendance and progress analytics dashboards
- Email/Slack notification settings

**Students**

- Personal dashboard with progress stats
- Calendar (synced from Google Calendar)
- Roadmap and timeline views of their curriculum
- AI-Mentor — embedded live AI video chat (Anam AI)

**Automation**

- Daily Qwasar profile scrape → updates points, exercises, season progress
- Google Sheets attendance sync → updates attendance counts and scores
- Automated status calculation (On Track / At Risk / Monitor / Ahead) via Postgres RPC
- Status-change email/Slack notifications

## Known data quirks

- `public/student_grades.json` is a cache file regenerated nightly by the scraper; it's safe to delete and will be recreated on the next run.
- The `img_url` field for some students is a base64-encoded placeholder image — this is expected and renders fine in the browser.








# Canvas sync — patch for your SIS

This is a small patch, not a full project copy (your `Final_Project` is huge
with `node_modules`/`.git`/etc. — no need to re-zip all of that). It adds a
native "Canvas" admin page that syncs student rosters, assignments, and
submissions from Canvas into your own Supabase tables, then displays them —
same course-dropdown + "Sync Now" + table pattern as your reference app.

## Files in this patch

```
migrations/2026-08-20-create-canvas-tables.sql   <- new tables (run in Supabase)
server/utils/canvasApi.js                        <- Canvas REST API wrapper
server/api/admin/canvas/courses.get.js            <- GET  list Canvas courses
server/api/admin/canvas/sync.post.js               <- POST sync one course
server/api/admin/canvas/submissions.get.js          <- GET  read synced data
pages/admin/canvas.vue                               <- the admin page itself
```

Copy each file into the matching path in your `Final_Project` folder
(create the `server/api/admin/canvas/` folder if it doesn't exist yet).

## Why a separate `canvas_students` table

Per your request, Canvas data has its own student table rather than reusing
your existing `students` table, since Canvas enrollment and your SIS's own
student records are two independent systems that won't always line up 1:1:

- **`canvas_students`** — one row per Canvas user (global across your whole
  Canvas instance, so a student in multiple synced courses still gets one row).
- **`canvas_enrollments`** — join table: which students are in which synced
  course. This is what lets the dashboard show every enrolled student,
  including ones with zero submissions, matching Canvas's own gradebook.
- **`canvas_assignments`** — one row per assignment per course.
- **`canvas_submissions`** — one row per (assignment, student) submission,
  referencing `canvas_students` by foreign key rather than repeating
  name/email on every row.

None of these tables have a foreign key into your existing `students` table
— they're fully self-contained under their own `canvas_` prefix.

## 1. Run the migration

In the Supabase SQL editor (or via the Supabase CLI), run:

```
migrations/2026-08-20-create-canvas-tables.sql
```

This creates all four tables with RLS policies matching your existing
`is_admin()` pattern (same as `student_notifications`, `audit_log`, etc.).

## 2. Add environment variables

Add to your `.env` (and to your hosting provider's env vars for production):

```
CANVAS_DOMAIN=amsterdamtech.instructure.com
CANVAS_TOKEN=your_canvas_personal_access_token
```

- **CANVAS_DOMAIN** — bare domain, no `https://`, no trailing slash.
- **CANVAS_TOKEN** — a personal access token from an account with
  teacher/TA/designer access to the courses you want to sync. Generate one
  at `https://<CANVAS_DOMAIN>/profile/settings` → "New Access Token". This
  is one shared token the whole platform uses (same pattern as your Google
  Calendar service-account integration) — individual admins don't need
  their own Canvas login.

Then add both to `runtimeConfig` in `nuxt.config.ts` (server-side only —
do NOT put these under `public`, same as `scraperUsername`/`scraperPassword`):

```ts
runtimeConfig: {
  scraperUsername: process.env.SCRAPER_USERNAME,
  scraperPassword: process.env.SCRAPER_PASSWORD,
  canvasDomain: process.env.CANVAS_DOMAIN,       // <- add this
  canvasToken: process.env.CANVAS_TOKEN,          // <- add this
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  // ...rest unchanged
}
```

## 3. Add the sidebar link

In `layouts/default.vue`, add a new entry to the `mainLinks` array (I'd
suggest right after "Attendance", matching the reference screenshots):

```ts
{
  label: "Canvas",
  to: "/admin/canvas",
  ariaLabel: "Canvas",
  icon: "i-lucide-graduation-cap",
  tooltip: {
    text: "Canvas",
  },
},
```

## 4. Restart your dev server

```
npm run dev
```

Visit `/admin/canvas`. Pick a course from the dropdown (populated live from
Canvas, filtered to courses your token has teacher/TA access to) and it
syncs automatically — no need to click "Sync Now" the first time. The
button is still there for re-pulling the same course on demand later
(e.g. a student just submitted something and you want the table to
reflect it right away).

## How it works end-to-end

1. **`GET /api/admin/canvas/courses`** — calls Canvas live to list courses
   your token can access, for the dropdown. No DB writes.
2. **`POST /api/admin/canvas/sync`** (body `{ canvasCourseId }`) — pulls the
   course roster, assignments, and submissions from Canvas and upserts them
   into `canvas_students` → `canvas_enrollments` → `canvas_assignments` →
   `canvas_submissions`, in that order (students first, since submissions
   reference them by foreign key). Writes an `audit_log` entry, same as
   your other admin write routes.
3. **`GET /api/admin/canvas/submissions?courseId=...`** — reads only from
   your own DB (no live Canvas calls), joins enrollments + assignments +
   submissions into one row per (student, assignment) pair — including
   students who haven't submitted yet, so the table matches a real gradebook.
4. **`pages/admin/canvas.vue`** — the UI: course picker, Sync Now button,
   stat cards, searchable/sortable table. Built with the same `UCard`/
   `UDashboardPanel`/manual `<table>` pattern as your `attendance.vue` page.

## Notes

- Re-running "Sync Now" is always safe — every write is an upsert keyed on
  Canvas's own IDs (`canvas_user_id`, `canvas_assignment_id`), so syncing
  the same course repeatedly just refreshes the data, never duplicates it.
- If `CANVAS_DOMAIN`/`CANVAS_TOKEN` aren't set, the sync/courses endpoints
  return a clear 501 error rather than crashing — the rest of your app is
  unaffected.
- Submission "Status" in the table is Canvas's own `workflow_state`
  (`unsubmitted`, `submitted`, `graded`, `pending_review`), plus a separate
  "late" badge when applicable.
