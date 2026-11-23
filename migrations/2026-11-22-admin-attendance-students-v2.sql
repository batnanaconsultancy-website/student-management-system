BEGIN;

CREATE OR REPLACE FUNCTION public.get_admin_attendance_students_v2()
RETURNS TABLE (
    student_id uuid,
    first_name text,
    last_name text,
    email text,
    username text,
    program_id uuid,
    program_name text,
    cohort_id uuid,
    cohort_name text,

    cohort_size bigint,
    uses_ledger boolean,

    workshops bigint,
    workshops_max bigint,
    workshops_percent integer,

    mentoring bigint,
    mentoring_max bigint,
    mentoring_percent integer,

    standups bigint,
    standups_max bigint,
    standups_percent integer,

    squad_meetings bigint,
    squad_meetings_max bigint,
    squad_meetings_percent integer,

    overall bigint,
    overall_max bigint,
    overall_percent integer,
    actual_points bigint,

    reporting_date date,
    calendar_coverage_status text,

    scheduled_workshops_attended bigint,
    scheduled_workshops_total bigint,
    scheduled_workshops_percent integer,

    scheduled_mentoring_attended bigint,
    scheduled_mentoring_total bigint,
    scheduled_mentoring_percent integer,

    scheduled_standups_attended bigint,
    scheduled_standups_total bigint,
    scheduled_standups_percent integer,

    scheduled_squad_meetings_attended bigint,
    scheduled_squad_meetings_total bigint,
    scheduled_squad_meetings_percent integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $function$
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Admin attendance reporting requires service role'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        s.id,
        s.first_name,
        s.last_name,
        s.email,
        s.username,
        s.program_id,
        p.name,
        s.cohort_id,
        c.name,

        a.cohort_size,
        a.uses_ledger,

        a.workshops,
        a.workshops_max,
        a.workshops_percent,

        a.mentoring,
        a.mentoring_max,
        a.mentoring_percent,

        a.standups,
        a.standups_max,
        a.standups_percent,

        a.squad_meetings,
        a.squad_meetings_max,
        a.squad_meetings_percent,

        a.overall,
        a.overall_max,
        a.overall_percent,
        a.actual_points,

        a.reporting_date,
        a.calendar_coverage_status,

        a.scheduled_workshops_attended,
        a.scheduled_workshops_total,
        a.scheduled_workshops_percent,

        a.scheduled_mentoring_attended,
        a.scheduled_mentoring_total,
        a.scheduled_mentoring_percent,

        a.scheduled_standups_attended,
        a.scheduled_standups_total,
        a.scheduled_standups_percent,

        a.scheduled_squad_meetings_attended,
        a.scheduled_squad_meetings_total,
        a.scheduled_squad_meetings_percent

    FROM public.students AS s
    LEFT JOIN public.programs AS p
      ON p.id = s.program_id
    LEFT JOIN public.cohorts AS c
      ON c.id = s.cohort_id
     AND c.program_id = s.program_id
    CROSS JOIN LATERAL
        public.get_assessment_student_attendance_v2(s.id) AS a
    ORDER BY
        p.name NULLS LAST,
        c.name NULLS LAST,
        s.last_name NULLS LAST,
        s.first_name NULLS LAST,
        s.id;
END;
$function$;

REVOKE ALL
ON FUNCTION public.get_admin_attendance_students_v2()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.get_admin_attendance_students_v2()
TO service_role;

COMMENT ON FUNCTION public.get_admin_attendance_students_v2() IS
'Admin-only bulk student attendance report. Requires service_role and reuses the individual v2 attendance RPC for ledger, cohort-relative, and scheduled-calendar metrics.';

COMMIT;
