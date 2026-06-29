# Admin Operations Guide
## Amsterdam Tech Student Management System — What to Do and When

---

## THE CORRECT ORDER TO SET UP FROM SCRATCH

This is the single most important thing to understand. Everything depends on the
layer below it. Skip a step and the next one will fail with a confusing error.

```
1. SQL in Supabase        ← foundation, must be first
2. Verify data in DB      ← confirm before touching the UI
3. Import students        ← CSV upload in the app
4. Trigger the scraper    ← GitHub Actions
5. Check the dashboard    ← confirm data is flowing
```

---

## STEP 1 — Run SQL in Supabase (one time only)

Go to Supabase → SQL Editor. Run these files IN ORDER, one at a time:

| Order | File | What it does |
|-------|------|-------------|
| 1 | `schema.sql` | Creates all 15 tables, RLS policies, RPC function |
| 2 | `schema-grants-fix.sql` | Gives the web app permission to read/write tables |
| 3 | `schema-grants-service-role.sql` | Gives the Python pipeline permission to read/write tables |
| 4 | `fix-column-name.sql` | Renames img_url → profile_image_url |
| 5 | `add-status-tracking-column.sql` | Adds last_notified_status column |
| 6 | `new-tables-batches-3-4.sql` | Creates audit_log, notifications, issues tables |
| 7 | `amsterdam-tech-real-data-seed.sql` | Creates all programmes, cohorts, seasons, and schedules |

After running file 7, run this to add yourself as admin:
```sql
INSERT INTO admin (email) VALUES ('henry@amsterdam.tech');
```

Then verify it worked:
```sql
SELECT p.name AS programme, c.name AS cohort, s.name AS season,
       pcs.start_date, pcs.end_date
FROM program_cohort_seasons pcs
JOIN programs p ON p.id = pcs.program_id
JOIN cohorts c ON c.id = pcs.cohort_id
JOIN seasons s ON s.id = pcs.season_id
ORDER BY p.name, c.name, s.order_in_program;
```
You should see rows for all 3 programmes × 7 cohorts × their seasons.

---

## STEP 2 — Log into the app and verify

Go to http://localhost:3000 (or your deployed URL).
Sign in with Google using the email you inserted into the admin table.
You should land on /admin/dashboard — NOT the student dashboard.

If you land on the student dashboard, your email is not in the admin table.
Go back to Supabase → SQL Editor and run:
```sql
SELECT * FROM admin;
```
Confirm your email is there, spelled correctly.

---

## STEP 3 — Import students via CSV

**The CSV format — column order matters, header text does not:**

| Column 1 | Column 2 | Column 3 | Column 4 | Column 5 |
|----------|----------|----------|----------|----------|
| Full Name | Qwasar ID | Email | Programme | Cohort |

