-- ============================================================
-- Bachelor's Attendance Ledger
--
-- This is separate from all Canvas Masters attendance tables.
-- It preserves source-row identity and eligibility decisions.
-- It does not modify existing student attendance counters.
-- ============================================================

CREATE TABLE public.bachelor_attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Student association is nullable for unresolved records.
    student_id UUID
        REFERENCES public.students(id) ON DELETE RESTRICT,

    -- Programme/cohort/Season assignment at import time.
    program_id UUID
        REFERENCES public.programs(id) ON DELETE RESTRICT,

    cohort_id UUID
        REFERENCES public.cohorts(id) ON DELETE RESTRICT,

    season_id UUID
        REFERENCES public.seasons(id) ON DELETE RESTRICT,

    program_cohort_season_id UUID
        REFERENCES public.program_cohort_seasons(id) ON DELETE RESTRICT,

    -- Original source identity. Row number is not a deduplication
    -- key across worksheets; the worksheet GID is part of the key.
    source_sheet_gid BIGINT NOT NULL,
    source_row_number INTEGER NOT NULL,
    source_response_key TEXT NOT NULL,

    source_submitted_at TIMESTAMPTZ,

    -- Preserve date/type/status source values for diagnostics.
    -- No form free-text responses are stored.
    source_date_raw TEXT,
    source_session_type TEXT,
    source_live_status TEXT,

    session_date DATE,

    session_type TEXT NOT NULL
        CHECK (session_type IN (
            'workshop',
            'mentoring',
            'standup',
            'squad_meeting',
            'unknown'
        )),

    live_status TEXT NOT NULL
        CHECK (live_status IN (
            'yes',
            'approved_exception',
            'blank',
            'unavailable',
            'other'
        )),

    eligibility_status TEXT NOT NULL
        CHECK (eligibility_status IN (
            'eligible',
            'excluded',
            'unresolved'
        )),

    exclusion_reason TEXT,

    points_awarded INTEGER NOT NULL DEFAULT 0
        CHECK (points_awarded IN (0, 1, 3)),

    -- Snapshot the matched schedule dates so later schedule
    -- edits do not erase the basis for the original decision.
    matched_season_start_date DATE,
    matched_season_end_date DATE,
    matched_season_is_final BOOLEAN,

    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT bachelor_attendance_source_response_key_unique
        UNIQUE (source_sheet_gid, source_response_key),

    CONSTRAINT bachelor_attendance_source_row_unique
        UNIQUE (source_sheet_gid, source_row_number),

    CONSTRAINT bachelor_attendance_source_row_number_check
        CHECK (source_row_number > 0),

    CONSTRAINT bachelor_attendance_eligibility_reason_check
        CHECK (
            (eligibility_status = 'eligible' AND exclusion_reason IS NULL)
            OR
            (eligibility_status <> 'eligible' AND exclusion_reason IS NOT NULL)
        ),

    CONSTRAINT bachelor_attendance_points_check
        CHECK (
            (
                eligibility_status = 'eligible'
                AND session_type IN ('workshop', 'mentoring')
                AND points_awarded = 3
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
        ),

    CONSTRAINT bachelor_attendance_eligible_requirements_check
        CHECK (
            eligibility_status <> 'eligible'
            OR (
                live_status IN ('yes', 'approved_exception')
                AND session_date IS NOT NULL
                AND student_id IS NOT NULL
                AND program_id IS NOT NULL
                AND cohort_id IS NOT NULL
                AND season_id IS NOT NULL
                AND program_cohort_season_id IS NOT NULL
                AND session_type IN ('workshop', 'mentoring', 'standup')
            )
        ),

    CONSTRAINT bachelor_attendance_association_completeness_check
        CHECK (
            (
                student_id IS NULL
                AND program_id IS NULL
                AND cohort_id IS NULL
            )
            OR
            (
                student_id IS NOT NULL
                AND program_id IS NOT NULL
                AND cohort_id IS NOT NULL
            )
        ),

    CONSTRAINT bachelor_attendance_schedule_pair_check
        CHECK (
            (season_id IS NULL)
            = (program_cohort_season_id IS NULL)
        ),

    CONSTRAINT bachelor_attendance_season_dates_check
        CHECK (
            (
                matched_season_start_date IS NULL
                AND matched_season_end_date IS NULL
                AND matched_season_is_final IS NULL
            )
            OR
            (
                matched_season_start_date IS NOT NULL
                AND matched_season_end_date IS NOT NULL
                AND matched_season_is_final IS NOT NULL
                AND matched_season_start_date < matched_season_end_date
            )
        )
);

