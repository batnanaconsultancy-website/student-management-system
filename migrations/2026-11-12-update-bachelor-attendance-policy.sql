BEGIN;

-- ============================================================
-- 1. Update attendance points and eligibility constraints
-- ============================================================

-- The original inline CHECK permits only 0, 1 and 3.
ALTER TABLE public.bachelor_attendance_records
    DROP CONSTRAINT IF EXISTS bachelor_attendance_records_points_awarded_check;

ALTER TABLE public.bachelor_attendance_records
    ADD CONSTRAINT bachelor_attendance_records_points_awarded_check
    CHECK (points_awarded IN (0, 1, 2, 3));

ALTER TABLE public.bachelor_attendance_records
    DROP CONSTRAINT IF EXISTS bachelor_attendance_points_check;

ALTER TABLE public.bachelor_attendance_records
    ADD CONSTRAINT bachelor_attendance_points_check
    CHECK (
        (
            eligibility_status = 'eligible'
            AND session_type IN ('workshop', 'mentoring')
            AND points_awarded = 3
        )
        OR
        (
            eligibility_status = 'eligible'
            AND session_type = 'squad_meeting'
            AND points_awarded = 2
        )
        OR
        (
            eligibility_status = 'eligible'
            AND session_type = 'standup'
            AND points_awarded = 1
        )
        OR
        (
            eligibility_status <> 'eligible'
            AND points_awarded = 0
        )
    );

ALTER TABLE public.bachelor_attendance_records
    DROP CONSTRAINT IF EXISTS bachelor_attendance_eligible_requirements_check;

ALTER TABLE public.bachelor_attendance_records
    ADD CONSTRAINT bachelor_attendance_eligible_requirements_check
    CHECK (
        eligibility_status <> 'eligible'
        OR (
            session_date IS NOT NULL
            AND student_id IS NOT NULL
            AND program_id IS NOT NULL
            AND cohort_id IS NOT NULL
            AND season_id IS NOT NULL
            AND program_cohort_season_id IS NOT NULL
            AND session_type IN (
                'workshop',
                'mentoring',
                'standup',
                'squad_meeting'
            )
        )
    );

COMMENT ON CONSTRAINT bachelor_attendance_eligible_requirements_check
ON public.bachelor_attendance_records IS
'Eligible submissions require a valid student, programme, cohort, Season, schedule and session type. Live status is retained for audit only and does not determine attendance eligibility.';