**Critical rules:**
- Programme must be EXACTLY one of: `Software Engineering`, `Data Science`, `AI/ML`
- Cohort must be EXACTLY one of: `Mar 2023`, `Sep 2023`, `Mar 2024`, `Sep 2024`, `Mar 2025`, `Sep 2025`, `Mar 2026`
- Qwasar ID must be the student's exact username on the Qwasar/coding platform
  (this is what the scraper uses to find their profile — a typo here means
  that student's progress will never update)

**Example CSV row:**
```
Jane Doe,jdoe_ait,jane.doe@amsterdam.tech,Software Engineering,Mar 2026
```

Go to: Admin Dashboard → Management → Students → drop the CSV → click Validate CSV
The system will show you a preview of what will be imported, what will be skipped,
and any errors — BEFORE writing anything to the database. Fix errors, then click
Import.

---

## STEP 4 — Trigger the scraper

Go to your GitHub repository → Actions → Daily Data Scraper → Run workflow.

The scraper will:
1. Log into Qwasar using SCRAPER_USERNAME and SCRAPER_PASSWORD
2. Look up each Active student by their Qwasar ID (username column)
3. Scrape their points, exercises, last login, season progress
4. Write it all back to the database
5. Calculate expected_season_id based on today's date vs the season schedule
6. Run the RPC function to set each student's status

A successful run looks like:
```
[OK] Data Scraping & Processing completed successfully
[OK] Student Management completed successfully
[OK] Points Assignment completed successfully
```

A student showing "Unknown" status after the scrape means:
→ Their expected_season_id could not be calculated
→ This almost always means their cohort has no season scheduled
   covering today's date in program_cohort_seasons
→ The seed SQL in Step 1 fixes this for all existing cohorts

---

## STEP 5 — What populates automatically vs what you enter manually

### YOU ENTER (one time per student, via CSV):
- Full name
- Qwasar ID ← most critical — must match exactly
- Email
- Programme
- Cohort

### SYSTEM FILLS AUTOMATICALLY (every night, no action needed):
| Field | Source |
|-------|--------|
| points | Scraped from Qwasar profile |
| exercises_completed | Scraped from Qwasar profile |
| last_login | Scraped from Qwasar profile |
| profile_image_url | Scraped from Qwasar profile |
| current_season_id | Calculated from Qwasar season progress |
| expected_season_id | Calculated from today's date vs schedule |
| status | On Track / At Risk / Monitor / Ahead / Unknown |
| workshops_attended | Synced from Google Attendance Sheet |
| standup_attended | Synced from Google Attendance Sheet |
| mentoring_attended | Synced from Google Attendance Sheet |
| points_assigned | Calculated: (workshops×3) + (mentoring×3) + (standups×1) |

---

## ONGOING — What to do and when

| Trigger | What to do | Where |
|---------|------------|-------|
| New student joins | Add row to CSV, upload | Management → Students |
| New cohort intake starts | SQL already has the cohort/seasons — just import students | Management → Students |
| Student's progress looks wrong | Check GitHub Actions logs for scraper errors | GitHub → Actions |
| Scraper fails | Check SCRAPER_USERNAME/PASSWORD secrets in GitHub | GitHub → Settings → Secrets |
| Attendance not updating | Confirm Google credentials JSON secret is not expired | GitHub → Settings → Secrets |
| Student on wrong cohort | Use Change Status / bulk reassign in the app | Dashboard → click student |
| Student leaves | Click student → Change Status → Inactive | Dashboard → click student |
| Student graduates | Click student → Change Status → Graduated | Dashboard → click student |
| Add a new admin | Settings → Admins → type email → Add | Admin Dashboard |

---

## SCRAPER REQUIREMENTS CHECKLIST

For the scraper to work correctly, each student MUST have:

1. ✅ A row in the `students` table with `account_status = 'Active'`
2. ✅ The `username` column set to their exact Qwasar platform login
3. ✅ A cohort assigned (`cohort_id` not null)
4. ✅ That cohort linked to a season schedule in `program_cohort_seasons`
   covering today's date
5. ✅ GitHub secrets set: `SCRAPER_USERNAME`, `SCRAPER_PASSWORD`,
   `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_ROLE_KEY`,
   `GOOGLE_CREDENTIALS_JSON`, `APP_URL`

If any of these are missing, the student will show "Unknown" status
and their progress will not update.

---

## SEASON SCHEDULE REFERENCE

### AI/ML and Data Science (same dates)
| Season | Order |
|--------|-------|
| Preseason | 1 |
| Season 01 | 2 |
| Season 02 | 3 |
| Season 03 | 4 |
| Final Project | 5 |

### Software Engineering
| Season | Order |
|--------|-------|
| Preseason | 1 |
| Season 01 Arc 01 | 2 |
| Season 01 Arc 02 | 3 |
| Season 02 | 4 |
| Season 03 | 5 |
| Final Project | 6 |

### Valid cohort names for CSV (case-sensitive, must match exactly):
- `Mar 2023`
- `Sep 2023`
- `Mar 2024`
- `Sep 2024`
- `Mar 2025`
- `Sep 2025`
- `Mar 2026`

### Valid programme names for CSV (case-sensitive, must match exactly):
- `Software Engineering`
- `Data Science`
- `AI/ML`
