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
