-- Historical Google Meet attendance for Canvas Masters.
CREATE TABLE IF NOT EXISTS public.canvas_masters_attendance_records (
    meeting_id TEXT NOT NULL,
    meeting_at TIMESTAMPTZ NOT NULL,
    email TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    duration_minutes NUMERIC NOT NULL DEFAULT 0,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (meeting_id, email),
    CHECK (email = lower(trim(email))),
    CHECK (duration_minutes >= 0)
);

CREATE INDEX IF NOT EXISTS idx_canvas_masters_attendance_email
    ON public.canvas_masters_attendance_records (email);

CREATE INDEX IF NOT EXISTS idx_canvas_masters_attendance_meeting_at
    ON public.canvas_masters_attendance_records (meeting_at);

CREATE TABLE IF NOT EXISTS public.canvas_masters_meet_attendance_summary (
    email TEXT PRIMARY KEY,
    first_name TEXT,
    last_name TEXT,
    meetings_attended INTEGER NOT NULL DEFAULT 0,
    total_duration_minutes NUMERIC NOT NULL DEFAULT 0,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.canvas_masters_meet_attendance_summary
    ENABLE ROW LEVEL SECURITY;

-- Remove broad default table privileges inherited by these new tables.
REVOKE ALL ON TABLE
    public.canvas_masters_attendance_records,
    public.canvas_masters_meet_attendance_summary
FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "canvas_masters_meet_attendance_summary: admin read"
    ON public.canvas_masters_meet_attendance_summary;

CREATE POLICY "canvas_masters_meet_attendance_summary: admin read"
    ON public.canvas_masters_meet_attendance_summary
    FOR SELECT TO authenticated
    USING (public.is_admin());

GRANT SELECT ON public.canvas_masters_meet_attendance_summary TO authenticated;
GRANT ALL ON public.canvas_masters_meet_attendance_summary TO service_role;

ALTER TABLE public.canvas_masters_attendance_records
    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "canvas_masters_attendance_records: admin read"
    ON public.canvas_masters_attendance_records;

CREATE POLICY "canvas_masters_attendance_records: admin read"
    ON public.canvas_masters_attendance_records
    FOR SELECT TO authenticated
    USING (public.is_admin());

GRANT SELECT ON public.canvas_masters_attendance_records TO authenticated;
GRANT ALL ON public.canvas_masters_attendance_records TO service_role;

-- Replace one meeting and rebuild the student summary in a single transaction.
CREATE OR REPLACE FUNCTION public.replace_canvas_masters_meeting_attendance(
    p_meeting_id TEXT,
    p_meeting_at TIMESTAMPTZ,
    p_records JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_rows INTEGER := 0;
    v_students INTEGER := 0;
BEGIN
    IF p_meeting_id IS NULL OR trim(p_meeting_id) = '' THEN
        RAISE EXCEPTION 'Meeting ID is required';
    END IF;

    IF p_meeting_at IS NULL THEN
        RAISE EXCEPTION 'Meeting date is required';
    END IF;

    IF p_records IS NULL OR jsonb_typeof(p_records) <> 'array' THEN
        RAISE EXCEPTION 'Attendance records must be a JSON array';
    END IF;

    IF jsonb_array_length(p_records) = 0 THEN
        RAISE EXCEPTION 'Attendance records cannot be empty';
    END IF;

    -- Validate every row before deleting existing meeting data.
    IF EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_records) AS r(
            email TEXT,
            duration_minutes NUMERIC
        )
        WHERE r.email IS NULL
           OR trim(r.email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
           OR r.duration_minutes IS NULL
           OR r.duration_minutes < 0
           OR r.duration_minutes::TEXT IN ('NaN', 'Infinity', '-Infinity')
    ) THEN
        RAISE EXCEPTION 'Attendance payload contains invalid email or duration';
    END IF;


    -- Reject duplicate normalized emails before replacing meeting data.
    IF EXISTS (
        SELECT lower(trim(r.email))
        FROM jsonb_to_recordset(p_records) AS r(
            email TEXT
        )
        GROUP BY lower(trim(r.email))
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Attendance payload contains duplicate attendee emails';
    END IF;

    DELETE FROM public.canvas_masters_attendance_records
    WHERE meeting_id = p_meeting_id;

    INSERT INTO public.canvas_masters_attendance_records (
        meeting_id,
        meeting_at,
        email,
        first_name,
        last_name,
        duration_minutes,
        synced_at
    )
    SELECT
        p_meeting_id,
        p_meeting_at,
        lower(trim(r.email)),
        NULLIF(trim(r.first_name), ''),
        NULLIF(trim(r.last_name), ''),
        r.duration_minutes,
        NOW()
    FROM jsonb_to_recordset(p_records) AS r(
        email TEXT,
        first_name TEXT,
        last_name TEXT,
        duration_minutes NUMERIC
    )
    WHERE r.email IS NOT NULL
      AND trim(r.email) <> ''
      AND r.duration_minutes IS NOT NULL
      AND r.duration_minutes >= 0;

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows <> jsonb_array_length(p_records) THEN
        RAISE EXCEPTION
            'Attendance insert count mismatch: expected %, inserted %',
            jsonb_array_length(p_records),
            v_rows;
    END IF;

    -- Rebuild only the dedicated Google Meet summary.
    -- Never delete or overwrite legacy canvas_sheet_attendance rows.
    DELETE FROM public.canvas_masters_meet_attendance_summary
    WHERE email IS NOT NULL;

    WITH totals AS (
        SELECT
            email,
            COUNT(DISTINCT meeting_id)::INTEGER AS meetings_attended,
            SUM(duration_minutes) AS total_duration_minutes
        FROM public.canvas_masters_attendance_records
        GROUP BY email
    ),
    latest_names AS (
        SELECT DISTINCT ON (email)
            email,
            first_name,
            last_name
        FROM public.canvas_masters_attendance_records
        ORDER BY email, meeting_at DESC, synced_at DESC
    )
    INSERT INTO public.canvas_masters_meet_attendance_summary (
        email,
        first_name,
        last_name,
        meetings_attended,
        total_duration_minutes,
        synced_at
    )
    SELECT
        t.email,
        n.first_name,
        n.last_name,
        t.meetings_attended,
        t.total_duration_minutes,
        NOW()
    FROM totals t
    JOIN latest_names n USING (email);

    GET DIAGNOSTICS v_students = ROW_COUNT;

    RETURN jsonb_build_object(
        'meeting_attendees', v_rows,
        'students_in_summary', v_students
    );
END;
$$;

REVOKE ALL ON FUNCTION public.replace_canvas_masters_meeting_attendance(
    TEXT, TIMESTAMPTZ, JSONB
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.replace_canvas_masters_meeting_attendance(
    TEXT, TIMESTAMPTZ, JSONB
) TO service_role;
