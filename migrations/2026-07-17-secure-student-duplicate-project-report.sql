-- ============================================================
-- Fixes a Supabase security linter warning: a policy existed on
-- public.student_duplicate_project_report, but RLS itself was
-- never enabled on the table -- so the policy had zero effect,
-- and the table was readable/writable by anyone with the anon
-- key (RLS off = no row-level restriction at all, policy or not).
--
-- This table isn't in schema.sql -- it was created outside the
-- tracked schema (data_processor.py writes to it directly, see
-- scripts/data_processor.py around safe_upsert(... 'student_duplicate_project_report' ...)).
-- Adding it here now so it's no longer undocumented.
-- ============================================================

CREATE TABLE IF NOT EXISTS student_duplicate_project_report (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id                  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    student_username            TEXT,
    student_email               TEXT,
    student_first_name          TEXT,
    student_last_name           TEXT,
    season_id                   UUID REFERENCES seasons(id) ON DELETE CASCADE,
    season_name                 TEXT,
    kept_raw_label               TEXT,
    kept_progress_percentage     NUMERIC,
    discarded_raw_label          TEXT,
    discarded_progress_percentage NUMERIC,
    scraped_at                   TIMESTAMPTZ,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (student_id, season_id, discarded_raw_label)
);

-- The actual fix: this is the step that was missing.
ALTER TABLE student_duplicate_project_report ENABLE ROW LEVEL SECURITY;

-- Replace whatever narrower ad-hoc policy existed with the standard
-- "admin full access" pattern used for every other admin-only
-- reporting table in this schema (snapshots, notifications, etc.).
DROP POLICY IF EXISTS "Admins can read duplicate reports" ON student_duplicate_project_report;

CREATE POLICY "student_duplicate_project_report: admin full access"
    ON student_duplicate_project_report FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

-- server/api/student/duplicate-tracks.get.js lets a logged-in student
-- see their own duplicate-track rows, querying with the student's own
-- session (not the service-role key) -- it depends on RLS explicitly
-- allowing that, same pattern as "ssp: student reads own progress" on
-- student_season_progress. Without this, enabling RLS above would have
-- silently broken that endpoint for every student.
CREATE POLICY "student_duplicate_project_report: student reads own"
    ON student_duplicate_project_report FOR SELECT
    USING (student_id = my_student_id());
