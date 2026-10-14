CREATE TABLE IF NOT EXISTS public.canvas_masters_attendance_preview (
    snapshot_key TEXT PRIMARY KEY DEFAULT 'latest'
        CHECK (snapshot_key = 'latest'),

    preview JSONB,
    last_successful_scan_at TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ,
    last_attempt_status TEXT NOT NULL DEFAULT 'never_run'
        CHECK (
            last_attempt_status IN (
                'never_run',
                'running',
                'completed',
                'completed_with_errors',
                'failed'
            )
        ),
    last_error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.canvas_masters_attendance_preview
    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS
    "Admins can read masters attendance preview"
    ON public.canvas_masters_attendance_preview;

CREATE POLICY "Admins can read masters attendance preview"
ON public.canvas_masters_attendance_preview
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.admin AS a
        WHERE LOWER(a.email) = LOWER(auth.jwt() ->> 'email')
    )
);

GRANT SELECT
ON public.canvas_masters_attendance_preview
TO authenticated;

GRANT ALL
ON public.canvas_masters_attendance_preview
TO service_role;
