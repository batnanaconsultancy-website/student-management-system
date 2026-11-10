-- ============================================================
-- Bachelor's attendance: access-controlled cohort aggregates
--
-- Uses eligible attendance ledger records for the three
-- Bachelor's programmes and legacy counters for other programmes.
-- Returns cohort aggregates only; never exposes individual rows.
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
            )::BIGINT AS standups
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
            END AS standups
        FROM accessible_students s
        LEFT JOIN ledger_counts l
          ON l.student_id = s.id
    )
    SELECT
        ps.cohort_id,
        COALESCE(c.name, 'Unknown Cohort')::TEXT AS cohort_name,
        COUNT(*)::BIGINT AS students_count,
        COALESCE(
            SUM(ps.workshops + ps.standups + ps.mentoring), 0
        )::BIGINT AS overall_total,
        COALESCE(SUM(ps.workshops), 0)::BIGINT AS workshop_total,
        COALESCE(SUM(ps.standups), 0)::BIGINT AS standup_total,
        COALESCE(SUM(ps.mentoring), 0)::BIGINT AS mentoring_total,
        COALESCE(
            MAX(ps.workshops + ps.standups + ps.mentoring), 0
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
