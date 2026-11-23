BEGIN;

CREATE OR REPLACE FUNCTION public.get_accessible_attendance_by_cohort_v2()
RETURNS TABLE (
    program_id uuid, program_name text,
    cohort_id uuid, cohort_name text,
    students_count bigint, uses_ledger boolean,
    overall_total bigint, workshop_total bigint,
    standup_total bigint, mentoring_total bigint,
    squad_meeting_total bigint, actual_points_total bigint,
    overall_max bigint, workshop_max bigint,
    standup_max bigint, mentoring_max bigint,
    squad_meeting_max bigint,
    cohort_overall_relative_pct_sum numeric,
    cohort_workshop_relative_pct_sum numeric,
    cohort_standup_relative_pct_sum numeric,
    cohort_mentoring_relative_pct_sum numeric,
    cohort_squad_meeting_relative_pct_sum numeric,
    global_overall_max bigint, global_workshop_max bigint,
    global_standup_max bigint, global_mentoring_max bigint,
    global_squad_meeting_max bigint,
    global_overall_relative_pct_sum numeric,
    global_workshop_relative_pct_sum numeric,
    global_standup_relative_pct_sum numeric,
    global_mentoring_relative_pct_sum numeric,
    global_squad_meeting_relative_pct_sum numeric,
    calendar_covered_students bigint,
    calendar_unmatched_students bigint,
    calendar_not_applicable_students bigint,
    scheduled_workshop_attended bigint,
    scheduled_workshop_total bigint,
    scheduled_workshop_percent numeric,
    scheduled_mentoring_attended bigint,
    scheduled_mentoring_total bigint,
    scheduled_mentoring_percent numeric,
    scheduled_standup_attended bigint,
    scheduled_standup_total bigint,
    scheduled_standup_percent numeric,
    scheduled_squad_meeting_attended bigint,
    scheduled_squad_meeting_total bigint,
    scheduled_squad_meeting_percent numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $function$
WITH reporting AS (
    SELECT (now() AT TIME ZONE 'Europe/Amsterdam')::date AS report_date
),
accessible_students AS (
    SELECT
        s.id AS student_id,
        s.program_id,
        p.name AS program_name,
        s.cohort_id,
        c.name AS cohort_name,
        s.workshops_attended,
        s.standup_attended,
        s.mentoring_attended,
        s.program_id IN (
            'bd715dd5-dc5a-414a-98f9-660274fd60e0'::uuid,
            'c266131f-8e5e-4f39-9711-54523d65ea24'::uuid,
            '07bc935a-c743-4cab-b10c-a1d231eaf3e2'::uuid
        ) AS uses_ledger
    FROM public.students s
    JOIN public.programs p ON p.id = s.program_id
    LEFT JOIN public.cohorts c
      ON c.id = s.cohort_id AND c.program_id = s.program_id
    WHERE auth.role() = 'service_role'
       OR private.can_access_assessment_student(s.id) IS TRUE
),
ledger_counts AS (
    SELECT
        r.student_id,
        COUNT(*)::bigint AS overall_total,
        COUNT(*) FILTER (WHERE r.session_type = 'workshop')::bigint
            AS workshop_total,
        COUNT(*) FILTER (WHERE r.session_type = 'standup')::bigint
            AS standup_total,
        COUNT(*) FILTER (WHERE r.session_type = 'mentoring')::bigint
            AS mentoring_total,
        COUNT(*) FILTER (WHERE r.session_type = 'squad_meeting')::bigint
            AS squad_meeting_total,
        COALESCE(SUM(r.points_awarded), 0)::bigint AS actual_points_total
    FROM public.bachelor_attendance_records r
    JOIN accessible_students s ON s.student_id = r.student_id
    WHERE s.uses_ledger
      AND r.eligibility_status = 'eligible'
      AND r.session_type IN (
          'workshop', 'standup', 'mentoring', 'squad_meeting'
      )
    GROUP BY r.student_id
),
student_counts AS (
    SELECT
        s.*,
        CASE WHEN s.uses_ledger THEN COALESCE(l.overall_total, 0)
          ELSE COALESCE(s.workshops_attended, 0)
             + COALESCE(s.standup_attended, 0)
             + COALESCE(s.mentoring_attended, 0)
        END::bigint AS overall_total,
        CASE WHEN s.uses_ledger THEN COALESCE(l.workshop_total, 0)
          ELSE COALESCE(s.workshops_attended, 0)
        END::bigint AS workshop_total,
        CASE WHEN s.uses_ledger THEN COALESCE(l.standup_total, 0)
          ELSE COALESCE(s.standup_attended, 0)
        END::bigint AS standup_total,
        CASE WHEN s.uses_ledger THEN COALESCE(l.mentoring_total, 0)
          ELSE COALESCE(s.mentoring_attended, 0)
        END::bigint AS mentoring_total,
        CASE WHEN s.uses_ledger THEN COALESCE(l.squad_meeting_total, 0)
          ELSE 0
        END::bigint AS squad_meeting_total,
        CASE WHEN s.uses_ledger THEN COALESCE(l.actual_points_total, 0)
          ELSE NULL
        END::bigint AS actual_points_total
    FROM accessible_students s
    LEFT JOIN ledger_counts l ON l.student_id = s.student_id
)
,
student_schedules AS (
    SELECT
        s.*,
        CASE
            WHEN NOT s.uses_ledger THEN 'not_applicable'
            WHEN cv.coverage_status = 'matched' THEN 'matched'
            ELSE 'unmatched'
        END AS calendar_status,

        CASE WHEN s.uses_ledger AND cv.coverage_status = 'matched'
            THEN COALESCE(sc.workshop_attended, 0)
            ELSE NULL
        END::bigint AS scheduled_workshop_attended,
        CASE WHEN s.uses_ledger AND cv.coverage_status = 'matched'
            THEN COALESCE(sc.workshop_total, 0)
            ELSE NULL
        END::bigint AS scheduled_workshop_total,

        CASE WHEN s.uses_ledger AND cv.coverage_status = 'matched'
            THEN COALESCE(sc.mentoring_attended, 0)
            ELSE NULL
        END::bigint AS scheduled_mentoring_attended,
        CASE WHEN s.uses_ledger AND cv.coverage_status = 'matched'
            THEN COALESCE(sc.mentoring_total, 0)
            ELSE NULL
        END::bigint AS scheduled_mentoring_total,

        CASE WHEN s.uses_ledger AND cv.coverage_status = 'matched'
            THEN COALESCE(sc.standup_attended, 0)
            ELSE NULL
        END::bigint AS scheduled_standup_attended,
        CASE WHEN s.uses_ledger AND cv.coverage_status = 'matched'
            THEN COALESCE(sc.standup_total, 0)
            ELSE NULL
        END::bigint AS scheduled_standup_total,

        CASE WHEN s.uses_ledger AND cv.coverage_status = 'matched'
            THEN COALESCE(sc.squad_attended, 0)
            ELSE NULL
        END::bigint AS scheduled_squad_meeting_attended,
        CASE WHEN s.uses_ledger AND cv.coverage_status = 'matched'
            THEN COALESCE(sc.squad_total, 0)
            ELSE NULL
        END::bigint AS scheduled_squad_meeting_total

    FROM student_counts s
    LEFT JOIN public.bachelor_attendance_schedule_coverage cv
      ON cv.program_id = s.program_id
     AND cv.cohort_id = s.cohort_id
    CROSS JOIN reporting d

    LEFT JOIN LATERAL (
        SELECT
            SUM(LEAST(
                CASE WHEN w.no_class_week OR w.no_workshop_week
                     THEN 0 ELSE w.scheduled_workshop END,
                COALESCE(a.workshop_count, 0)
            ))::bigint AS workshop_attended,
            SUM(CASE WHEN w.no_class_week OR w.no_workshop_week
                     THEN 0 ELSE w.scheduled_workshop END)::bigint
                AS workshop_total,

            SUM(LEAST(
                CASE WHEN w.no_class_week
                     THEN 0 ELSE w.scheduled_mentoring END,
                COALESCE(a.mentoring_count, 0)
            ))::bigint AS mentoring_attended,
            SUM(CASE WHEN w.no_class_week
                     THEN 0 ELSE w.scheduled_mentoring END)::bigint
                AS mentoring_total,

            SUM(LEAST(
                CASE WHEN w.no_class_week
                     THEN 0 ELSE w.scheduled_standups END,
                COALESCE(a.standup_count, 0)
            ))::bigint AS standup_attended,
            SUM(CASE WHEN w.no_class_week
                     THEN 0 ELSE w.scheduled_standups END)::bigint
                AS standup_total,

            SUM(LEAST(
                CASE WHEN w.no_class_week
                     THEN 0 ELSE w.scheduled_squad_meeting END,
                COALESCE(a.squad_count, 0)
            ))::bigint AS squad_attended,
            SUM(CASE WHEN w.no_class_week
                     THEN 0 ELSE w.scheduled_squad_meeting END)::bigint
                AS squad_total

        FROM public.bachelor_attendance_schedule_weeks w

        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) FILTER (
                    WHERE r.session_type = 'workshop'
                )::bigint AS workshop_count,
                COUNT(*) FILTER (
                    WHERE r.session_type = 'mentoring'
                )::bigint AS mentoring_count,
                COUNT(*) FILTER (
                    WHERE r.session_type = 'standup'
                )::bigint AS standup_count,
                COUNT(*) FILTER (
                    WHERE r.session_type = 'squad_meeting'
                )::bigint AS squad_count
            FROM public.bachelor_attendance_records r
            WHERE r.student_id = s.student_id
              AND r.program_id = s.program_id
              AND r.cohort_id = s.cohort_id
              AND r.eligibility_status = 'eligible'
              AND r.session_date >= w.timeline_date
              AND r.session_date < w.timeline_date + 7
              AND r.session_date <= d.report_date
        ) a ON TRUE

        WHERE w.program_id = s.program_id
          AND w.cohort_id = s.cohort_id
          AND w.timeline_date <= d.report_date
          AND EXISTS (
              SELECT 1
              FROM public.program_cohort_seasons pcs
              WHERE pcs.program_id = w.program_id
                AND pcs.cohort_id = w.cohort_id
                AND w.timeline_date >= pcs.start_date
                AND w.timeline_date <= pcs.end_date
          )
    ) sc ON s.uses_ledger AND cv.coverage_status = 'matched'
),
benchmarked AS (
    SELECT
        s.*,
        MAX(s.overall_total) OVER (
            PARTITION BY s.program_id, s.cohort_id
        ) AS cohort_overall_max,
        MAX(s.workshop_total) OVER (
            PARTITION BY s.program_id, s.cohort_id
        ) AS cohort_workshop_max,
        MAX(s.standup_total) OVER (
            PARTITION BY s.program_id, s.cohort_id
        ) AS cohort_standup_max,
        MAX(s.mentoring_total) OVER (
            PARTITION BY s.program_id, s.cohort_id
        ) AS cohort_mentoring_max,
        MAX(s.squad_meeting_total) OVER (
            PARTITION BY s.program_id, s.cohort_id
        ) AS cohort_squad_meeting_max,

        MAX(s.overall_total) OVER () AS global_overall_max,
        MAX(s.workshop_total) OVER () AS global_workshop_max,
        MAX(s.standup_total) OVER () AS global_standup_max,
        MAX(s.mentoring_total) OVER () AS global_mentoring_max,
        MAX(s.squad_meeting_total) OVER () AS global_squad_meeting_max
    FROM student_schedules s
)
SELECT
    b.program_id,
    b.program_name,
    b.cohort_id,
    b.cohort_name,
    COUNT(*)::bigint,
    BOOL_AND(b.uses_ledger),

    SUM(b.overall_total)::bigint,
    SUM(b.workshop_total)::bigint,
    SUM(b.standup_total)::bigint,
    SUM(b.mentoring_total)::bigint,
    SUM(b.squad_meeting_total)::bigint,
    CASE WHEN BOOL_AND(b.uses_ledger)
         THEN SUM(b.actual_points_total)::bigint
         ELSE NULL
    END,

    MAX(b.cohort_overall_max)::bigint,
    MAX(b.cohort_workshop_max)::bigint,
    MAX(b.cohort_standup_max)::bigint,
    MAX(b.cohort_mentoring_max)::bigint,
    MAX(b.cohort_squad_meeting_max)::bigint,

    SUM(CASE WHEN b.cohort_overall_max > 0
        THEN b.overall_total::numeric * 100 / b.cohort_overall_max
        ELSE 0 END),
    SUM(CASE WHEN b.cohort_workshop_max > 0
        THEN b.workshop_total::numeric * 100 / b.cohort_workshop_max
        ELSE 0 END),
    SUM(CASE WHEN b.cohort_standup_max > 0
        THEN b.standup_total::numeric * 100 / b.cohort_standup_max
        ELSE 0 END),
    SUM(CASE WHEN b.cohort_mentoring_max > 0
        THEN b.mentoring_total::numeric * 100 / b.cohort_mentoring_max
        ELSE 0 END),
    SUM(CASE WHEN b.cohort_squad_meeting_max > 0
        THEN b.squad_meeting_total::numeric * 100 / b.cohort_squad_meeting_max
        ELSE 0 END),

    MAX(b.global_overall_max)::bigint,
    MAX(b.global_workshop_max)::bigint,
    MAX(b.global_standup_max)::bigint,
    MAX(b.global_mentoring_max)::bigint,
    MAX(b.global_squad_meeting_max)::bigint,

    SUM(CASE WHEN b.global_overall_max > 0
        THEN b.overall_total::numeric * 100 / b.global_overall_max
        ELSE 0 END),
    SUM(CASE WHEN b.global_workshop_max > 0
        THEN b.workshop_total::numeric * 100 / b.global_workshop_max
        ELSE 0 END),
    SUM(CASE WHEN b.global_standup_max > 0
        THEN b.standup_total::numeric * 100 / b.global_standup_max
        ELSE 0 END),
    SUM(CASE WHEN b.global_mentoring_max > 0
        THEN b.mentoring_total::numeric * 100 / b.global_mentoring_max
        ELSE 0 END),
    SUM(CASE WHEN b.global_squad_meeting_max > 0
        THEN b.squad_meeting_total::numeric * 100 / b.global_squad_meeting_max
        ELSE 0 END),

    COUNT(*) FILTER (
        WHERE b.calendar_status = 'matched'
    )::bigint,
    COUNT(*) FILTER (
        WHERE b.calendar_status = 'unmatched'
    )::bigint,
    COUNT(*) FILTER (
        WHERE b.calendar_status = 'not_applicable'
    )::bigint,

    SUM(b.scheduled_workshop_attended)::bigint,
    SUM(b.scheduled_workshop_total)::bigint,
    CASE WHEN SUM(b.scheduled_workshop_total) > 0
        THEN SUM(b.scheduled_workshop_attended)::numeric * 100
             / SUM(b.scheduled_workshop_total)
        ELSE NULL
    END,

    SUM(b.scheduled_mentoring_attended)::bigint,
    SUM(b.scheduled_mentoring_total)::bigint,
    CASE WHEN SUM(b.scheduled_mentoring_total) > 0
        THEN SUM(b.scheduled_mentoring_attended)::numeric * 100
             / SUM(b.scheduled_mentoring_total)
        ELSE NULL
    END,

    SUM(b.scheduled_standup_attended)::bigint,
    SUM(b.scheduled_standup_total)::bigint,
    CASE WHEN SUM(b.scheduled_standup_total) > 0
        THEN SUM(b.scheduled_standup_attended)::numeric * 100
             / SUM(b.scheduled_standup_total)
        ELSE NULL
    END,

    SUM(b.scheduled_squad_meeting_attended)::bigint,
    SUM(b.scheduled_squad_meeting_total)::bigint,
    CASE WHEN SUM(b.scheduled_squad_meeting_total) > 0
        THEN SUM(b.scheduled_squad_meeting_attended)::numeric * 100
             / SUM(b.scheduled_squad_meeting_total)
        ELSE NULL
    END

FROM benchmarked b
GROUP BY
    b.program_id,
    b.program_name,
    b.cohort_id,
    b.cohort_name
ORDER BY
    b.program_name,
    b.cohort_name;

$function$;

REVOKE ALL ON FUNCTION public.get_accessible_attendance_by_cohort_v2()
    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_accessible_attendance_by_cohort_v2()
    TO authenticated, service_role;

COMMENT ON FUNCTION public.get_accessible_attendance_by_cohort_v2() IS
'Aggregate-only attendance reporting by programme and cohort. Enforces per-student access, separates Bachelor ledger points from legacy counters, and reports calendar-covered scheduled attendance without treating unmatched coverage as zero.';

COMMIT;
