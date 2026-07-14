-- ============================================================
-- Adds the column that links a scheduled_meetings row to its
-- corresponding event on the shared Google Calendar, so
-- create/update/remove on the platform can find and modify the
-- right Google event later.
--
-- Safe to run more than once (idempotent).
-- ============================================================

ALTER TABLE scheduled_meetings
    ADD COLUMN IF NOT EXISTS google_event_id TEXT;