COMMENT ON TABLE public.bachelor_attendance_records IS
    'Auditable Bachelor''s attendance source records and points eligibility decisions. Separate from Canvas Masters attendance.';

COMMENT ON COLUMN public.bachelor_attendance_records.source_response_key IS
    'Stable source-row identity, normally the worksheet row number represented as text. Uniqueness is scoped to worksheet GID.';

COMMENT ON COLUMN public.bachelor_attendance_records.matched_season_is_final IS
    'Snapshot indicating whether this was the uniquely latest-ending scheduled Season for the programme/cohort when assigned.';

COMMENT ON COLUMN public.bachelor_attendance_records.exclusion_reason IS
    'Machine-readable reason for exclusion or unresolved eligibility; not a form free-text response.';

-- Common query paths for dashboards and administrative diagnostics.
CREATE INDEX idx_bachelor_attendance_student_date
    ON public.bachelor_attendance_records(student_id, session_date);

CREATE INDEX idx_bachelor_attendance_season_type
    ON public.bachelor_attendance_records(season_id, session_type);

CREATE INDEX idx_bachelor_attendance_eligibility
    ON public.bachelor_attendance_records(eligibility_status, exclusion_reason);

CREATE INDEX idx_bachelor_attendance_source
    ON public.bachelor_attendance_records(source_sheet_gid, source_row_number);

-- Validate student enrolment and programme/cohort/Season consistency.
-- Date snapshots are checked when associations are first assigned or changed.
CREATE OR REPLACE FUNCTION private.validate_bachelor_attendance_associations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
    v_student_program_id UUID;
    v_student_cohort_id UUID;

    v_schedule_program_id UUID;
    v_schedule_cohort_id UUID;
    v_schedule_season_id UUID;
    v_schedule_start_date DATE;
    v_schedule_end_date DATE;

    v_latest_end_date DATE;
    v_latest_end_date_count BIGINT;
    v_assignment_changed BOOLEAN;
    v_student_association_changed BOOLEAN;
