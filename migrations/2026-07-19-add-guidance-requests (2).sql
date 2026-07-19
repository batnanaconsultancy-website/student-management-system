-- ============================================================
-- Student Guidance & Request feature: students submit one or
-- more issue categories plus a short message; all admins can
-- see every submission (an "inbox"); a Slack + email notification
-- fires on submission.
-- ============================================================

CREATE TABLE IF NOT EXISTS guidance_requests (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id   UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    categories   TEXT[] NOT NULL,
    message      TEXT,
    -- Triage status for the admin inbox.
    status       TEXT NOT NULL DEFAULT 'New'
                 CHECK (status IN ('New', 'In Progress', 'Resolved')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guidance_requests_student_id ON guidance_requests(student_id);
CREATE INDEX IF NOT EXISTS idx_guidance_requests_status ON guidance_requests(status);
CREATE INDEX IF NOT EXISTS idx_guidance_requests_created_at ON guidance_requests(created_at);

DROP TRIGGER IF EXISTS set_updated_at_guidance_requests ON guidance_requests;
CREATE TRIGGER set_updated_at_guidance_requests
    BEFORE UPDATE ON guidance_requests
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE guidance_requests ENABLE ROW LEVEL SECURITY;

-- All admins can see and manage every request (the "inbox").
CREATE POLICY "guidance_requests: admin full access"
    ON guidance_requests FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

-- A student can see their own past requests...
CREATE POLICY "guidance_requests: student reads own"
    ON guidance_requests FOR SELECT
    USING (student_id = my_student_id());

-- ...and submit new ones, only under their own student_id.
CREATE POLICY "guidance_requests: student inserts own"
    ON guidance_requests FOR INSERT
    WITH CHECK (student_id = my_student_id());

-- RLS policies alone aren't enough -- Postgres also requires the base
-- table-level GRANT before a role can attempt an operation at all.
-- Pre-existing tables in this schema got this automatically from being
-- created via Supabase's Table Editor UI; a raw CREATE TABLE like this
-- one does not, so it must be granted explicitly.
GRANT SELECT, INSERT, UPDATE ON guidance_requests TO authenticated;
GRANT ALL ON guidance_requests TO service_role;
