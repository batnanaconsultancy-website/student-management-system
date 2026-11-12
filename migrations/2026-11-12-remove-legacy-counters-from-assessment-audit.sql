-- ============================================================
-- Individual assessment attendance audit
--
-- Returns student-associated non-eligible attendance submissions.
-- Historical legacy counters remain stored but are not exposed.
--
-- Does not modify attendance records, counters, points or imports.
-- ============================================================

BEGIN;

DROP FUNCTION public.get_assessment_student_attendance_audit(UUID);

CREATE FUNCTION public.get_assessment_student_attendance_audit(
    p_student_id UUID
)
RETURNS TABLE (
    uses_ledger BOOLEAN,
    unverified_total BIGINT,
    unverified_by_reason JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
    v_program_id UUID;
    v_uses_ledger BOOLEAN;
BEGIN
    IF p_student_id IS NULL THEN
        RAISE EXCEPTION 'Student ID is required'
            USING ERRCODE = '22004';
    END IF;

    IF auth.role() IS DISTINCT FROM 'service_role'
       AND private.can_access_assessment_student(p_student_id) IS NOT TRUE THEN
        RAISE EXCEPTION 'Not authorised to access this student attendance'
            USING ERRCODE = '42501';
    END IF;

    SELECT s.program_id
    INTO v_program_id
    FROM public.students AS s
    WHERE s.id = p_student_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Student record not found'
            USING ERRCODE = 'P0002';
    END IF;

    v_uses_ledger := v_program_id IN (
        'bd715dd5-dc5a-414a-98f9-660274fd60e0'::UUID,
        'c266131f-8e5e-4f39-9711-54523d65ea24'::UUID,
        '07bc935a-c743-4cab-b10c-a1d231eaf3e2'::UUID
    );

    RETURN QUERY
    WITH target_student AS (
        SELECT
            s.id,
            s.program_id,
            s.cohort_id
        FROM public.students AS s
        WHERE s.id = p_student_id
    ),
    unverified_groups AS (
        SELECT
            bar.eligibility_status,
            bar.exclusion_reason,
            bar.session_type,
            COUNT(*)::BIGINT AS record_count
        FROM public.bachelor_attendance_records AS bar
        JOIN target_student AS target
          ON target.id = bar.student_id
         AND target.program_id = bar.program_id
         AND target.cohort_id = bar.cohort_id
        WHERE v_uses_ledger
          AND bar.eligibility_status IN ('excluded', 'unresolved')
        GROUP BY
            bar.eligibility_status,
            bar.exclusion_reason,
            bar.session_type
    ),
    unverified_summary AS (
        SELECT
            COALESCE(SUM(ug.record_count), 0)::BIGINT AS total,
            COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'eligibility_status', ug.eligibility_status,
                        'reason', ug.exclusion_reason,
                        'session_type', ug.session_type,
                        'count', ug.record_count
                    )
                    ORDER BY
                        ug.eligibility_status,
                        ug.exclusion_reason,
                        ug.session_type
                ),
                '[]'::JSONB
            ) AS groups
        FROM unverified_groups AS ug
    )
    SELECT
        v_uses_ledger,
        audit.total,
        audit.groups
    FROM target_student AS target
    CROSS JOIN unverified_summary AS audit;
END;
$function$;

REVOKE ALL
ON FUNCTION public.get_assessment_student_attendance_audit(UUID)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.get_assessment_student_attendance_audit(UUID)
TO authenticated, service_role;

COMMIT;
