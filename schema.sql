-- ============================================================
-- STUDENT MANAGEMENT SYSTEM — COMPLETE SUPABASE SCHEMA
-- Amsterdam Tech / AIT
--
-- HOW TO RUN:
--   1. Create a new Supabase project at https://supabase.com
--   2. Go to SQL Editor in your project dashboard
--   3. Paste this entire file and click "Run"
--   4. Update your .env with the new project's URL + keys
--
-- ORDER OF SECTIONS:
--   0. Extensions
--   1. Core lookup tables  (programs, cohorts, seasons, projects)
--   2. Junction tables     (program_cohort_seasons, program_cohort_season_projects,
--                           cohort_meetings, meeting_types, cohort_meeting_stats)
--   3. User tables         (admin, students)
--   4. Progress tables     (student_season_progress, student_project_completion,
--                           progress_snapshots)
--   5. Settings table      (notification_settings)
--   6. Indexes
--   7. Updated-at triggers
--   8. RPC function        (update_student_status_based_on_season_progress)
--   9. Row-Level Security  (enable + policies for every table)
--  10. Seed data           (programs, meeting_types)
-- ============================================================


-- ============================================================
-- 0. EXTENSIONS
-- ============================================================

-- uuid_generate_v4() — used for all primary keys
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- pgcrypto — available as backup uuid source
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ============================================================
-- 1. CORE LOOKUP TABLES
-- ============================================================

-- ── programs ─────────────────────────────────────────────────
-- e.g. "Software Engineering", "Data Science", "AI/ML"
CREATE TABLE IF NOT EXISTS programs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── cohorts ──────────────────────────────────────────────────
-- A cohort is a named intake group (e.g. "Sep 22").
-- Multiple programs can share the same cohort name, each as a
-- separate row (one row per program×cohort combination).
CREATE TABLE IF NOT EXISTS cohorts (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL,
    program_id  UUID NOT NULL REFERENCES programs(id) ON DELETE RESTRICT,
    start_date  DATE,
    end_date    DATE,
    meeting_id  TEXT,          -- external meeting/zoom link reference
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (name, program_id)  -- same cohort name can exist per program
);

-- ── seasons ───────────────────────────────────────────────────
-- Curriculum seasons / tracks within a program.
-- e.g. "Season 01", "Season 02", "Final Project"
CREATE TABLE IF NOT EXISTS seasons (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name             TEXT NOT NULL,
    program_id       UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    order_in_program INTEGER NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (name, program_id)
);

