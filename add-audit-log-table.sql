-- Audit log table — records every admin action for accountability
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS audit_log (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_email  TEXT NOT NULL,
    action       TEXT NOT NULL,        -- e.g. 'import_students', 'change_status', 'add_admin'
    entity_type  TEXT,                 -- e.g. 'student', 'admin', 'cohort'
    entity_id    TEXT,                 -- the ID of the affected record
    details      JSONB,                -- arbitrary context (old/new values, count, etc.)
    ip_address   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_admin   ON audit_log(admin_email);
CREATE INDEX IF NOT EXISTS idx_audit_log_action  ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Admins can read all audit log entries
CREATE POLICY "audit_log: admin read" ON audit_log
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM admin WHERE email = auth.email())
    );

-- Anyone authenticated can insert (server routes write on behalf of admin actions)
-- The server routes enforce that only admins can trigger the actions that write here
CREATE POLICY "audit_log: authenticated insert" ON audit_log
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
