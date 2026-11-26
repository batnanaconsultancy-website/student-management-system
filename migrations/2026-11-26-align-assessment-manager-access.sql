BEGIN;

-- Keep Assessment Manager access consistent with the application
-- authorization helper:
--   1. Faculty account must be active.
--   2. Assessment Manager appointment must be active.
--   3. staff_type does not independently revoke an active appointment.

CREATE OR REPLACE FUNCTION private.is_assessment_manager()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.assessment_managers am
        JOIN public.faculty f
          ON f.id = am.faculty_id
        WHERE lower(f.email) = lower(auth.email())
          AND f.is_active = TRUE
          AND am.is_active = TRUE
    );
$function$;

COMMIT;
