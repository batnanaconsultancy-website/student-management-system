-- Temporary, auditable admin Student View sessions.
-- Apply this migration to Supabase only after local implementation review.

CREATE TABLE IF NOT EXISTS public.student_view_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    admin_email TEXT NOT NULL,
    student_id UUID NOT NULL
        REFERENCES public.students(id) ON DELETE RESTRICT,
    student_email TEXT NOT NULL,

    reason TEXT NOT NULL
        CHECK (length(trim(reason)) BETWEEN 10 AND 1000),
    student_authorized BOOLEAN NOT NULL
        CHECK (student_authorized = TRUE),

    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'ended', 'expired')),

    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,

    CHECK (expires_at > started_at),
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_student_view_sessions_admin
    ON public.student_view_sessions (admin_email, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_view_sessions_student
    ON public.student_view_sessions (student_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_view_sessions_active_expiry
    ON public.student_view_sessions (expires_at)
    WHERE status = 'active';

-- Enforce one active session per administrator, including concurrent starts.
-- The API expires timed-out sessions before allowing a new session.
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_view_sessions_one_active_per_admin
    ON public.student_view_sessions (admin_email)
    WHERE status = 'active';

-- Session records are accessed by trusted server-side code only.
ALTER TABLE public.student_view_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.student_view_sessions FROM anon;
REVOKE ALL ON TABLE public.student_view_sessions FROM authenticated;
GRANT ALL ON TABLE public.student_view_sessions TO service_role;
