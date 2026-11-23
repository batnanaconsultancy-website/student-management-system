-- ============================================================
-- Bachelor attendance reporting v2
--
-- Adds:
--   * Squad Meeting counts and cohort-relative percentages
--   * Actual eligible ledger points
--   * Scheduled-session attendance rates from the imported
--     programme calendars
--
-- Keeps the existing RPC intact for callers not yet migrated.
-- Unmatched calendar coverage and zero-opportunity rates remain
-- NULL; no denominator is inferred from another cohort.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_assessment_student_attendance_v2(
    p_student_id UUID
)
RETURNS TABLE (
    cohort_size BIGINT,
    uses_ledger BOOLEAN,

    workshops BIGINT,
    workshops_max BIGINT,
    workshops_percent INTEGER,

    mentoring BIGINT,
    mentoring_max BIGINT,
    mentoring_percent INTEGER,

    standups BIGINT,
    standups_max BIGINT,
    standups_percent INTEGER,

    squad_meetings BIGINT,
    squad_meetings_max BIGINT,
    squad_meetings_percent INTEGER,

    overall BIGINT,
    overall_max BIGINT,
    overall_percent INTEGER,
    actual_points BIGINT,

    reporting_date DATE,
    calendar_coverage_status TEXT,

    scheduled_workshops_attended BIGINT,
    scheduled_workshops_total BIGINT,
    scheduled_workshops_percent INTEGER,

    scheduled_mentoring_attended BIGINT,
    scheduled_mentoring_total BIGINT,
    scheduled_mentoring_percent INTEGER,

    scheduled_standups_attended BIGINT,
    scheduled_standups_total BIGINT,
    scheduled_standups_percent INTEGER,

    scheduled_squad_meetings_attended BIGINT,
    scheduled_squad_meetings_total BIGINT,
    scheduled_squad_meetings_percent INTEGER
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
            s.program_id,
            COALESCE(s.workshops_attended, 0)::BIGINT AS legacy_workshops,
            COALESCE(s.mentoring_attended, 0)::BIGINT AS legacy_mentoring,
            COALESCE(s.standup_attended, 0)::BIGINT AS legacy_standups
        FROM public.students AS s
        WHERE s.id = p_student_id
    ),

    -- Deliberately includes every student in the target cohort.
    -- Only the requested student's row is returned by this RPC.
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
            )::BIGINT AS squad_meetings,
            COALESCE(SUM(bar.points_awarded), 0)::BIGINT AS actual_points
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
            CASE WHEN cs.program_id IN (
                'bd715dd5-dc5a-414a-98f9-660274fd60e0'::UUID,
                'c266131f-8e5e-4f39-9711-54523d65ea24'::UUID,
                '07bc935a-c743-4cab-b10c-a1d231eaf3e2'::UUID
            )
                THEN COALESCE(lc.workshops, 0)
                ELSE cs.legacy_workshops
            END AS workshops,
            CASE WHEN cs.program_id IN (
                'bd715dd5-dc5a-414a-98f9-660274fd60e0'::UUID,
                'c266131f-8e5e-4f39-9711-54523d65ea24'::UUID,
                '07bc935a-c743-4cab-b10c-a1d231eaf3e2'::UUID
            )
                THEN COALESCE(lc.mentoring, 0)
                ELSE cs.legacy_mentoring
            END AS mentoring,
            CASE WHEN cs.program_id IN (
                'bd715dd5-dc5a-414a-98f9-660274fd60e0'::UUID,
                'c266131f-8e5e-4f39-9711-54523d65ea24'::UUID,
                '07bc935a-c743-4cab-b10c-a1d231eaf3e2'::UUID
            )
                THEN COALESCE(lc.standups, 0)
                ELSE cs.legacy_standups
            END AS standups,
            CASE WHEN cs.program_id IN (
                'bd715dd5-dc5a-414a-98f9-660274fd60e0'::UUID,
                'c266131f-8e5e-4f39-9711-54523d65ea24'::UUID,
                '07bc935a-c743-4cab-b10c-a1d231eaf3e2'::UUID
            )
                THEN COALESCE(lc.squad_meetings, 0)
                ELSE 0::BIGINT
            END AS squad_meetings,
            CASE WHEN cs.program_id IN (
                'bd715dd5-dc5a-414a-98f9-660274fd60e0'::UUID,
                'c266131f-8e5e-4f39-9711-54523d65ea24'::UUID,
                '07bc935a-c743-4cab-b10c-a1d231eaf3e2'::UUID
            )
                THEN COALESCE(lc.actual_points, 0)
                ELSE NULL::BIGINT
            END AS actual_points
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
            COALESCE(MAX(ps.squad_meetings), 0)::BIGINT AS squad_meetings_max,
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
            ps.squad_meetings,
            ps.workshops + ps.mentoring
                + ps.standups + ps.squad_meetings AS overall,
            ps.actual_points
        FROM per_student AS ps
        WHERE ps.id = p_student_id
    ),

    target_calendar AS (
        SELECT
            CASE
                WHEN target.program_id IN (
                    'bd715dd5-dc5a-414a-98f9-660274fd60e0'::UUID,
                    'c266131f-8e5e-4f39-9711-54523d65ea24'::UUID,
                    '07bc935a-c743-4cab-b10c-a1d231eaf3e2'::UUID
                )
                THEN COALESCE(cov.coverage_status, 'unmatched')
                ELSE 'not_applicable'
            END::TEXT AS coverage_status
        FROM target_student AS target
        LEFT JOIN public.bachelor_attendance_schedule_coverage AS cov
          ON cov.program_id = target.program_id
         AND cov.cohort_id = target.cohort_id
    ),

    scheduled_denominators AS (
        SELECT
            CASE WHEN tc.coverage_status = 'matched'
                THEN COALESCE(SUM(
                    CASE WHEN w.no_class_week OR w.no_workshop_week
                         THEN 0 ELSE w.scheduled_workshop END
                ), 0)::BIGINT
                ELSE NULL::BIGINT
            END AS workshops_total,
            CASE WHEN tc.coverage_status = 'matched'
                THEN COALESCE(SUM(
                    CASE WHEN w.no_class_week
                         THEN 0 ELSE w.scheduled_mentoring END
                ), 0)::BIGINT
                ELSE NULL::BIGINT
            END AS mentoring_total,
            CASE WHEN tc.coverage_status = 'matched'
                THEN COALESCE(SUM(
                    CASE WHEN w.no_class_week
                         THEN 0 ELSE w.scheduled_standups END
                ), 0)::BIGINT
                ELSE NULL::BIGINT
            END AS standups_total,
            CASE WHEN tc.coverage_status = 'matched'
                THEN COALESCE(SUM(
                    CASE WHEN w.no_class_week
                         THEN 0 ELSE w.scheduled_squad_meeting END
                ), 0)::BIGINT
                ELSE NULL::BIGINT
            END AS squad_meetings_total
        FROM target_student AS target
        CROSS JOIN target_calendar AS tc
        LEFT JOIN public.bachelor_attendance_schedule_weeks AS w
          ON w.program_id = target.program_id
         AND w.cohort_id = target.cohort_id
         AND w.timeline_date <= v_reporting_date
         AND EXISTS (
             SELECT 1
             FROM public.program_cohort_seasons AS pcs
             WHERE pcs.program_id = w.program_id
               AND pcs.cohort_id = w.cohort_id
               AND w.timeline_date BETWEEN pcs.start_date AND pcs.end_date
         )
        GROUP BY tc.coverage_status
    ),

    scheduled_numerators AS (
        SELECT
            CASE WHEN tc.coverage_status = 'matched'
                THEN COALESCE(
                    SUM(LEAST(
                        CASE WHEN w.no_class_week OR w.no_workshop_week
                            THEN 0 ELSE w.scheduled_workshop END,
                        COALESCE(week_attendance.workshops_attended, 0)
                    )), 0
                )::BIGINT
                ELSE NULL::BIGINT
            END AS workshops_attended,
            CASE WHEN tc.coverage_status = 'matched'
                THEN COALESCE(
                    SUM(LEAST(
                        CASE WHEN w.no_class_week
                            THEN 0 ELSE w.scheduled_mentoring END,
                        COALESCE(week_attendance.mentoring_attended, 0)
                    )), 0
                )::BIGINT
                ELSE NULL::BIGINT
            END AS mentoring_attended,
            CASE WHEN tc.coverage_status = 'matched'
                THEN COALESCE(
                    SUM(LEAST(
                        CASE WHEN w.no_class_week
                            THEN 0 ELSE w.scheduled_standups END,
                        COALESCE(week_attendance.standups_attended, 0)
                    )), 0
                )::BIGINT
                ELSE NULL::BIGINT
            END AS standups_attended,
            CASE WHEN tc.coverage_status = 'matched'
                THEN COALESCE(
                    SUM(LEAST(
                        CASE WHEN w.no_class_week
                            THEN 0 ELSE w.scheduled_squad_meeting END,
                        COALESCE(week_attendance.squad_meetings_attended, 0)
                    )), 0
                )::BIGINT
                ELSE NULL::BIGINT
            END AS squad_meetings_attended
        FROM target_student AS target
        CROSS JOIN target_calendar AS tc
        LEFT JOIN public.bachelor_attendance_schedule_weeks AS w
          ON w.program_id = target.program_id
         AND w.cohort_id = target.cohort_id
         AND w.timeline_date <= v_reporting_date
         AND EXISTS (
             SELECT 1
             FROM public.program_cohort_seasons AS pcs
             WHERE pcs.program_id = w.program_id
               AND pcs.cohort_id = w.cohort_id
               AND w.timeline_date BETWEEN pcs.start_date AND pcs.end_date
         )
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) FILTER (
                    WHERE bar.session_type = 'workshop'
                )::BIGINT AS workshops_attended,
                COUNT(*) FILTER (
                    WHERE bar.session_type = 'mentoring'
                )::BIGINT AS mentoring_attended,
                COUNT(*) FILTER (
                    WHERE bar.session_type = 'standup'
                )::BIGINT AS standups_attended,
                COUNT(*) FILTER (
                    WHERE bar.session_type = 'squad_meeting'
                )::BIGINT AS squad_meetings_attended
            FROM public.bachelor_attendance_records AS bar
            WHERE bar.student_id = target.id
              AND bar.program_id = target.program_id
              AND bar.cohort_id = target.cohort_id
              AND bar.session_date >= w.timeline_date
              AND bar.session_date < w.timeline_date + 7
              AND bar.session_date <= v_reporting_date
              AND bar.eligibility_status = 'eligible'
        ) AS week_attendance ON TRUE
        GROUP BY tc.coverage_status
    )

    SELECT
        cm.cohort_size,
        (target.program_id IN (
            'bd715dd5-dc5a-414a-98f9-660274fd60e0'::UUID,
            'c266131f-8e5e-4f39-9711-54523d65ea24'::UUID,
            '07bc935a-c743-4cab-b10c-a1d231eaf3e2'::UUID
        )) AS uses_ledger,

        tc.workshops,
        cm.workshops_max,
        CASE WHEN cm.workshops_max > 0
            THEN ROUND(100.0 * tc.workshops / cm.workshops_max)::INTEGER
            ELSE 0
        END,

        tc.mentoring,
        cm.mentoring_max,
        CASE WHEN cm.mentoring_max > 0
            THEN ROUND(100.0 * tc.mentoring / cm.mentoring_max)::INTEGER
            ELSE 0
        END,

        tc.standups,
        cm.standups_max,
        CASE WHEN cm.standups_max > 0
            THEN ROUND(100.0 * tc.standups / cm.standups_max)::INTEGER
            ELSE 0
        END,

        tc.squad_meetings,
        cm.squad_meetings_max,
        CASE WHEN cm.squad_meetings_max > 0
            THEN ROUND(100.0 * tc.squad_meetings / cm.squad_meetings_max)::INTEGER
            ELSE 0
        END,

        tc.overall,
        cm.overall_max,
        CASE WHEN cm.overall_max > 0
            THEN ROUND(100.0 * tc.overall / cm.overall_max)::INTEGER
            ELSE 0
        END,
        tc.actual_points,

        v_reporting_date,
        target_calendar.coverage_status,

        scheduled_numerators.workshops_attended,
        scheduled_denominators.workshops_total,
        CASE WHEN scheduled_denominators.workshops_total > 0
            THEN ROUND(
                100.0 * scheduled_numerators.workshops_attended
                / scheduled_denominators.workshops_total
            )::INTEGER
            ELSE NULL
        END,

        scheduled_numerators.mentoring_attended,
        scheduled_denominators.mentoring_total,
        CASE WHEN scheduled_denominators.mentoring_total > 0
            THEN ROUND(
                100.0 * scheduled_numerators.mentoring_attended
                / scheduled_denominators.mentoring_total
            )::INTEGER
            ELSE NULL
        END,

        scheduled_numerators.standups_attended,
        scheduled_denominators.standups_total,
        CASE WHEN scheduled_denominators.standups_total > 0
            THEN ROUND(
                100.0 * scheduled_numerators.standups_attended
                / scheduled_denominators.standups_total
            )::INTEGER
            ELSE NULL
        END,

        scheduled_numerators.squad_meetings_attended,
        scheduled_denominators.squad_meetings_total,
        CASE WHEN scheduled_denominators.squad_meetings_total > 0
            THEN ROUND(
                100.0 * scheduled_numerators.squad_meetings_attended
                / scheduled_denominators.squad_meetings_total
            )::INTEGER
            ELSE NULL
        END

    FROM target_counts AS tc
    CROSS JOIN target_student AS target
    CROSS JOIN cohort_maxima AS cm
    CROSS JOIN target_calendar
    CROSS JOIN scheduled_denominators
    CROSS JOIN scheduled_numerators;
END;
$function$;

REVOKE ALL
ON FUNCTION public.get_assessment_student_attendance_v2(UUID)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.get_assessment_student_attendance_v2(UUID)
TO authenticated, service_role;
