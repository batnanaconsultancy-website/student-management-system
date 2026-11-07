-- Atomic and monotonic Qwasar completion updates.
-- Apply only after reviewing and testing this migration.

CREATE OR REPLACE FUNCTION public.apply_qwasar_project_completion_batch(
    p_records jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
    v_item jsonb;
    v_student_id uuid;
    v_project_id uuid;
    v_status text;
    v_changed integer := 0;
BEGIN
    IF p_records IS NULL OR jsonb_typeof(p_records) <> 'array' THEN
        RAISE EXCEPTION
            'QWASAR_COMPLETION_INVALID: p_records must be a JSON array.';
    END IF;

    -- Validate every input record before the batch writes begin.
    FOR v_item IN
        SELECT value FROM jsonb_array_elements(p_records)
    LOOP
        IF jsonb_typeof(v_item) <> 'object' THEN
            RAISE EXCEPTION
                'QWASAR_COMPLETION_INVALID: Each record must be an object.';
        END IF;

        IF COALESCE(v_item->>'student_id', '') = ''
           OR COALESCE(v_item->>'project_id', '') = ''
           OR COALESCE(v_item->>'status', '') = '' THEN
            RAISE EXCEPTION
                'QWASAR_COMPLETION_INVALID: Required fields are missing.';
        END IF;

        v_student_id := (v_item->>'student_id')::uuid;
        v_project_id := (v_item->>'project_id')::uuid;
        v_status := v_item->>'status';

        IF v_status NOT IN ('COMPLETED', 'IN_PROGRESS') THEN
            RAISE EXCEPTION
                'QWASAR_COMPLETION_INVALID: Unsupported status "%".',
                v_status;
        END IF;
    END LOOP;

    -- Group duplicates; COMPLETED takes precedence.
    -- IN_PROGRESS inserts only when absent.
    -- COMPLETED promotes an incomplete row without altering grade/date.
    INSERT INTO public.student_project_completion AS current_row (
        student_id,
        project_id,
        is_completed
    )
    SELECT
        grouped.student_id,
        grouped.project_id,
        grouped.is_completed
    FROM (
        SELECT
            (item->>'student_id')::uuid AS student_id,
            (item->>'project_id')::uuid AS project_id,
            bool_or(item->>'status' = 'COMPLETED') AS is_completed
        FROM jsonb_array_elements(p_records) AS entries(item)
        GROUP BY
            (item->>'student_id')::uuid,
            (item->>'project_id')::uuid
    ) AS grouped
    ORDER BY grouped.student_id, grouped.project_id
    ON CONFLICT (student_id, project_id)
    DO UPDATE
       SET is_completed = TRUE
     WHERE EXCLUDED.is_completed = TRUE
       AND current_row.is_completed IS DISTINCT FROM TRUE;

    GET DIAGNOSTICS v_changed = ROW_COUNT;
    RETURN v_changed;
END;
$function$;

REVOKE ALL ON FUNCTION
    public.apply_qwasar_project_completion_batch(jsonb)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.apply_qwasar_project_completion_batch(jsonb)
    TO service_role;
