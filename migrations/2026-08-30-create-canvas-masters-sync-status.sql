-- ============================================================
-- Tracks "when was this last synced" for the two independent sync
-- actions on the Canvas Masters page (Canvas data, attendance sheet).
--
-- Re-syncing is always safe (everything upserts on Canvas's own IDs or
-- on email), so there's no "clear before syncing" step needed -- this
-- table exists purely to show a small "last synced: <date>" label
-- instead, so it's clear at a glance whether the data on screen is
-- fresh without needing a destructive clear/reset action.
-- ============================================================

CREATE TABLE IF NOT EXISTS canvas_masters_sync_status (
    sync_key       TEXT PRIMARY KEY,   -- 'canvas' or 'attendance'
    last_synced_at TIMESTAMPTZ NOT NULL,
    summary        JSONB
);

ALTER TABLE canvas_masters_sync_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "canvas_masters_sync_status: admin full access" ON canvas_masters_sync_status;
CREATE POLICY "canvas_masters_sync_status: admin full access"
    ON canvas_masters_sync_status FOR ALL
    USING (is_admin()) WITH CHECK (is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON canvas_masters_sync_status TO authenticated;
GRANT ALL ON canvas_masters_sync_status TO service_role;
