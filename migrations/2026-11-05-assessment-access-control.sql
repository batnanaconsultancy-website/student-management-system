-- ============================================================
-- SIS Assessment Access Control
--
-- Adds:
--   1. Historical faculty/student assignments.
--   2. Explicit Assessment Manager appointments.
--   3. Secure access helper functions.
--   4. A restricted student profile view.
--   5. RLS access to student assessment evidence.
--
-- Existing student, admin and Final Project examiner policies
-- are preserved. No existing examiner permissions are changed.
--
-- Assignment and manager administration is performed through
-- trusted server-side APIs using service_role.
-- ============================================================


-- ============================================================
-- ============================================================
-- PRIVATE AUTHORIZATION SCHEMA
--
-- PostgREST exposes public and graphql_public, not private.
-- Authenticated users need schema usage for RLS evaluation,
-- but authorization helpers are not exposed as REST RPCs.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS private AUTHORIZATION postgres;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA private TO authenticated, service_role;


-- 1. FACULTY / STUDENT ASSIGNMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.faculty_student_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    faculty_id UUID NOT NULL
        REFERENCES public.faculty(id) ON DELETE RESTRICT,

    student_id UUID NOT NULL
        REFERENCES public.students(id) ON DELETE CASCADE,

    assigned_by_email TEXT NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    deactivated_by_email TEXT,
    deactivated_at TIMESTAMPTZ,

    notes TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT faculty_student_assignment_deactivation_check
        CHECK (
            (is_active AND deactivated_at IS NULL AND deactivated_by_email IS NULL)
            OR
            (NOT is_active AND deactivated_at IS NOT NULL
                AND deactivated_by_email IS NOT NULL)
        )
);

-- A faculty member can be assigned to a student again after
-- a previous assignment has been deactivated.
CREATE UNIQUE INDEX IF NOT EXISTS
    idx_fsa_one_active_faculty_student
ON public.faculty_student_assignments(faculty_id, student_id)
WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_fsa_faculty_active
    ON public.faculty_student_assignments(faculty_id, is_active);

CREATE INDEX IF NOT EXISTS idx_fsa_student_active
    ON public.faculty_student_assignments(student_id, is_active);


-- ============================================================
-- 2. ASSESSMENT MANAGER APPOINTMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.assessment_managers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    faculty_id UUID NOT NULL
        REFERENCES public.faculty(id) ON DELETE RESTRICT,

    appointed_by_email TEXT NOT NULL,
    appointed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    revoked_by_email TEXT,
    revoked_at TIMESTAMPTZ,

    notes TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT assessment_manager_revocation_check
        CHECK (
            (is_active AND revoked_at IS NULL AND revoked_by_email IS NULL)
            OR
            (NOT is_active AND revoked_at IS NOT NULL
                AND revoked_by_email IS NOT NULL)
        )
);

-- Preserve previous appointments and revocations.
CREATE UNIQUE INDEX IF NOT EXISTS
    idx_assessment_managers_one_active_appointment
ON public.assessment_managers(faculty_id)
WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_assessment_managers_active
    ON public.assessment_managers(is_active);


-- ============================================================
-- 3. UPDATED_AT TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS set_updated_at_fsa
    ON public.faculty_student_assignments;

CREATE TRIGGER set_updated_at_fsa
    BEFORE UPDATE ON public.faculty_student_assignments
    FOR EACH ROW
    EXECUTE FUNCTION public.trigger_set_updated_at();


DROP TRIGGER IF EXISTS set_updated_at_assessment_managers
    ON public.assessment_managers;

CREATE TRIGGER set_updated_at_assessment_managers
    BEFORE UPDATE ON public.assessment_managers
    FOR EACH ROW
    EXECUTE FUNCTION public.trigger_set_updated_at();


-- ============================================================
-- 4. ASSESSMENT MANAGER AUTHORIZATION HELPER
-- ============================================================

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
          AND f.staff_type = 'teaching'
          AND am.is_active = TRUE
    );
$function$;


-- ============================================================
-- 5. ASSESSMENT PORTFOLIO ACCESS HELPER
--
-- Admin:
--   All students.
--
-- Assessment Manager:
--   All students, while appointment and faculty record active.
--
-- Faculty:
--   Only students with an active faculty/student assignment.
--   Faculty record must also be active teaching faculty.
--
-- Students:
--   Their own student record.
--
-- Final Project examiner status alone grants no access here.
-- ============================================================

