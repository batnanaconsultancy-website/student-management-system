-- ============================================================
-- Canvas LMS sync tables.
--
-- Backs the new "Canvas" admin page (pages/admin/canvas.vue).
-- An admin picks a Canvas course from a dropdown (fetched live from
-- Canvas, see server/api/admin/canvas/courses.get.js), clicks
-- "Sync Now", and server/api/admin/canvas/sync.post.js pulls the
-- student roster, assignments, and submissions for that course from
-- the Canvas REST API and upserts them here. The dashboard table then
-- reads from these tables (server/api/admin/canvas/submissions.get.js)
-- rather than hitting Canvas on every page load.
--
-- These tables are intentionally NOT linked to the existing `students`
-- table by foreign key: Canvas enrollment and Qwasar/SIS enrollment are
-- two separate systems that may not have 1:1 matching accounts. This
-- keeps Canvas data self-contained in its own canvas_* tables.
-- ============================================================

-- ── canvas_students ─────────────────────────────────────────
-- One row per Canvas user we've ever seen (a Canvas user_id is global
-- across the whole Canvas instance, not scoped to one course, so this
-- table is not per-course -- a student enrolled in several synced
-- courses still gets exactly one row here).
CREATE TABLE IF NOT EXISTS canvas_students (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canvas_user_id  BIGINT NOT NULL UNIQUE,
    name            TEXT,
    email           TEXT,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_canvas_students_email ON canvas_students(email);

-- ── canvas_enrollments ───────────────────────────────────────
-- Which students belong to which synced Canvas course. Populated from
-- Canvas's course roster on every sync, independent of whether a
-- student has submitted anything -- this is what lets the dashboard
-- show a full class list (including students with zero submissions)
-- rather than only students who happen to appear in submissions data.
CREATE TABLE IF NOT EXISTS canvas_enrollments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canvas_course_id  BIGINT NOT NULL,
    canvas_student_id UUID NOT NULL REFERENCES canvas_students(id) ON DELETE CASCADE,
    synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (canvas_course_id, canvas_student_id)
);
CREATE INDEX IF NOT EXISTS idx_canvas_enrollments_course ON canvas_enrollments(canvas_course_id);

-- ── canvas_assignments ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS canvas_assignments (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canvas_course_id      BIGINT NOT NULL,
    canvas_assignment_id  BIGINT NOT NULL,
    name                  TEXT NOT NULL,
    due_at                TIMESTAMPTZ,
    points_possible       NUMERIC,
    synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (canvas_course_id, canvas_assignment_id)
);
CREATE INDEX IF NOT EXISTS idx_canvas_assignments_course ON canvas_assignments(canvas_course_id);

-- ── canvas_submissions ───────────────────────────────────────
-- No student_name/student_email columns here -- those live once in
-- canvas_students and are joined in via canvas_student_id.
CREATE TABLE IF NOT EXISTS canvas_submissions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canvas_course_id      BIGINT NOT NULL,
    canvas_assignment_id  BIGINT NOT NULL,
    canvas_student_id     UUID NOT NULL REFERENCES canvas_students(id) ON DELETE CASCADE,
    submission_type       TEXT,
    submitted_at          TIMESTAMPTZ,
    late                  BOOLEAN NOT NULL DEFAULT FALSE,
    seconds_late          INTEGER NOT NULL DEFAULT 0,
    missing               BOOLEAN NOT NULL DEFAULT FALSE,
    workflow_state        TEXT,
    attempt                INTEGER,
    score                   NUMERIC,
    grade                    TEXT,
    graded_at                 TIMESTAMPTZ,
    excused                    BOOLEAN NOT NULL DEFAULT FALSE,
    preview_url                  TEXT,
    synced_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (canvas_course_id, canvas_assignment_id, canvas_student_id)
);
CREATE INDEX IF NOT EXISTS idx_canvas_submissions_course ON canvas_submissions(canvas_course_id);
CREATE INDEX IF NOT EXISTS idx_canvas_submissions_assignment ON canvas_submissions(canvas_course_id, canvas_assignment_id);
CREATE INDEX IF NOT EXISTS idx_canvas_submissions_student ON canvas_submissions(canvas_student_id);

ALTER TABLE canvas_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "canvas_students: admin full access" ON canvas_students;
CREATE POLICY "canvas_students: admin full access"
    ON canvas_students FOR ALL
    USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "canvas_enrollments: admin full access" ON canvas_enrollments;
CREATE POLICY "canvas_enrollments: admin full access"
    ON canvas_enrollments FOR ALL
    USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "canvas_assignments: admin full access" ON canvas_assignments;
CREATE POLICY "canvas_assignments: admin full access"
    ON canvas_assignments FOR ALL
    USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "canvas_submissions: admin full access" ON canvas_submissions;
CREATE POLICY "canvas_submissions: admin full access"
    ON canvas_submissions FOR ALL
    USING (is_admin()) WITH CHECK (is_admin());

-- Base table-level grants (RLS policies above are the fine-grained gate;
-- these are the coarse on/off switch Postgres also requires -- see
-- migrations/2026-07-19-fix-missing-table-grants.sql for why this matters).
GRANT SELECT, INSERT, UPDATE, DELETE ON canvas_students TO authenticated;
GRANT ALL ON canvas_students TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON canvas_enrollments TO authenticated;
GRANT ALL ON canvas_enrollments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON canvas_assignments TO authenticated;
GRANT ALL ON canvas_assignments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON canvas_submissions TO authenticated;
GRANT ALL ON canvas_submissions TO service_role;
