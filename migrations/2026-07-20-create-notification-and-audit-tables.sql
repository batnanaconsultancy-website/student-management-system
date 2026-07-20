-- ============================================================
-- Creates the tables backing the notification and audit-log
-- pipeline. The server code for all of this already existed --
-- these tables simply never did, so every insert/select against
-- them has been failing (silently in most cases, since these
-- code paths wrap failures in try/catch and log rather than
-- surface them to a user).
-- ============================================================

-- ── audit_log ────────────────────────────────────────────────
-- (Same definition as the standalone add-audit-log-table.sql at the
-- project root -- consolidated here so all of today's fixes run
-- together. Safe to run even if that file was already run once.)
CREATE TABLE IF NOT EXISTS audit_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_email  TEXT NOT NULL,
    action       TEXT NOT NULL,
    entity_type  TEXT,
    entity_id    TEXT,
    details      JSONB,
    ip_address   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_admin   ON audit_log(admin_email);
CREATE INDEX IF NOT EXISTS idx_audit_log_action  ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_log: admin read" ON audit_log;
CREATE POLICY "audit_log: admin read" ON audit_log
    FOR SELECT USING (is_admin());
DROP POLICY IF EXISTS "audit_log: authenticated insert" ON audit_log;
CREATE POLICY "audit_log: authenticated insert" ON audit_log
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');
GRANT SELECT, INSERT ON audit_log TO authenticated;
GRANT ALL ON audit_log TO service_role;


-- ── student_notifications ───────────────────────────────────
-- In-app notification inbox for students (server/api/student/notifications.get.js).
-- Populated today only by server/api/notifications/meeting-reminders.post.js
-- (the daily "meeting today" reminder).
CREATE TABLE IF NOT EXISTS student_notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    body        TEXT,
    type        TEXT NOT NULL DEFAULT 'info',
    is_read     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_student_notifications_student_id ON student_notifications(student_id);
CREATE INDEX IF NOT EXISTS idx_student_notifications_created_at ON student_notifications(created_at DESC);
ALTER TABLE student_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "student_notifications: admin full access"
    ON student_notifications FOR ALL
    USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "student_notifications: student reads own"
    ON student_notifications FOR SELECT
    USING (student_id = my_student_id());
CREATE POLICY "student_notifications: student updates own (mark read)"
    ON student_notifications FOR UPDATE
    USING (student_id = my_student_id())
    WITH CHECK (student_id = my_student_id());
GRANT SELECT, UPDATE ON student_notifications TO authenticated;
GRANT ALL ON student_notifications TO service_role;


-- ── scheduled_meeting_notifications ─────────────────────────
-- Dedup log so the daily meeting-reminders cron doesn't notify the
-- same student twice for the same day's occurrence of a meeting.
CREATE TABLE IF NOT EXISTS scheduled_meeting_notifications (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id       UUID NOT NULL REFERENCES scheduled_meetings(id) ON DELETE CASCADE,
    student_id       UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    occurrence_date  DATE NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (meeting_id, student_id, occurrence_date)
);
CREATE INDEX IF NOT EXISTS idx_smn_meeting_occurrence ON scheduled_meeting_notifications(meeting_id, occurrence_date);
ALTER TABLE scheduled_meeting_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scheduled_meeting_notifications: admin full access"
    ON scheduled_meeting_notifications FOR ALL
    USING (is_admin()) WITH CHECK (is_admin());
-- Only the cron job (service_role) ever writes here -- no student/admin
-- app code reads or writes it directly, so no authenticated grant needed.
GRANT ALL ON scheduled_meeting_notifications TO service_role;


-- ── admin_notifications ──────────────────────────────────────
-- In-app notification inbox for admins (server/api/admin/notifications.get.js).
-- Populated by server/api/notifications/monitor-status.post.js (status
-- change alerts) and server/api/student/report-issue.post.js (student
-- issue reports).
CREATE TABLE IF NOT EXISTS admin_notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_email TEXT NOT NULL,
    type        TEXT NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT,
    entity_type TEXT,
    entity_id   TEXT,
    is_read     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_admin_email ON admin_notifications(admin_email);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_created_at ON admin_notifications(created_at DESC);
ALTER TABLE admin_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_notifications: admin full access"
    ON admin_notifications FOR ALL
    USING (is_admin()) WITH CHECK (is_admin());
GRANT SELECT, INSERT, UPDATE ON admin_notifications TO authenticated;
GRANT ALL ON admin_notifications TO service_role;


-- ── status_change_log ────────────────────────────────────────
-- Historical record of every student status transition (On Track /
-- At Risk / Monitor / Ahead), written by monitor-status.post.js.
CREATE TABLE IF NOT EXISTS status_change_log (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id       UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    previous_status  TEXT,
    new_status       TEXT,
    changed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_status_change_log_student_id ON status_change_log(student_id);
ALTER TABLE status_change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "status_change_log: admin full access"
    ON status_change_log FOR ALL
    USING (is_admin()) WITH CHECK (is_admin());
GRANT ALL ON status_change_log TO service_role;
GRANT SELECT ON status_change_log TO authenticated;


-- ── student_issues ───────────────────────────────────────────
-- An older "report an issue" feature (server/api/student/report-issue.post.js)
-- that predates the newer Guidance & Request feature (guidance_requests
-- table). Both are wired up and functional; fixing this one's plumbing
-- too rather than leaving it half-broken, but consider consolidating
-- the two into one going forward.
CREATE TABLE IF NOT EXISTS student_issues (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    type        TEXT,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'open',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_student_issues_student_id ON student_issues(student_id);
ALTER TABLE student_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "student_issues: admin full access"
    ON student_issues FOR ALL
    USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "student_issues: student inserts own"
    ON student_issues FOR INSERT
    WITH CHECK (student_id = my_student_id());
CREATE POLICY "student_issues: student reads own"
    ON student_issues FOR SELECT
    USING (student_id = my_student_id());
GRANT SELECT, INSERT ON student_issues TO authenticated;
GRANT ALL ON student_issues TO service_role;