-- ============================================================
-- 2. Include Squad Meeting in cohort attendance aggregates
--    Existing return signature is preserved.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_accessible_attendance_by_cohort()
RETURNS TABLE (
    cohort_id UUID,
    cohort_name TEXT,
    students_count BIGINT,
    overall_total BIGINT,
    workshop_total BIGINT,
    standup_total BIGINT,
    mentoring_total BIGINT,
    overall_max BIGINT,
    workshop_max BIGINT,
    standup_max BIGINT,
    mentoring_max BIGINT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
    WITH accessible_students AS (
        SELECT
            s.id,
            s.program_id,
            s.cohort_id,
            COALESCE(s.workshops_attended, 0)::BIGINT AS legacy_workshops,
            COALESCE(s.mentoring_attended, 0)::BIGINT AS legacy_mentoring,
            COALESCE(s.standup_attended, 0)::BIGINT AS legacy_standups
        FROM public.students s
        WHERE private.can_access_assessment_student(s.id)
    ),
    ledger_counts AS (
        SELECT
            bar.student_id,
            COUNT(*) FILTER (
                WHERE bar.session_type = 'workshop'
            )::BIGINT AS workshops,
            COUNT(*) FILTER (
                WHERE bar.session_type = 'mentoring'
            )::BIGINT AS mentoring,
            COUNT(*) FILTER (
                WHERE bar.session_type = 'standup'
            )::BIGINT AS standups,
            COUNT(*) FILTER (
                WHERE bar.session_type = 'squad_meeting'
            )::BIGINT AS squad_meetings
        FROM public.bachelor_attendance_records bar
        JOIN accessible_students s
          ON s.id = bar.student_id
        WHERE bar.eligibility_status = 'eligible'
        GROUP BY bar.student_id
    ),
    per_student AS (
        SELECT
            s.id,
            s.cohort_id,
            CASE
                WHEN s.program_id IN (
                    'bd715dd5-dc5a-414a-98f9-660274fd60e0'::UUID,
                    'c266131f-8e5e-4f39-9711-54523d65ea24'::UUID,
                    '07bc935a-c743-4cab-b10c-a1d231eaf3e2'::UUID
                )
                THEN COALESCE(l.workshops, 0)
                ELSE s.legacy_workshops
            END AS workshops,
            CASE
                WHEN s.program_id IN (
                    'bd715dd5-dc5a-414a-98f9-660274fd60e0'::UUID,
                    'c266131f-8e5e-4f39-9711-54523d65ea24'::UUID,
                    '07bc935a-c743-4cab-b10c-a1d231eaf3e2'::UUID
                )
                THEN COALESCE(l.mentoring, 0)
                ELSE s.legacy_mentoring
            END AS mentoring,
            CASE
                WHEN s.program_id IN (
                    'bd715dd5-dc5a-414a-98f9-660274fd60e0'::UUID,
                    'c266131f-8e5e-4f39-9711-54523d65ea24'::UUID,
                    '07bc935a-c743-4cab-b10c-a1d231eaf3e2'::UUID
                )
                THEN COALESCE(l.standups, 0)
                ELSE s.legacy_standups
            END AS standups,
            CASE
                WHEN s.program_id IN (
                    'bd715dd5-dc5a-414a-98f9-660274fd60e0'::UUID,
                    'c266131f-8e5e-4f39-9711-54523d65ea24'::UUID,
                    '07bc935a-c743-4cab-b10c-a1d231eaf3e2'::UUID
                )
                THEN COALESCE(l.squad_meetings, 0)
                ELSE 0
            END AS squad_meetings
        FROM accessible_students s
        LEFT JOIN ledger_counts l
          ON l.student_id = s.id
    )
    SELECT
        ps.cohort_id,
        COALESCE(c.name, 'Unknown Cohort')::TEXT AS cohort_name,
        COUNT(*)::BIGINT AS students_count,
        COALESCE(
            SUM(
                ps.workshops + ps.standups
                + ps.mentoring + ps.squad_meetings
            ), 0
        )::BIGINT AS overall_total,
        COALESCE(SUM(ps.workshops), 0)::BIGINT AS workshop_total,
        COALESCE(SUM(ps.standups), 0)::BIGINT AS standup_total,
        COALESCE(SUM(ps.mentoring), 0)::BIGINT AS mentoring_total,
        COALESCE(
            MAX(
                ps.workshops + ps.standups
                + ps.mentoring + ps.squad_meetings
            ), 0
        )::BIGINT AS overall_max,
        COALESCE(MAX(ps.workshops), 0)::BIGINT AS workshop_max,
        COALESCE(MAX(ps.standups), 0)::BIGINT AS standup_max,
        COALESCE(MAX(ps.mentoring), 0)::BIGINT AS mentoring_max
    FROM per_student ps
    LEFT JOIN public.cohorts c
      ON c.id = ps.cohort_id
    GROUP BY ps.cohort_id, c.name;
$function$;

REVOKE ALL
ON FUNCTION public.get_accessible_attendance_by_cohort()
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.get_accessible_attendance_by_cohort()
TO authenticated, service_role;


-- ============================================================
-- 3. Include Squad Meeting in individual attendance percentage
--    Existing return signature and authorization are preserved.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_assessment_student_attendance(
    p_student_id UUID
)
RETURNS TABLE (
    cohort_size BIGINT,
    workshops BIGINT,
    workshops_max BIGINT,
    workshops_percent INTEGER,
    mentoring BIGINT,
    mentoring_max BIGINT,
    mentoring_percent INTEGER,
    standups BIGINT,
    standups_max BIGINT,
    standups_percent INTEGER,
    overall BIGINT,
    overall_max BIGINT,
    overall_percent INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
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
            s.program_id,
            COALESCE(s.workshops_attended, 0)::BIGINT AS legacy_workshops,
            COALESCE(s.mentoring_attended, 0)::BIGINT AS legacy_mentoring,
            COALESCE(s.standup_attended, 0)::BIGINT AS legacy_standups
        FROM public.students AS s
        WHERE s.id = p_student_id
    ),
    cohort_students AS (
        SELECT
            s.id,
            s.cohort_id,
            s.program_id,
            COALESCE(s.workshops_attended, 0)::BIGINT AS legacy_workshops,
            COALESCE(s.mentoring_attended, 0)::BIGINT AS legacy_mentoring,
            COALESCE(s.standup_attended, 0)::BIGINT AS legacy_standups
        FROM public.students AS s
        CROSS JOIN target_student AS target
        WHERE private.can_access_assessment_student(s.id)
          AND (
                (
                    target.cohort_id IS NOT NULL
                    AND s.cohort_id = target.cohort_id
                    AND s.program_id = target.program_id
                )
                OR
                (
                    target.cohort_id IS NULL
                    AND s.id = target.id
                )
            )
    ),
    ledger_counts AS (
        SELECT
            bar.student_id,
            COUNT(*) FILTER (
                WHERE bar.session_type = 'workshop'
            )::BIGINT AS workshops,
            COUNT(*) FILTER (
                WHERE bar.session_type = 'mentoring'
            )::BIGINT AS mentoring,
            COUNT(*) FILTER (
                WHERE bar.session_type = 'standup'
            )::BIGINT AS standups,
            COUNT(*) FILTER (
                WHERE bar.session_type = 'squad_meeting'
            )::BIGINT AS squad_meetings
        FROM public.bachelor_attendance_records AS bar
        JOIN cohort_students AS cs
          ON cs.id = bar.student_id
         AND cs.program_id = bar.program_id
         AND (
              cs.cohort_id IS NULL
              OR cs.cohort_id = bar.cohort_id
         )
        WHERE bar.eligibility_status = 'eligible'
        GROUP BY bar.student_id
    ),
    per_student AS (
        SELECT
            cs.id,
            CASE
                WHEN cs.program_id IN (
                    'bd715dd5-dc5a-414a-98f9-660274fd60e0'::UUID,
                    'c266131f-8e5e-4f39-9711-54523d65ea24'::UUID,
                    '07bc935a-c743-4cab-b10c-a1d231eaf3e2'::UUID
                )
                THEN COALESCE(lc.workshops, 0)
                ELSE cs.legacy_workshops
            END AS workshops,
            CASE
                WHEN cs.program_id IN (
                    'bd715dd5-dc5a-414a-98f9-660274fd60e0'::UUID,
                    'c266131f-8e5e-4f39-9711-54523d65ea24'::UUID,
                    '07bc935a-c743-4cab-b10c-a1d231eaf3e2'::UUID
                )
                THEN COALESCE(lc.mentoring, 0)
                ELSE cs.legacy_mentoring
            END AS mentoring,
            CASE
                WHEN cs.program_id IN (
                    'bd715dd5-dc5a-414a-98f9-660274fd60e0'::UUID,
                    'c266131f-8e5e-4f39-9711-54523d65ea24'::UUID,
                    '07bc935a-c743-4cab-b10c-a1d231eaf3e2'::UUID
                )
                THEN COALESCE(lc.standups, 0)
                ELSE cs.legacy_standups
            END AS standups,
            CASE
                WHEN cs.program_id IN (
                    'bd715dd5-dc5a-414a-98f9-660274fd60e0'::UUID,
                    'c266131f-8e5e-4f39-9711-54523d65ea24'::UUID,
                    '07bc935a-c743-4cab-b10c-a1d231eaf3e2'::UUID
                )
                THEN COALESCE(lc.squad_meetings, 0)
                ELSE 0
            END AS squad_meetings
        FROM cohort_students AS cs
        LEFT JOIN ledger_counts AS lc
          ON lc.student_id = cs.id
    ),
    cohort_maxima AS (
        SELECT
            COUNT(*)::BIGINT AS cohort_size,
            COALESCE(MAX(ps.workshops), 0)::BIGINT AS workshops_max,
            COALESCE(MAX(ps.mentoring), 0)::BIGINT AS mentoring_max,
            COALESCE(MAX(ps.standups), 0)::BIGINT AS standups_max,
            COALESCE(
                MAX(
                    ps.workshops + ps.mentoring
                    + ps.standups + ps.squad_meetings
                ), 0
            )::BIGINT AS overall_max
        FROM per_student AS ps
    ),
    target_counts AS (
        SELECT
            ps.workshops,
            ps.mentoring,
            ps.standups,
            (
                ps.workshops + ps.mentoring
                + ps.standups + ps.squad_meetings
            ) AS overall
        FROM per_student AS ps
        WHERE ps.id = p_student_id
    )
    SELECT
        cm.cohort_size,
        tc.workshops,
        cm.workshops_max,
        CASE
            WHEN cm.workshops_max > 0
            THEN ROUND(100.0 * tc.workshops / cm.workshops_max)::INTEGER
            ELSE 0
        END,
        tc.mentoring,
        cm.mentoring_max,
        CASE
            WHEN cm.mentoring_max > 0
            THEN ROUND(100.0 * tc.mentoring / cm.mentoring_max)::INTEGER
            ELSE 0
        END,
        tc.standups,
        cm.standups_max,
        CASE
            WHEN cm.standups_max > 0
            THEN ROUND(100.0 * tc.standups / cm.standups_max)::INTEGER
            ELSE 0
        END,
        tc.overall,
        cm.overall_max,
        CASE
            WHEN cm.overall_max > 0
            THEN ROUND(100.0 * tc.overall / cm.overall_max)::INTEGER
            ELSE 0
        END
    FROM target_counts AS tc
    CROSS JOIN cohort_maxima AS cm;
END;
$function$;

REVOKE ALL
ON FUNCTION public.get_assessment_student_attendance(UUID)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.get_assessment_student_attendance(UUID)
TO authenticated, service_role;

COMMIT;