-- ── projects ──────────────────────────────────────────────────
-- Individual projects that belong to a season within a program.
CREATE TABLE IF NOT EXISTS projects (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name         TEXT NOT NULL,
    description  TEXT,
    duration_days INTEGER,
    program_id   UUID REFERENCES programs(id) ON DELETE CASCADE,
    season_id    UUID REFERENCES seasons(id) ON DELETE SET NULL,
    "order"      INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 2. JUNCTION / SCHEDULING TABLES
-- ============================================================

-- ── program_cohort_seasons ────────────────────────────────────
-- Ties a specific season to a specific cohort+program pairing,
-- with concrete start/end dates for that cohort's schedule.
CREATE TABLE IF NOT EXISTS program_cohort_seasons (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    program_id  UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    cohort_id   UUID NOT NULL REFERENCES cohorts(id)  ON DELETE CASCADE,
    season_id   UUID NOT NULL REFERENCES seasons(id)  ON DELETE CASCADE,
    start_date  DATE NOT NULL,
    end_date    DATE NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (program_id, cohort_id, season_id)
);

-- ── program_cohort_season_projects ────────────────────────────
-- Schedules a project into a specific program_cohort_season slot,
-- with that cohort's concrete project start/end dates.
-- Used by the Timeline page.
CREATE TABLE IF NOT EXISTS program_cohort_season_projects (
    id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    program_cohort_season_id UUID NOT NULL REFERENCES program_cohort_seasons(id) ON DELETE CASCADE,
    project_id               UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    start_date               DATE,
    end_date                 DATE,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (program_cohort_season_id, project_id)
);

-- ── meeting_types ─────────────────────────────────────────────
-- Defines recurring session types and how often they occur per week.
-- Used to calculate expected attendance totals.
CREATE TABLE IF NOT EXISTS meeting_types (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name              TEXT NOT NULL UNIQUE,   -- 'workshop', 'standup', 'mentoring'
    frequency_per_week INTEGER NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── cohort_meetings ───────────────────────────────────────────
-- How many weeks a given cohort runs a particular meeting type.
-- Expected total = weeks × frequency_per_week (from meeting_types).
CREATE TABLE IF NOT EXISTS cohort_meetings (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cohort_id    UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
    meeting_type TEXT NOT NULL,   -- 'workshop' | 'standup' | 'mentoring'
    weeks        INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (cohort_id, meeting_type)
);

-- ── cohort_meeting_stats ──────────────────────────────────────
-- Actual recorded meeting counts per cohort per meeting type.
-- Used to compute attendance rates in the admin analytics pages.
CREATE TABLE IF NOT EXISTS cohort_meeting_stats (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cohort_id      UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
    meeting_type   TEXT NOT NULL,   -- 'workshop' | 'standup' | 'mentoring'
    total_meetings INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (cohort_id, meeting_type)
);


-- ============================================================
-- 3. USER TABLES
-- ============================================================

-- ── admin ─────────────────────────────────────────────────────
-- Simple email allowlist.  When a logged-in user's email matches
-- a row here, useAuth.ts grants them the 'admin' role.
-- Supabase Auth (Google OAuth) handles all actual authentication;
-- this table only controls role elevation.
CREATE TABLE IF NOT EXISTS admin (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email      TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── students ──────────────────────────────────────────────────
-- Central student record.  Linked to Supabase Auth via email.
CREATE TABLE IF NOT EXISTS students (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Identity
    username             TEXT UNIQUE,          -- Qwasar platform username
    email                TEXT NOT NULL UNIQUE,
    first_name           TEXT NOT NULL,
    last_name            TEXT NOT NULL,
    img_url              TEXT,                  -- profile photo from Qwasar scrape

    -- Enrolment
    role                 TEXT NOT NULL DEFAULT 'student',
    program_id           UUID REFERENCES programs(id) ON DELETE RESTRICT,
    cohort_id            UUID REFERENCES cohorts(id)  ON DELETE RESTRICT,

    -- Account state
    --   account_status: 'Active' | 'Inactive' | 'Frozen' | 'Graduated'
    account_status       TEXT NOT NULL DEFAULT 'Active',
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,

    -- Progress status (set by RPC function)
    --   status: 'On Track' | 'At Risk' | 'Monitor' | 'Ahead' | 'Unknown'
    status               TEXT,

    -- Current vs expected season (FK set by student_management.py)
    current_season_id    UUID,
    expected_season_id   UUID,

    -- Scraped / synced metrics (updated by data_processor.py)
    points               INTEGER NOT NULL DEFAULT 0,
    exercises_completed  INTEGER NOT NULL DEFAULT 0,
    last_login           TIMESTAMPTZ,

    -- Attendance counters (updated by update_attendance.py from Google Sheets)
    workshops_attended   INTEGER NOT NULL DEFAULT 0,
    standup_attended     INTEGER NOT NULL DEFAULT 0,
    mentoring_attended   INTEGER NOT NULL DEFAULT 0,

    -- Computed attendance score (set by update_points_assigned.py)
    points_assigned      INTEGER NOT NULL DEFAULT 0,

    -- Slack integration (set by update_slack_ids.js)
    slack_id             TEXT,

    -- Timestamps
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Named FK aliases used by the Nuxt .select() relational queries:
    --   students_current_season_id_fkey
    --   students_expected_season_id_fkey
    CONSTRAINT students_current_season_id_fkey
        FOREIGN KEY (current_season_id) REFERENCES seasons(id) ON DELETE SET NULL,
    CONSTRAINT students_expected_season_id_fkey
        FOREIGN KEY (expected_season_id) REFERENCES seasons(id) ON DELETE SET NULL
);


-- ============================================================
-- 4. PROGRESS TABLES
-- ============================================================

-- ── student_season_progress ───────────────────────────────────
-- One row per student × season.  Tracks how far through each
-- curriculum season a student has progressed (scraped from Qwasar).
CREATE TABLE IF NOT EXISTS student_season_progress (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id          UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    season_id           UUID NOT NULL REFERENCES seasons(id)  ON DELETE CASCADE,
    progress_percentage NUMERIC(5,2) NOT NULL DEFAULT 0.00,  -- 0.00 – 100.00
    is_completed        BOOLEAN NOT NULL DEFAULT FALSE,
    completion_date     DATE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (student_id, season_id)
);

-- ── student_project_completion ────────────────────────────────
-- One row per student × project.  Tracks per-project status.
CREATE TABLE IF NOT EXISTS student_project_completion (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id   UUID NOT NULL REFERENCES students(id)  ON DELETE CASCADE,
    project_id   UUID NOT NULL REFERENCES projects(id)  ON DELETE CASCADE,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    grade        NUMERIC(5,2),
    completed_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (student_id, project_id)
);

-- ── progress_snapshots ────────────────────────────────────────
-- Weekly analytics snapshot created by analytics.py.
-- Stores aggregate student status counts at a point in time.
CREATE TABLE IF NOT EXISTS progress_snapshots (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    snapshot_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_students INTEGER NOT NULL DEFAULT 0,
    on_track       INTEGER NOT NULL DEFAULT 0,
    at_risk        INTEGER NOT NULL DEFAULT 0,
    monitor        INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 5. SETTINGS TABLE
-- ============================================================

-- ── notification_settings ────────────────────────────────────
-- Single-row admin config for email/Slack alert preferences.
-- The app reads/writes this via useNotificationSettings.ts.
CREATE TABLE IF NOT EXISTS notification_settings (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
    slack_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
    email_recipients    TEXT[]  NOT NULL DEFAULT '{}',   -- array of email strings
    slack_webhook_url   TEXT    NOT NULL DEFAULT '',
    notify_on_at_risk   BOOLEAN NOT NULL DEFAULT TRUE,
    notify_on_monitor   BOOLEAN NOT NULL DEFAULT TRUE,
    notification_time   TIME    NOT NULL DEFAULT '09:00',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 6. INDEXES
-- ============================================================

-- students
CREATE INDEX IF NOT EXISTS idx_students_email            ON students(email);
CREATE INDEX IF NOT EXISTS idx_students_cohort_id        ON students(cohort_id);
CREATE INDEX IF NOT EXISTS idx_students_program_id       ON students(program_id);
CREATE INDEX IF NOT EXISTS idx_students_status           ON students(status);
CREATE INDEX IF NOT EXISTS idx_students_account_status   ON students(account_status);
CREATE INDEX IF NOT EXISTS idx_students_current_season   ON students(current_season_id);
CREATE INDEX IF NOT EXISTS idx_students_expected_season  ON students(expected_season_id);
CREATE INDEX IF NOT EXISTS idx_students_username         ON students(username);

-- seasons
CREATE INDEX IF NOT EXISTS idx_seasons_program_id        ON seasons(program_id);
CREATE INDEX IF NOT EXISTS idx_seasons_order             ON seasons(program_id, order_in_program);

-- projects
CREATE INDEX IF NOT EXISTS idx_projects_program_id       ON projects(program_id);
CREATE INDEX IF NOT EXISTS idx_projects_season_id        ON projects(season_id);

-- program_cohort_seasons
CREATE INDEX IF NOT EXISTS idx_pcs_program_id            ON program_cohort_seasons(program_id);
CREATE INDEX IF NOT EXISTS idx_pcs_cohort_id             ON program_cohort_seasons(cohort_id);
CREATE INDEX IF NOT EXISTS idx_pcs_season_id             ON program_cohort_seasons(season_id);
CREATE INDEX IF NOT EXISTS idx_pcs_dates                 ON program_cohort_seasons(start_date, end_date);

-- program_cohort_season_projects
CREATE INDEX IF NOT EXISTS idx_pcsp_pcs_id               ON program_cohort_season_projects(program_cohort_season_id);
CREATE INDEX IF NOT EXISTS idx_pcsp_project_id           ON program_cohort_season_projects(project_id);

-- student_season_progress
CREATE INDEX IF NOT EXISTS idx_ssp_student_id            ON student_season_progress(student_id);
CREATE INDEX IF NOT EXISTS idx_ssp_season_id             ON student_season_progress(season_id);

-- student_project_completion
CREATE INDEX IF NOT EXISTS idx_spc_student_id            ON student_project_completion(student_id);
CREATE INDEX IF NOT EXISTS idx_spc_project_id            ON student_project_completion(project_id);
CREATE INDEX IF NOT EXISTS idx_spc_is_completed          ON student_project_completion(is_completed);

-- cohort_meetings / stats
CREATE INDEX IF NOT EXISTS idx_cohort_meetings_cohort    ON cohort_meetings(cohort_id);
CREATE INDEX IF NOT EXISTS idx_cohort_stats_cohort       ON cohort_meeting_stats(cohort_id);

-- progress_snapshots
CREATE INDEX IF NOT EXISTS idx_snapshots_date            ON progress_snapshots(snapshot_date DESC);

-- admin
CREATE INDEX IF NOT EXISTS idx_admin_email               ON admin(email);


-- ============================================================
-- 7. UPDATED-AT TRIGGERS
-- ============================================================

-- Shared trigger function: sets updated_at = NOW() on every UPDATE.
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to every table that has an updated_at column.
CREATE TRIGGER set_updated_at_students
    BEFORE UPDATE ON students
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_student_season_progress
    BEFORE UPDATE ON student_season_progress
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_student_project_completion
    BEFORE UPDATE ON student_project_completion
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_cohort_meeting_stats
    BEFORE UPDATE ON cohort_meeting_stats
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_notification_settings
    BEFORE UPDATE ON notification_settings
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ============================================================
-- 8. RPC FUNCTION
--    update_student_status_based_on_season_progress()
--
--    Called by:
--      • student_management.py  via  supabase.rpc('update_student_status_based_on_season_progress')
--
--    Logic:
--      For every student that has both current_season_id and
--      expected_season_id set, compare where they ARE vs where
--      they SHOULD BE, then assign one of:
--
--        'On Track'  — current_season = expected_season AND
--                      progress ≥ 60 %
--        'At Risk'   — current_season < expected_season  OR
--                      (current = expected AND progress < 40 %)
--        'Monitor'   — current_season = expected_season AND
--                      40 % ≤ progress < 60 %
--        'Ahead'     — current_season > expected_season
--        'Unknown'   — insufficient data to determine
-- ============================================================

CREATE OR REPLACE FUNCTION update_student_status_based_on_season_progress()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER   -- runs with the privileges of the function owner (service role)
AS $$
DECLARE
    v_student           RECORD;
    v_current_order     INTEGER;
    v_expected_order    INTEGER;
    v_progress          NUMERIC;
    v_new_status        TEXT;
BEGIN
    -- Iterate over every student that has season assignments
    FOR v_student IN
        SELECT
            s.id,
            s.current_season_id,
            s.expected_season_id
        FROM students s
        WHERE s.current_season_id  IS NOT NULL
          AND s.expected_season_id IS NOT NULL
    LOOP
        -- Get the ordering position of current season
        SELECT order_in_program
        INTO v_current_order
        FROM seasons
        WHERE id = v_student.current_season_id;

        -- Get the ordering position of expected season
        SELECT order_in_program
        INTO v_expected_order
        FROM seasons
        WHERE id = v_student.expected_season_id;

        -- Get the student's actual progress % in their EXPECTED season
        -- (if no row exists, default to 0)
        SELECT COALESCE(progress_percentage, 0)
        INTO v_progress
        FROM student_season_progress
        WHERE student_id = v_student.id
          AND season_id  = v_student.expected_season_id
        LIMIT 1;

        -- If still null (no row at all), check current season progress
        IF v_progress IS NULL THEN
            SELECT COALESCE(progress_percentage, 0)
            INTO v_progress
            FROM student_season_progress
            WHERE student_id = v_student.id
              AND season_id  = v_student.current_season_id
            LIMIT 1;
        END IF;

        IF v_progress IS NULL THEN
            v_progress := 0;
        END IF;

        -- Determine status
        IF v_current_order IS NULL OR v_expected_order IS NULL THEN
            v_new_status := 'Unknown';

        ELSIF v_current_order > v_expected_order THEN
            -- Student is ahead of their expected season
            v_new_status := 'Ahead';

        ELSIF v_current_order = v_expected_order THEN
            -- Student is in the right season — judge by progress
            IF v_progress >= 60 THEN
                v_new_status := 'On Track';
            ELSIF v_progress >= 40 THEN
                v_new_status := 'Monitor';
            ELSE
                v_new_status := 'At Risk';
            END IF;

        ELSE
            -- Student is behind their expected season
            -- Additional nuance: if they are > 75 % in current season,
            -- they are monitoring; otherwise fully at risk.
            IF v_progress > 75 THEN
                v_new_status := 'Monitor';
            ELSE
                v_new_status := 'At Risk';
            END IF;
        END IF;

        -- Persist new status
        UPDATE students
        SET    status     = v_new_status,
               updated_at = NOW()
        WHERE  id = v_student.id;

    END LOOP;

    -- Students with no season data stay as-is (keep NULL / previous value).
    -- Optionally mark them Unknown:
    UPDATE students
    SET    status     = 'Unknown',
           updated_at = NOW()
    WHERE  (current_season_id IS NULL OR expected_season_id IS NULL)
      AND  (status IS NULL OR status NOT IN ('On Track','At Risk','Monitor','Ahead','Unknown'));

END;
$$;


-- ============================================================
-- 9. ROW-LEVEL SECURITY
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE programs                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cohorts                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasons                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_cohort_seasons        ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_cohort_season_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_types                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE cohort_meetings               ENABLE ROW LEVEL SECURITY;
ALTER TABLE cohort_meeting_stats          ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE students                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_season_progress       ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_project_completion    ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_snapshots            ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_settings         ENABLE ROW LEVEL SECURITY;

-- ── Helper: is the caller an admin? ───────────────────────────
-- Checks if the authenticated user's email appears in the admin
-- table.  Used by policies below to gate admin-only access.
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM   admin
        WHERE  email = auth.email()
    );
$$;

-- ── Helper: authenticated user's student id ───────────────────
CREATE OR REPLACE FUNCTION my_student_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT id
    FROM   students
    WHERE  email = auth.email()
    LIMIT  1;
$$;


-- ── programs ─────────────────────────────────────────────────
-- Everyone authenticated can read; only admins can write.
CREATE POLICY "programs: anyone authenticated can read"
    ON programs FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "programs: admin full access"
    ON programs FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

-- ── cohorts ──────────────────────────────────────────────────
CREATE POLICY "cohorts: anyone authenticated can read"
    ON cohorts FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "cohorts: admin full access"
    ON cohorts FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

-- ── seasons ───────────────────────────────────────────────────
CREATE POLICY "seasons: anyone authenticated can read"
    ON seasons FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "seasons: admin full access"
    ON seasons FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

-- ── projects ──────────────────────────────────────────────────
CREATE POLICY "projects: anyone authenticated can read"
    ON projects FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "projects: admin full access"
    ON projects FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

-- ── program_cohort_seasons ────────────────────────────────────
CREATE POLICY "pcs: anyone authenticated can read"
    ON program_cohort_seasons FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "pcs: admin full access"
    ON program_cohort_seasons FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

-- ── program_cohort_season_projects ────────────────────────────
CREATE POLICY "pcsp: anyone authenticated can read"
    ON program_cohort_season_projects FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "pcsp: admin full access"
    ON program_cohort_season_projects FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

-- ── meeting_types ─────────────────────────────────────────────
CREATE POLICY "meeting_types: anyone authenticated can read"
    ON meeting_types FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "meeting_types: admin full access"
    ON meeting_types FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

-- ── cohort_meetings ───────────────────────────────────────────
CREATE POLICY "cohort_meetings: anyone authenticated can read"
    ON cohort_meetings FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "cohort_meetings: admin full access"
    ON cohort_meetings FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

-- ── cohort_meeting_stats ──────────────────────────────────────
CREATE POLICY "cohort_meeting_stats: anyone authenticated can read"
    ON cohort_meeting_stats FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "cohort_meeting_stats: admin full access"
    ON cohort_meeting_stats FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

-- ── admin ─────────────────────────────────────────────────────
-- Admins can read the whole table (to manage other admins).
-- Students never see it (but useAuth.ts uses service-role via
-- Supabase module to check — see note in SETUP section).
-- The service-role key bypasses RLS entirely, which is correct.
CREATE POLICY "admin: admin can read all"
    ON admin FOR SELECT
    USING (is_admin());

CREATE POLICY "admin: admin can write"
    ON admin FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

-- Allow any authenticated user to SELECT their own email from admin
-- (needed so useAuth.ts can call .from('admin').select('email').eq('email', user.email))
CREATE POLICY "admin: authenticated user can check own email"
    ON admin FOR SELECT
    USING (email = auth.email());

-- ── students ──────────────────────────────────────────────────
-- Admins see everyone. Students see only themselves.
CREATE POLICY "students: admin full access"
    ON students FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

CREATE POLICY "students: student reads own row"
    ON students FOR SELECT
    USING (email = auth.email());

CREATE POLICY "students: student updates own row"
    ON students FOR UPDATE
    USING (email = auth.email())
    WITH CHECK (email = auth.email());

-- ── student_season_progress ───────────────────────────────────
CREATE POLICY "ssp: admin full access"
    ON student_season_progress FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

CREATE POLICY "ssp: student reads own progress"
    ON student_season_progress FOR SELECT
    USING (student_id = my_student_id());

-- ── student_project_completion ────────────────────────────────
CREATE POLICY "spc: admin full access"
    ON student_project_completion FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

CREATE POLICY "spc: student reads own completions"
    ON student_project_completion FOR SELECT
    USING (student_id = my_student_id());

-- ── progress_snapshots ────────────────────────────────────────
-- Admins manage; students read (for potential dashboard use).
CREATE POLICY "snapshots: admin full access"
    ON progress_snapshots FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

CREATE POLICY "snapshots: students can read"
    ON progress_snapshots FOR SELECT
    USING (auth.role() = 'authenticated');

-- ── notification_settings ────────────────────────────────────
-- Admin-only: students never need to see this.
CREATE POLICY "notifications: admin only"
    ON notification_settings FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());


-- ============================================================
-- 10. SEED DATA
-- ============================================================

-- ── Programs ─────────────────────────────────────────────────
INSERT INTO programs (name, description) VALUES
    ('Software Engineering', 'Full-stack software engineering programme'),
    ('Data Science',         'Data science and analytics programme'),
    ('AI/ML',                'Artificial intelligence and machine learning programme')
ON CONFLICT (name) DO NOTHING;

-- ── Meeting types ─────────────────────────────────────────────
-- frequency_per_week: how many sessions per week per cohort.
-- Workshop = 1/week, Standup = 5/week (daily), Mentoring = 1/week
INSERT INTO meeting_types (name, frequency_per_week) VALUES
    ('workshop',  1),
    ('standup',   5),
    ('mentoring', 1)
ON CONFLICT (name) DO NOTHING;


-- ============================================================
-- SETUP CHECKLIST (do these AFTER running this SQL)
-- ============================================================
--
-- 1. ENABLE GOOGLE AUTH IN SUPABASE
--    Dashboard → Authentication → Providers → Google
--    Add your Google OAuth Client ID and Secret.
--    Set Redirect URL to:  https://<your-supabase-project>.supabase.co/auth/v1/callback
--    Also add your local dev URL: http://localhost:3000/auth/confirm
--
-- 2. UPDATE YOUR .env FILE
--    SUPABASE_URL=https://<your-project-ref>.supabase.co
--    SUPABASE_KEY=<anon/public key>          ← from Project Settings → API
--    SUPABASE_ROLE_KEY=<service_role key>    ← same page, keep SECRET
--
-- 3. ADD YOUR FIRST ADMIN
--    In Supabase SQL Editor, run:
--      INSERT INTO admin (email) VALUES ('your-email@example.com');
--    This must match the Google account you'll log in with.
--
-- 4. VERIFY RLS IS WORKING
--    In the Table Editor, switch from "service_role" to "anon"
--    in the top-right role dropdown and confirm students can't
--    see each other's rows.
--
-- 5. PYTHON SCRIPTS
--    The scripts/utils.py uses SUPABASE_ROLE_KEY (service role)
--    which bypasses RLS — correct for the data pipeline.
--    No changes needed there as long as .env is updated.
--
-- ============================================================