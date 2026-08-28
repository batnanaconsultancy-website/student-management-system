-- ============================================================
-- Canvas overview extensions.
--
-- Adds what's needed for the cross-course "Student Overview" tab:
--   - a manual cohort/program label per student email (Canvas doesn't
--     know your SIS's own cohort naming, so this is a small lookup you
--     maintain by hand, seeded below with the roster you provided)
--   - a lightweight cache of course names (so the overview page can
--     show "Data Science, AI & Leadership 2025" without a live Canvas
--     call, for every course a student has ever been synced into, not
--     just the one currently selected in the dropdown)
--   - outcome -> assignment alignment (which assignments count toward
--     which learning outcome), derived at sync time from Canvas's
--     outcome_results endpoint
--   - attendance imported from an external Google Sheet
-- ============================================================

-- ── canvas_student_labels ────────────────────────────────────
-- Manual email -> program/cohort mapping. Not derived from Canvas or
-- from your `students` table -- Canvas has no concept of your SIS's
-- cohort naming, so this is maintained by hand (see the seed data
-- below). Looked up by email when building the overview.
CREATE TABLE IF NOT EXISTS canvas_student_labels (
    email        TEXT PRIMARY KEY,
    program      TEXT NOT NULL,
    cohort_label TEXT NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── canvas_courses ───────────────────────────────────────────
-- Just enough to label a course by id without a live Canvas call --
-- populated every time a course is synced ("Sync Now" on the Canvas
-- page). Needed because the new overview shows every course a student
-- has ever been synced into, not just the currently-selected one.
CREATE TABLE IF NOT EXISTS canvas_courses (
    canvas_course_id BIGINT PRIMARY KEY,
    name             TEXT NOT NULL,
    course_code      TEXT,
    synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── canvas_outcome_alignments ────────────────────────────────
-- Which assignments count toward which learning outcome, per course.
-- Canvas doesn't expose this as a simple flat list -- it's derived at
-- sync time from the outcome_results endpoint's alignment data (see
-- server/utils/canvasApi.js: listOutcomeAlignments). A given
-- assignment can align to more than one outcome, and an outcome can
-- have zero, one, or several aligned assignments.
CREATE TABLE IF NOT EXISTS canvas_outcome_alignments (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canvas_course_id      BIGINT NOT NULL,
    canvas_outcome_id     BIGINT NOT NULL,
    canvas_assignment_id  BIGINT NOT NULL,
    synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (canvas_course_id, canvas_outcome_id, canvas_assignment_id)
);
CREATE INDEX IF NOT EXISTS idx_canvas_outcome_alignments_course
    ON canvas_outcome_alignments(canvas_course_id);
CREATE INDEX IF NOT EXISTS idx_canvas_outcome_alignments_outcome
    ON canvas_outcome_alignments(canvas_course_id, canvas_outcome_id);

-- ── canvas_sheet_attendance ──────────────────────────────────
-- Attendance imported from an external Google Sheet of raw Zoom/Meet
-- attendance logs (one row per meeting per attendee, with a `File ID`
-- uniquely identifying each meeting). See
-- server/api/admin/canvas/attendance-sync.post.js -- it aggregates
-- the raw log into, per student: how many distinct meetings they were
-- in, and their total minutes across all of them. The percentage shown
-- on the overview page (relative to the top attendee in the same
-- cohort) is computed at read time, not stored here, so it stays
-- correct as the student roster/cohort labels change without needing
-- a re-sync.
CREATE TABLE IF NOT EXISTS canvas_sheet_attendance (
    email                   TEXT PRIMARY KEY,
    first_name              TEXT,
    last_name               TEXT,
    meetings_attended       INTEGER NOT NULL DEFAULT 0,
    total_duration_minutes  NUMERIC NOT NULL DEFAULT 0,
    synced_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE canvas_student_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_outcome_alignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_sheet_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "canvas_student_labels: admin full access" ON canvas_student_labels;
CREATE POLICY "canvas_student_labels: admin full access"
    ON canvas_student_labels FOR ALL
    USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "canvas_courses: admin full access" ON canvas_courses;
CREATE POLICY "canvas_courses: admin full access"
    ON canvas_courses FOR ALL
    USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "canvas_outcome_alignments: admin full access" ON canvas_outcome_alignments;
CREATE POLICY "canvas_outcome_alignments: admin full access"
    ON canvas_outcome_alignments FOR ALL
    USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "canvas_sheet_attendance: admin full access" ON canvas_sheet_attendance;
CREATE POLICY "canvas_sheet_attendance: admin full access"
    ON canvas_sheet_attendance FOR ALL
    USING (is_admin()) WITH CHECK (is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON canvas_student_labels TO authenticated;
GRANT ALL ON canvas_student_labels TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON canvas_courses TO authenticated;
GRANT ALL ON canvas_courses TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON canvas_outcome_alignments TO authenticated;
GRANT ALL ON canvas_outcome_alignments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON canvas_sheet_attendance TO authenticated;
GRANT ALL ON canvas_sheet_attendance TO service_role;

-- ── Seed: the Masters student roster you provided ───────────
-- Safe to re-run -- upserts on email, so editing this list and
-- re-running just updates labels rather than duplicating rows.
INSERT INTO canvas_student_labels (email, program, cohort_label) VALUES
    ('iris.santos@amsterdam.tech',        'Data Science', 'Nov2025'),
    ('gibris.fuseini@amsterdam.tech',     'Data Science', 'Nov2025'),
    ('muhammad.qudaimy@amsterdam.tech',   'Data Science', 'Nov2025'),
    ('antonio.massih@amsterdam.tech',     'Data Science', 'Nov2025'),
    ('aris.kasapian@amsterdam.tech',      'Data Science', 'Nov2025'),
    ('georgia.nerantzaki@amsterdam.tech', 'Data Science', 'Nov2025'),
    ('mark.willems@amsterdam.tech',       'Data Science', 'Nov2025'),
    ('ryan.wehner@amsterdam.tech',        'Data Science', 'Nov2025'),

    ('mariam.elwetery@amsterdam.tech',    'Tech MBA', 'Nov2025'),
    ('emine.ayaz@amsterdam.tech',         'Tech MBA', 'Nov2025'),
    ('younis.ahmed@amsterdam.tech',       'Tech MBA', 'Nov2025'),
    ('diyaa.shridi@amsterdam.tech',       'Tech MBA', 'Nov2025'),
    ('kaan.senli@amsterdam.tech',         'Tech MBA', 'Nov2025'),
    ('richard.kwakwa@amsterdam.tech',     'Tech MBA', 'Nov2025'),

    ('onur.gungor@amsterdam.tech',        'Tech MBA', 'Nov2024'),
    ('cagla.bastug@amsterdam.tech',       'Tech MBA', 'Nov2024'),
    ('adrian.sanchez@amsterdam.tech',     'Tech MBA', 'Nov2024'),
    ('bekir.bozturk@amsterdam.tech',      'Tech MBA', 'Nov2024'),
    ('karina.khachaturian@amsterdam.tech','Tech MBA', 'Nov2024'),
    ('rabindra.phuyal@amsterdam.tech',    'Tech MBA', 'Nov2024'),
    ('bui.tuan@amsterdam.tech',           'Tech MBA', 'Nov2024'),
    ('erhan.altintas@amsterdam.tech',     'Tech MBA', 'Nov2024'),
    ('ismail.aydemir@amsterdam.tech',     'Tech MBA', 'Nov2024'),
    ('samet.bayraktar@amsterdam.tech',    'Tech MBA', 'Nov2024')
ON CONFLICT (email) DO UPDATE SET
    program = EXCLUDED.program,
    cohort_label = EXCLUDED.cohort_label,
    updated_at = NOW();
