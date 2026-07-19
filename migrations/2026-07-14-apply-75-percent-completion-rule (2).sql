-- ============================================================
-- Backfill: apply the university's 75%-completion policy to
-- students who are already in the database.
--
-- Context: scripts/data_processor.py now marks a season
-- "completed" and advances a student's current_season_id once
-- they reach 75% (previously 100%). That fix only takes effect
-- the next time the daily scraper runs. This script applies the
-- same rule immediately to existing rows so the change doesn't
-- have to wait a day.
--
-- Safe to run more than once (idempotent).
-- Run this in the Supabase SQL editor, or via the CLI:
--   supabase db execute -f migrations/2026-07-14-apply-75-percent-completion-rule.sql
-- ============================================================

BEGIN;

-- 1. Mark any season progress row already at/above 75% as completed.
UPDATE student_season_progress
SET    is_completed = true,
       updated_at   = NOW()
WHERE  progress_percentage >= 75
  AND  is_completed = false;

-- 2. Recompute current_season_id for every student: the EARLIEST season
--    (in program order) still below 75%, considering every season in
--    their program -- including ones they haven't started yet (treated
--    as 0%), not just ones with an existing progress row. If every
--    season in the program is >= 75%, fall back to the actual last
--    season in the program.
--
--    (An earlier version of this query picked the *latest* touched
--    season below 75%, and only ever considered seasons with an
--    existing student_season_progress row. That produced wrong
--    results: a student mid-way through an earlier season could get
--    skipped to a later one they'd merely dabbled in, and a student
--    who finished every season they'd started could get stuck on the
--    last *completed* one instead of advancing to the next untouched
--    season.)
WITH full_season_progress AS (
    SELECT
        st.id AS student_id,
        se.id AS season_id,
        se.order_in_program,
        COALESCE(ssp.progress_percentage, 0) AS progress_percentage
    FROM students st
    JOIN seasons  se ON se.program_id = st.program_id
    LEFT JOIN student_season_progress ssp
           ON ssp.student_id = st.id AND ssp.season_id = se.id
    WHERE st.program_id IS NOT NULL
),
earliest_incomplete AS (
    SELECT student_id, season_id,
           ROW_NUMBER() OVER (PARTITION BY student_id ORDER BY order_in_program ASC) AS rn
    FROM full_season_progress
    WHERE progress_percentage < 75
),
last_season_overall AS (
    SELECT student_id, season_id,
           ROW_NUMBER() OVER (PARTITION BY student_id ORDER BY order_in_program DESC) AS rn
    FROM full_season_progress
),
chosen AS (
    SELECT lso.student_id,
           COALESCE(ei.season_id, lso.season_id) AS season_id
    FROM last_season_overall lso
    LEFT JOIN earliest_incomplete ei
           ON ei.student_id = lso.student_id AND ei.rn = 1
    WHERE lso.rn = 1
)
UPDATE students s
SET    current_season_id = c.season_id,
       updated_at        = NOW()
FROM   chosen c
WHERE  s.id = c.student_id
  AND  s.current_season_id IS DISTINCT FROM c.season_id;

-- 3. Recalculate On Track / At Risk / Monitor / Ahead status now that
--    current seasons have shifted for some students.
SELECT update_student_status_based_on_season_progress();

COMMIT;
