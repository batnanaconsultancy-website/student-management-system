BEGIN;

-- Admin individual-student engagement assessment.
-- Unlike the existing all-time attendance RPC, this calculation
-- limits every eligible attendance record to the Amsterdam reporting date.
-- It is intentionally separate so existing student and cohort dashboards
-- retain their current behaviour.

CREATE OR REPLACE FUNCTION public.get_bachelor_engagement_cohort_attendance(
    p_student_id UUID
)
RETURNS TABLE (
    reporting_date DATE,
    cohort_size BIGINT,
    student_eligible_sessions BIGINT,
    cohort_max_eligible_sessions BIGINT,
    cohort_relative_percent INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
    v_reporting_date DATE :=
        timezone('Europe/Amsterdam', now())::DATE;
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

    IF NOT EXISTS (
        SELECT 1
        FROM public.students
        WHERE id = p_student_id
    ) THEN
        RAISE EXCEPTION 'Student record not found'
            USING ERRCODE = 'P0002';
    END IF;

    RETURN QUERY
    WITH target_student AS (
        SELECT
            s.id,
            s.cohort_id,
            s.program_id
        FROM public.students AS s
        WHERE s.id = p_student_id
          AND s.program_id IN (
              'bd715dd5-dc5a-414a-98f9-660274fd60e0'::UUID,
              'c266131f-8e5e-4f39-9711-54523d65ea24'::UUID,
              '07bc935a-c743-4cab-b10c-a1d231eaf3e2'::UUID
          )
    ),

    cohort_students AS (
        SELECT
            s.id,
            s.cohort_id,
            s.program_id
        FROM public.students AS s
        CROSS JOIN target_student AS target
        WHERE (
            target.cohort_id IS NOT NULL
            AND s.cohort_id = target.cohort_id
            AND s.program_id = target.program_id
        )
        OR (
            target.cohort_id IS NULL
            AND s.id = target.id
        )
    ),

    per_student AS (
        SELECT
            cs.id,
            COUNT(bar.student_id)::BIGINT AS eligible_sessions
        FROM cohort_students AS cs
        LEFT JOIN public.bachelor_attendance_records AS bar
          ON bar.student_id = cs.id
         AND bar.program_id = cs.program_id
         AND (
             cs.cohort_id IS NULL
             OR bar.cohort_id = cs.cohort_id
         )
         AND bar.eligibility_status = 'eligible'
         AND bar.session_date <= v_reporting_date
        GROUP BY cs.id
    ),

    cohort_summary AS (
        SELECT
            COUNT(*)::BIGINT AS cohort_size,
            COALESCE(
                MAX(ps.eligible_sessions)
                    FILTER (WHERE ps.id = p_student_id),
                0
            )::BIGINT AS student_sessions,
            COALESCE(MAX(ps.eligible_sessions), 0)::BIGINT AS cohort_max
        FROM per_student AS ps
    )

    SELECT
        v_reporting_date,
        cs.cohort_size,
        cs.student_sessions,
        cs.cohort_max,
        CASE
            WHEN cs.cohort_max > 0
            THEN ROUND(
                100.0 * cs.student_sessions / cs.cohort_max
            )::INTEGER
            ELSE NULL
        END
    FROM cohort_summary AS cs;

END;
$function$;

REVOKE ALL
ON FUNCTION public.get_bachelor_engagement_cohort_attendance(UUID)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.get_bachelor_engagement_cohort_attendance(UUID)
TO authenticated, service_role;

COMMENT ON FUNCTION public.get_bachelor_engagement_cohort_attendance(UUID) IS
    'Returns Bachelor eligible attendance counts and cohort-relative percentage through the Europe/Amsterdam reporting date. Separate from all-time attendance reporting.';

COMMIT;
