-- ============================================================
-- SCHEDULED MEETINGS — admin-scheduled weekly student meetings
-- Run this in Supabase SQL Editor after schema.sql and
-- new-tables-batches-3-4.sql (uses is_admin(), my_student_id(),
-- trigger_set_updated_at(), and the student_notifications table
-- defined there).
-- ============================================================

-- ── scheduled_meetings ───────────────────────────────────────
-- A recurring weekly meeting slot set by an admin. Occurrences are
-- expanded on read (see /api/student/calendar-events) rather than
-- materialized as rows, so editing a meeting instantly changes all
-- future pinned occurrences.
--
-- Scoping: program_id / cohort_id NULL = applies to everyone in
-- that dimension. Both NULL = every student, every program.
CREATE TABLE IF NOT EXISTS scheduled_meetings (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title        TEXT NOT NULL,
    description  TEXT,
    meeting_link TEXT,                 -- Zoom/Meet URL shown as the "Attend" link

    -- Weekly recurrence: 0 = Sunday … 6 = Saturday (JS Date#getDay())
    day_of_week  INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time   TIME NOT NULL,
    end_time     TIME NOT NULL,
    CHECK (end_time > start_time),

    -- Recurrence window
    starts_on    DATE NOT NULL DEFAULT CURRENT_DATE,
    ends_on      DATE,                 -- NULL = recurs indefinitely
    CHECK (ends_on IS NULL OR ends_on >= starts_on),

    -- Scoping (NULL = applies to all)
    program_id   UUID REFERENCES programs(id) ON DELETE CASCADE,
    cohort_id    UUID REFERENCES cohorts(id)  ON DELETE CASCADE,

    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_by   TEXT,                 -- admin email
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_updated_at_scheduled_meetings
    BEFORE UPDATE ON scheduled_meetings
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_sched_meetings_active   ON scheduled_meetings(is_active);
CREATE INDEX IF NOT EXISTS idx_sched_meetings_program  ON scheduled_meetings(program_id);
CREATE INDEX IF NOT EXISTS idx_sched_meetings_cohort   ON scheduled_meetings(cohort_id);
CREATE INDEX IF NOT EXISTS idx_sched_meetings_day      ON scheduled_meetings(day_of_week);

ALTER TABLE scheduled_meetings ENABLE ROW LEVEL SECURITY;

-- Admins: full CRUD
CREATE POLICY "scheduled_meetings: admin full access" ON scheduled_meetings
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- Students: read only active meetings scoped to their own program/cohort
-- (or global ones, where program_id / cohort_id is NULL)
CREATE POLICY "scheduled_meetings: student reads own scope" ON scheduled_meetings
    FOR SELECT USING (
        is_active = TRUE
        AND (
            program_id IS NULL
            OR program_id = (SELECT program_id FROM students WHERE id = my_student_id())
        )
        AND (
            cohort_id IS NULL
            OR cohort_id = (SELECT cohort_id FROM students WHERE id = my_student_id())
        )
    );

GRANT SELECT ON public.scheduled_meetings TO authenticated;
GRANT ALL ON public.scheduled_meetings TO service_role;


-- ── scheduled_meeting_notifications ─────────────────────────────
-- Dedup log: one row per (meeting, student, occurrence date) so the
-- daily reminder cron never notifies the same student twice for the
-- same meeting occurrence, even if the job runs more than once.
CREATE TABLE IF NOT EXISTS scheduled_meeting_notifications (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    meeting_id       UUID NOT NULL REFERENCES scheduled_meetings(id) ON DELETE CASCADE,
    student_id       UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    occurrence_date  DATE NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (meeting_id, student_id, occurrence_date)
);

CREATE INDEX IF NOT EXISTS idx_sched_meeting_notif_date ON scheduled_meeting_notifications(occurrence_date);

ALTER TABLE scheduled_meeting_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scheduled_meeting_notifications: admin read" ON scheduled_meeting_notifications
    FOR SELECT USING (is_admin());

GRANT ALL ON public.scheduled_meeting_notifications TO service_role;