CREATE OR REPLACE FUNCTION private.can_access_assessment_student(
    p_student_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
    SELECT
        p_student_id IS NOT NULL
        AND (
            public.is_admin()

            OR private.is_assessment_manager()

            OR EXISTS (
                SELECT 1
                FROM public.students own_student
                WHERE own_student.id = p_student_id
                  AND lower(own_student.email) = lower(auth.email())
            )

            OR EXISTS (
                SELECT 1
                FROM public.faculty_student_assignments fsa
                JOIN public.faculty f
                  ON f.id = fsa.faculty_id
                WHERE fsa.student_id = p_student_id
                  AND fsa.is_active = TRUE
                  AND lower(f.email) = lower(auth.email())
                  AND f.is_active = TRUE
                  AND f.staff_type = 'teaching'
            )
        );
$function$;


-- ============================================================
-- 6. RESTRICTED STUDENT PROFILE VIEW
--
-- Do not add a broad faculty SELECT policy to students.
-- The view exposes only assessment-relevant identity and
-- programme fields for portfolios the caller may access.
--
-- This is an owner-context view. Its WHERE clause explicitly
-- checks the authenticated caller using the authorization
-- helper above.
-- ============================================================

CREATE OR REPLACE VIEW public.assessment_student_profiles
WITH (
    security_barrier = TRUE,
    security_invoker = FALSE
)
AS
SELECT
    s.id,
    s.username,
    s.email,
    s.first_name,
    s.last_name,
    s.program_id,
    s.cohort_id,
    s.account_status,
    s.is_active,
    s.status,
    s.current_season_id,
    s.expected_season_id,
    s.student_class,
    s.workshops_attended,
    s.standup_attended,
    s.mentoring_attended
FROM public.students s
WHERE private.can_access_assessment_student(s.id);


-- ============================================================
-- 7. ASSIGNMENT TABLE RLS
-- ============================================================

ALTER TABLE public.faculty_student_assignments
    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS
    "fsa: admin full access"
    ON public.faculty_student_assignments;

CREATE POLICY "fsa: admin full access"
    ON public.faculty_student_assignments
    FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- Faculty can inspect their own assignment records.
DROP POLICY IF EXISTS
    "fsa: faculty reads own assignments"
    ON public.faculty_student_assignments;

CREATE POLICY "fsa: faculty reads own assignments"
    ON public.faculty_student_assignments
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM public.faculty f
            WHERE f.id = faculty_student_assignments.faculty_id
              AND lower(f.email) = lower(auth.email())
              AND f.is_active = TRUE
              AND f.staff_type = 'teaching'
        )
    );

-- Assignment administration is reserved for administrators.
-- Assessment Managers receive portfolio access through the
-- assessment access helper, not through the assignment register.


-- ============================================================
-- 8. ASSESSMENT MANAGER TABLE RLS
-- ============================================================

ALTER TABLE public.assessment_managers
    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS
    "assessment_managers: admin full access"
    ON public.assessment_managers;

CREATE POLICY "assessment_managers: admin full access"
    ON public.assessment_managers
    FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS
    "assessment_managers: faculty reads own appointment"
    ON public.assessment_managers;

CREATE POLICY "assessment_managers: faculty reads own appointment"
    ON public.assessment_managers
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM public.faculty f
            WHERE f.id = assessment_managers.faculty_id
              AND lower(f.email) = lower(auth.email())
        )
    );


-- ============================================================
-- 9. ASSESSMENT EVIDENCE RLS
--
-- These are additional permissive SELECT policies.
-- Existing student and admin policies are preserved.
-- ============================================================

DROP POLICY IF EXISTS
    "student_project_completion: assessment access"
    ON public.student_project_completion;

CREATE POLICY "student_project_completion: assessment access"
    ON public.student_project_completion
    FOR SELECT
    USING (
        private.can_access_assessment_student(student_id)
    );


DROP POLICY IF EXISTS
    "student_season_progress: assessment access"
    ON public.student_season_progress;

CREATE POLICY "student_season_progress: assessment access"
    ON public.student_season_progress
    FOR SELECT
    USING (
        private.can_access_assessment_student(student_id)
    );


-- ============================================================
-- 10. FUNCTION EXECUTION PERMISSIONS
-- ============================================================

REVOKE ALL ON FUNCTION private.is_assessment_manager()
    FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION private.can_access_assessment_student(UUID)
    FROM PUBLIC, anon;

-- Required by the assessment profile view and evidence-table RLS.
-- The private schema is not exposed through PostgREST.
GRANT EXECUTE ON FUNCTION private.can_access_assessment_student(UUID)
    TO authenticated, service_role;


-- ============================================================
-- 11. TABLE AND VIEW PERMISSIONS
--
-- Authenticated users get SELECT only on the new management
-- tables. Trusted server-side service-role APIs perform writes.
-- RLS still determines which rows authenticated users can see.
-- ============================================================

REVOKE ALL ON public.faculty_student_assignments
    FROM anon, authenticated;

GRANT SELECT ON public.faculty_student_assignments
    TO authenticated;

GRANT ALL ON public.faculty_student_assignments
    TO service_role;


REVOKE ALL ON public.assessment_managers
    FROM anon, authenticated;

GRANT SELECT ON public.assessment_managers
    TO authenticated;

GRANT ALL ON public.assessment_managers
    TO service_role;


REVOKE ALL ON public.assessment_student_profiles
    FROM anon, authenticated;

GRANT SELECT ON public.assessment_student_profiles
    TO authenticated, service_role;


-- ============================================================
-- END
-- ============================================================