BEGIN
    v_assignment_changed := TG_OP = 'INSERT';
    v_student_association_changed := TG_OP = 'INSERT';

    IF TG_OP = 'UPDATE' THEN
        v_assignment_changed :=
            NEW.program_id IS DISTINCT FROM OLD.program_id
            OR NEW.cohort_id IS DISTINCT FROM OLD.cohort_id
            OR NEW.season_id IS DISTINCT FROM OLD.season_id
            OR NEW.program_cohort_season_id
                IS DISTINCT FROM OLD.program_cohort_season_id;

        v_student_association_changed :=
            NEW.student_id IS DISTINCT FROM OLD.student_id
            OR NEW.program_id IS DISTINCT FROM OLD.program_id
            OR NEW.cohort_id IS DISTINCT FROM OLD.cohort_id;
    END IF;

    IF NEW.student_id IS NOT NULL
       AND v_student_association_changed THEN
        SELECT s.program_id, s.cohort_id
          INTO v_student_program_id, v_student_cohort_id
          FROM public.students AS s
         WHERE s.id = NEW.student_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Bachelor attendance student % does not exist',
                NEW.student_id
                USING ERRCODE = '23503';
        END IF;

        IF v_student_program_id IS DISTINCT FROM NEW.program_id
           OR v_student_cohort_id IS DISTINCT FROM NEW.cohort_id THEN
            RAISE EXCEPTION
                'Bachelor attendance programme/cohort does not match student %',
                NEW.student_id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW.program_cohort_season_id IS NOT NULL THEN
        SELECT
            pcs.program_id,
            pcs.cohort_id,
            pcs.season_id,
            pcs.start_date,
            pcs.end_date
          INTO
            v_schedule_program_id,
            v_schedule_cohort_id,
            v_schedule_season_id,
            v_schedule_start_date,
            v_schedule_end_date
          FROM public.program_cohort_seasons AS pcs
         WHERE pcs.id = NEW.program_cohort_season_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Bachelor attendance schedule entry % does not exist',
                NEW.program_cohort_season_id
                USING ERRCODE = '23503';
        END IF;

        IF NOT EXISTS (
            SELECT 1
              FROM public.cohorts AS c
             WHERE c.id = v_schedule_cohort_id
               AND c.program_id = v_schedule_program_id
        ) THEN
            RAISE EXCEPTION
                'Bachelor attendance schedule cohort % does not belong to programme %',
                v_schedule_cohort_id,
                v_schedule_program_id
                USING ERRCODE = '23514';
        END IF;

        IF NOT EXISTS (
            SELECT 1
              FROM public.seasons AS s
             WHERE s.id = v_schedule_season_id
               AND s.program_id = v_schedule_program_id
        ) THEN
            RAISE EXCEPTION
                'Bachelor attendance schedule Season % does not belong to programme %',
                v_schedule_season_id,
                v_schedule_program_id
                USING ERRCODE = '23514';
        END IF;

        IF v_schedule_program_id IS DISTINCT FROM NEW.program_id
           OR v_schedule_cohort_id IS DISTINCT FROM NEW.cohort_id
           OR v_schedule_season_id IS DISTINCT FROM NEW.season_id THEN
            RAISE EXCEPTION
                'Bachelor attendance Season assignment does not match schedule entry %',
                NEW.program_cohort_season_id
                USING ERRCODE = '23514';
        END IF;

        IF v_assignment_changed THEN
            SELECT MAX(pcs.end_date)
              INTO v_latest_end_date
              FROM public.program_cohort_seasons AS pcs
             WHERE pcs.program_id = v_schedule_program_id
               AND pcs.cohort_id = v_schedule_cohort_id;

            SELECT COUNT(*)
              INTO v_latest_end_date_count
              FROM public.program_cohort_seasons AS pcs
             WHERE pcs.program_id = v_schedule_program_id
               AND pcs.cohort_id = v_schedule_cohort_id
               AND pcs.end_date = v_latest_end_date;

            NEW.matched_season_start_date := v_schedule_start_date;
            NEW.matched_season_end_date := v_schedule_end_date;
            NEW.matched_season_is_final :=
                (v_schedule_end_date = v_latest_end_date
                 AND v_latest_end_date_count = 1);
        ELSE
            IF NEW.matched_season_start_date
                    IS DISTINCT FROM OLD.matched_season_start_date
               OR NEW.matched_season_end_date
                    IS DISTINCT FROM OLD.matched_season_end_date
               OR NEW.matched_season_is_final
                    IS DISTINCT FROM OLD.matched_season_is_final THEN
                RAISE EXCEPTION
                    'Bachelor attendance Season snapshots cannot be changed without changing the schedule assignment'
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    ELSE
        IF v_assignment_changed THEN
            NEW.matched_season_start_date := NULL;
            NEW.matched_season_end_date := NULL;
            NEW.matched_season_is_final := NULL;
        ELSIF TG_OP = 'UPDATE' THEN
            IF NEW.matched_season_start_date
                    IS DISTINCT FROM OLD.matched_season_start_date
               OR NEW.matched_season_end_date
                    IS DISTINCT FROM OLD.matched_season_end_date
               OR NEW.matched_season_is_final
                    IS DISTINCT FROM OLD.matched_season_is_final THEN
                RAISE EXCEPTION
                    'Bachelor attendance Season snapshots require a schedule assignment'
                    USING ERRCODE = '23514';
            END IF;
        ELSIF NEW.matched_season_start_date IS NOT NULL
           OR NEW.matched_season_end_date IS NOT NULL
           OR NEW.matched_season_is_final IS NOT NULL THEN
            RAISE EXCEPTION
                'Bachelor attendance Season snapshots require a schedule assignment'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW.eligibility_status = 'eligible' THEN
        IF NEW.session_date IS NULL
           OR NEW.matched_season_start_date IS NULL
           OR NEW.matched_season_end_date IS NULL
           OR NEW.matched_season_is_final IS NULL THEN
            RAISE EXCEPTION
                'Eligible attendance requires a date and complete Season boundary snapshot'
                USING ERRCODE = '23514';
        END IF;

        IF NEW.session_date < NEW.matched_season_start_date
           OR (
                NEW.matched_season_is_final
                AND NEW.session_date > NEW.matched_season_end_date
           )
           OR (
                NOT NEW.matched_season_is_final
                AND NEW.session_date >= NEW.matched_season_end_date
           ) THEN
            RAISE EXCEPTION
                'Eligible attendance date % is outside its assigned Season boundary',
                NEW.session_date
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.validate_bachelor_attendance_associations()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS validate_bachelor_attendance_associations_insert
    ON public.bachelor_attendance_records;

