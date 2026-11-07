-- ============================================================
-- FINAL PROJECT: NARROW EXAMINER STUDENT PROFILE ACCESS
--
-- Returns basic identity and programme details only for
-- students assigned to the authenticated active examiner.
--
-- Does not modify students RLS or assessment portfolio access.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_final_project_examiner_student_profiles()
RETURNS TABLE (
    id UUID,
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    program_name TEXT,
    cohort_name TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
    SELECT
        s.id,
        s.first_name,
        s.last_name,
        s.email,
        p.name AS program_name,
        c.name AS cohort_name
    FROM public.students s
    LEFT JOIN public.programs p
           ON p.id = s.program_id
    LEFT JOIN public.cohorts c
           ON c.id = s.cohort_id
    WHERE auth.email() IS NOT NULL
      AND EXISTS (
          SELECT 1
          FROM public.faculty f
          JOIN public.examiners e
            ON lower(e.email) = lower(f.email)
          JOIN public.final_project_assignment_examiners ae
            ON ae.examiner_id = e.id
          JOIN public.final_project_assignments a
            ON a.id = ae.assignment_id
          WHERE lower(f.email) = lower(auth.email())
            AND f.is_active = TRUE
            AND f.staff_type = 'teaching'
            AND e.is_active = TRUE
            AND a.student_id = s.id
            AND a.archived = FALSE
      );
$function$;

REVOKE ALL
    ON FUNCTION public.get_final_project_examiner_student_profiles()
    FROM PUBLIC, anon, service_role;

GRANT EXECUTE
    ON FUNCTION public.get_final_project_examiner_student_profiles()
    TO authenticated;

COMMENT ON FUNCTION public.get_final_project_examiner_student_profiles() IS
    'Returns only basic student profiles for non-archived Final Project assignments belonging to the authenticated active teaching examiner.';

COMMIT;
