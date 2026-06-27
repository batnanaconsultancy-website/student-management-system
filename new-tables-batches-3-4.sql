-- ============================================================
-- NEW TABLES FOR BATCHES 3–5
-- Run this in Supabase SQL Editor after the original schema.sql
-- ============================================================

-- ── audit_log ─────────────────────────────────────────────────
-- Tracks every admin action for accountability
CREATE TABLE IF NOT EXISTS audit_log (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
CREATE POLICY "audit_log: admin read" ON audit_log FOR SELECT
    USING (EXISTS (SELECT 1 FROM admin WHERE email = auth.email()));
CREATE POLICY "audit_log: authenticated insert" ON audit_log FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;


-- ── student_notifications ────────────────────────────────────
-- In-app notifications for students (status changes, admin messages, etc.)
CREATE TABLE IF NOT EXISTS student_notifications (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    body        TEXT,
    type        TEXT NOT NULL DEFAULT 'info',   -- 'info' | 'warning' | 'success' | 'error'
    is_read     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_notif_student  ON student_notifications(student_id);
CREATE INDEX IF NOT EXISTS idx_student_notif_unread   ON student_notifications(student_id, is_read);
CREATE INDEX IF NOT EXISTS idx_student_notif_created  ON student_notifications(created_at DESC);

ALTER TABLE student_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "student_notif: student reads own" ON student_notifications FOR SELECT
    USING (student_id = (SELECT id FROM students WHERE email = auth.email() LIMIT 1));
CREATE POLICY "student_notif: student updates own" ON student_notifications FOR UPDATE
    USING (student_id = (SELECT id FROM students WHERE email = auth.email() LIMIT 1));
CREATE POLICY "student_notif: admin full access" ON student_notifications FOR ALL
    USING (EXISTS (SELECT 1 FROM admin WHERE email = auth.email()))
    WITH CHECK (EXISTS (SELECT 1 FROM admin WHERE email = auth.email()));

GRANT SELECT, UPDATE ON public.student_notifications TO authenticated;
GRANT ALL ON public.student_notifications TO service_role;


-- ── student_issues ───────────────────────────────────────────
-- Student-reported discrepancies / technical issues
CREATE TABLE IF NOT EXISTS student_issues (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,         -- 'attendance' | 'progress' | 'enrolment' | 'calendar' | 'other'
    description TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'in_review' | 'resolved'
    admin_notes TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_updated_at_student_issues
    BEFORE UPDATE ON student_issues
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_student_issues_student ON student_issues(student_id);
CREATE INDEX IF NOT EXISTS idx_student_issues_status  ON student_issues(status);

ALTER TABLE student_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "student_issues: student reads own" ON student_issues FOR SELECT
    USING (student_id = (SELECT id FROM students WHERE email = auth.email() LIMIT 1));
CREATE POLICY "student_issues: student insert" ON student_issues FOR INSERT
    WITH CHECK (student_id = (SELECT id FROM students WHERE email = auth.email() LIMIT 1));
CREATE POLICY "student_issues: admin full access" ON student_issues FOR ALL
    USING (EXISTS (SELECT 1 FROM admin WHERE email = auth.email()))
    WITH CHECK (EXISTS (SELECT 1 FROM admin WHERE email = auth.email()));

GRANT SELECT, INSERT ON public.student_issues TO authenticated;
GRANT ALL ON public.student_issues TO service_role;


-- ── admin_notifications ──────────────────────────────────────
-- Notifications sent to admins (student issue reports, etc.)
CREATE TABLE IF NOT EXISTS admin_notifications (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_email  TEXT NOT NULL,
    type         TEXT NOT NULL,        -- 'student_issue' | 'pipeline_failure' | 'status_change'
    title        TEXT NOT NULL,
    body         TEXT,
    entity_type  TEXT,
    entity_id    TEXT,
    is_read      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_notif_email   ON admin_notifications(admin_email);
CREATE INDEX IF NOT EXISTS idx_admin_notif_unread  ON admin_notifications(admin_email, is_read);

ALTER TABLE admin_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_notif: admin reads own" ON admin_notifications FOR SELECT
    USING (admin_email = auth.email());
CREATE POLICY "admin_notif: admin updates own" ON admin_notifications FOR UPDATE
    USING (admin_email = auth.email());
CREATE POLICY "admin_notif: authenticated insert" ON admin_notifications FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

GRANT SELECT, INSERT, UPDATE ON public.admin_notifications TO authenticated;
GRANT ALL ON public.admin_notifications TO service_role;