CREATE TRIGGER validate_bachelor_attendance_associations_insert
    BEFORE INSERT ON public.bachelor_attendance_records
    FOR EACH ROW
    EXECUTE FUNCTION private.validate_bachelor_attendance_associations();

DROP TRIGGER IF EXISTS validate_bachelor_attendance_associations_update
    ON public.bachelor_attendance_records;

CREATE TRIGGER validate_bachelor_attendance_associations_update
    BEFORE UPDATE OF
        student_id,
        program_id,
        cohort_id,
        season_id,
        program_cohort_season_id,
        session_date,
        eligibility_status,
        matched_season_start_date,
        matched_season_end_date,
        matched_season_is_final
    ON public.bachelor_attendance_records
    FOR EACH ROW
    EXECUTE FUNCTION private.validate_bachelor_attendance_associations();

-- Keep event-level records restricted initially to administrators
-- and active Assessment Managers. Do not expose them to faculty or
-- students until that access requirement is explicitly reviewed.
CREATE OR REPLACE FUNCTION private.can_manage_bachelor_attendance()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
    SELECT public.is_admin()
        OR private.is_assessment_manager();
$function$;

REVOKE ALL ON FUNCTION private.can_manage_bachelor_attendance()
    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.can_manage_bachelor_attendance()
    TO authenticated, service_role;

-- Explicitly remove inherited/default table access before
-- granting only the permissions required below.
REVOKE ALL PRIVILEGES ON TABLE public.bachelor_attendance_records
    FROM PUBLIC, anon, authenticated;

ALTER TABLE public.bachelor_attendance_records
    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bachelor attendance: admin and assessment manager read"
    ON public.bachelor_attendance_records;

CREATE POLICY "bachelor attendance: admin and assessment manager read"
    ON public.bachelor_attendance_records
    FOR SELECT
    TO authenticated
    USING (private.can_manage_bachelor_attendance());

GRANT SELECT ON public.bachelor_attendance_records
    TO authenticated;

GRANT ALL ON public.bachelor_attendance_records
    TO service_role;

-- Automatically maintain updated_at on subsequent changes.
CREATE TRIGGER set_updated_at_bachelor_attendance_records
    BEFORE UPDATE ON public.bachelor_attendance_records
    FOR EACH ROW
    EXECUTE FUNCTION public.trigger_set_updated_at();
