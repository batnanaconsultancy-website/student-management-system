-- ============================================================
-- Populates program_cohort_seasons with the real season start/end
-- dates per program per cohort, sourced from the "Student DATA -
-- Student Timelines" spreadsheet. This is what the Timeline page's
-- pins actually read from -- until this runs, any program/cohort
-- combination missing a row here shows the "No schedule is
-- configured..." warning (or previously, a silently blank timeline).
--
-- Software Engineering has 6 seasons per cohort (Preseason, Season 01
-- Arc 01, Season 01 Arc 02, Season 02, Season 03, Final Project).
-- AI/ML and Data Science have only 5 (no "Season 01 Arc 02" -- this
-- matches the "Skipping season 'Season 01 Arc 02' - not found in
-- program X" messages already seen in the scraper logs for those
-- programs). Seasons are matched by their position (order_in_program)
-- within each program, not by name, so this works correctly even
-- though the two programs have different season counts.
--
-- Safe to re-run: upserts on the (program_id, cohort_id, season_id)
-- unique constraint.
-- ============================================================

WITH season_dates (program_name, cohort_name, position, start_date, end_date) AS (
    VALUES
    ('Software Engineering', 'Mar 2026', 1, '2026-03-23'::date, '2026-07-06'::date),
    ('Software Engineering', 'Mar 2026', 2, '2026-07-06'::date, '2026-11-16'::date),
    ('Software Engineering', 'Mar 2026', 3, '2026-11-16'::date, '2027-04-05'::date),
    ('Software Engineering', 'Mar 2026', 4, '2027-04-05'::date, '2028-01-31'::date),
    ('Software Engineering', 'Mar 2026', 5, '2028-01-31'::date, '2028-12-04'::date),
    ('Software Engineering', 'Mar 2026', 6, '2028-12-04'::date, '2029-07-09'::date),
    ('Software Engineering', 'Sep 2025', 1, '2025-09-22'::date, '2026-01-05'::date),
    ('Software Engineering', 'Sep 2025', 2, '2026-01-05'::date, '2026-05-18'::date),
    ('Software Engineering', 'Sep 2025', 3, '2026-05-18'::date, '2026-10-05'::date),
    ('Software Engineering', 'Sep 2025', 4, '2026-10-05'::date, '2027-08-02'::date),
    ('Software Engineering', 'Sep 2025', 5, '2027-08-02'::date, '2028-05-15'::date),
    ('Software Engineering', 'Sep 2025', 6, '2028-05-15'::date, '2029-01-08'::date),
    ('Software Engineering', 'Mar 2025', 1, '2025-03-24'::date, '2025-06-16'::date),
    ('Software Engineering', 'Mar 2025', 2, '2025-06-16'::date, '2025-10-13'::date),
    ('Software Engineering', 'Mar 2025', 3, '2025-10-13'::date, '2026-03-16'::date),
    ('Software Engineering', 'Mar 2025', 4, '2026-03-16'::date, '2027-01-11'::date),
    ('Software Engineering', 'Mar 2025', 5, '2027-01-11'::date, '2027-11-15'::date),
    ('Software Engineering', 'Mar 2025', 6, '2027-11-15'::date, '2028-07-17'::date),
    ('Software Engineering', 'Sep 2024', 1, '2024-09-16'::date, '2024-12-30'::date),
    ('Software Engineering', 'Sep 2024', 2, '2024-12-30'::date, '2025-04-14'::date),
    ('Software Engineering', 'Sep 2024', 3, '2025-04-14'::date, '2025-09-29'::date),
    ('Software Engineering', 'Sep 2024', 4, '2025-09-29'::date, '2026-07-27'::date),
    ('Software Engineering', 'Sep 2024', 5, '2026-07-27'::date, '2027-06-14'::date),
    ('Software Engineering', 'Sep 2024', 6, '2027-06-14'::date, '2028-01-17'::date),
    ('Software Engineering', 'Mar 2024', 1, '2024-03-25'::date, '2024-07-08'::date),
    ('Software Engineering', 'Mar 2024', 2, '2024-07-08'::date, '2024-10-21'::date),
    ('Software Engineering', 'Mar 2024', 3, '2024-10-21'::date, '2025-04-07'::date),
    ('Software Engineering', 'Mar 2024', 4, '2025-04-07'::date, '2026-02-02'::date),
    ('Software Engineering', 'Mar 2024', 5, '2026-02-02'::date, '2026-12-14'::date),
    ('Software Engineering', 'Mar 2024', 6, '2026-12-14'::date, '2027-07-26'::date),
    ('Software Engineering', 'Sep 2023', 1, '2023-09-18'::date, '2024-01-01'::date),
    ('Software Engineering', 'Sep 2023', 2, '2024-01-01'::date, '2024-04-15'::date),
    ('Software Engineering', 'Sep 2023', 3, '2024-04-15'::date, '2024-09-23'::date),
    ('Software Engineering', 'Sep 2023', 4, '2024-09-23'::date, '2025-07-21'::date),
    ('Software Engineering', 'Sep 2023', 5, '2025-07-21'::date, '2026-06-15'::date),
    ('Software Engineering', 'Sep 2023', 6, '2026-06-15'::date, '2027-01-25'::date),
    ('Software Engineering', 'Mar 2023', 1, '2023-03-20'::date, '2023-07-03'::date),
    ('Software Engineering', 'Mar 2023', 2, '2023-07-03'::date, '2023-10-16'::date),
    ('Software Engineering', 'Mar 2023', 3, '2023-10-16'::date, '2024-03-25'::date),
    ('Software Engineering', 'Mar 2023', 4, '2024-03-25'::date, '2025-01-20'::date),
    ('Software Engineering', 'Mar 2023', 5, '2025-01-20'::date, '2025-12-15'::date),
    ('Software Engineering', 'Mar 2023', 6, '2025-12-15'::date, '2026-07-27'::date),
    ('AI/ML', 'Mar 2026', 1, '2026-03-23'::date, '2026-07-13'::date),
    ('AI/ML', 'Mar 2026', 2, '2026-07-13'::date, '2027-01-04'::date),
    ('AI/ML', 'Mar 2026', 3, '2027-01-04'::date, '2027-12-27'::date),
    ('AI/ML', 'Mar 2026', 4, '2027-12-27'::date, '2028-12-04'::date),
    ('AI/ML', 'Mar 2026', 5, '2028-12-04'::date, '2029-07-09'::date),
    ('AI/ML', 'Sep 2025', 1, '2025-09-22'::date, '2026-01-12'::date),
    ('AI/ML', 'Sep 2025', 2, '2026-01-12'::date, '2026-07-06'::date),
    ('AI/ML', 'Sep 2025', 3, '2026-07-06'::date, '2027-06-28'::date),
    ('AI/ML', 'Sep 2025', 4, '2027-06-28'::date, '2028-05-15'::date),
    ('AI/ML', 'Sep 2025', 5, '2028-05-15'::date, '2029-01-08'::date),
    ('AI/ML', 'Mar 2025', 1, '2025-03-24'::date, '2025-06-23'::date),
    ('AI/ML', 'Mar 2025', 2, '2025-06-23'::date, '2025-12-15'::date),
    ('AI/ML', 'Mar 2025', 3, '2025-12-15'::date, '2026-12-14'::date),
    ('AI/ML', 'Mar 2025', 4, '2026-12-14'::date, '2027-11-15'::date),
    ('AI/ML', 'Mar 2025', 5, '2027-11-15'::date, '2028-07-17'::date),
    ('AI/ML', 'Sep 2024', 1, '2024-09-16'::date, '2025-01-06'::date),
    ('AI/ML', 'Sep 2024', 2, '2025-01-06'::date, '2025-07-07'::date),
    ('AI/ML', 'Sep 2024', 3, '2025-07-07'::date, '2026-07-06'::date),
    ('AI/ML', 'Sep 2024', 4, '2026-07-06'::date, '2027-06-14'::date),
    ('AI/ML', 'Sep 2024', 5, '2027-06-14'::date, '2028-01-17'::date),
    ('AI/ML', 'Mar 2024', 1, '2024-03-25'::date, '2024-07-22'::date),
    ('AI/ML', 'Mar 2024', 2, '2024-07-22'::date, '2025-01-13'::date),
    ('AI/ML', 'Mar 2024', 3, '2025-01-13'::date, '2026-01-12'::date),
    ('AI/ML', 'Mar 2024', 4, '2026-01-12'::date, '2026-12-14'::date),
    ('AI/ML', 'Mar 2024', 5, '2026-12-14'::date, '2027-07-26'::date),
    ('AI/ML', 'Sep 2023', 1, '2023-09-18'::date, '2024-01-22'::date),
    ('AI/ML', 'Sep 2023', 2, '2024-01-22'::date, '2024-07-15'::date),
    ('AI/ML', 'Sep 2023', 3, '2024-07-15'::date, '2025-07-14'::date),
    ('AI/ML', 'Sep 2023', 4, '2025-07-14'::date, '2026-06-15'::date),
    ('AI/ML', 'Sep 2023', 5, '2026-06-15'::date, '2027-01-25'::date),
    ('AI/ML', 'Mar 2023', 1, '2023-03-20'::date, '2023-07-24'::date),
    ('AI/ML', 'Mar 2023', 2, '2023-07-24'::date, '2024-01-15'::date),
    ('AI/ML', 'Mar 2023', 3, '2024-01-15'::date, '2025-01-13'::date),
    ('AI/ML', 'Mar 2023', 4, '2025-01-13'::date, '2025-12-15'::date),
    ('AI/ML', 'Mar 2023', 5, '2025-12-15'::date, '2026-07-27'::date),
    ('Data Science', 'Mar 2026', 1, '2026-03-23'::date, '2026-07-13'::date),
    ('Data Science', 'Mar 2026', 2, '2026-07-13'::date, '2027-01-04'::date),
    ('Data Science', 'Mar 2026', 3, '2027-01-04'::date, '2027-12-27'::date),
    ('Data Science', 'Mar 2026', 4, '2027-12-27'::date, '2028-12-04'::date),
    ('Data Science', 'Mar 2026', 5, '2028-12-04'::date, '2029-07-09'::date),
    ('Data Science', 'Sep 2025', 1, '2025-09-22'::date, '2026-01-12'::date),
    ('Data Science', 'Sep 2025', 2, '2026-01-12'::date, '2026-07-06'::date),
    ('Data Science', 'Sep 2025', 3, '2026-07-06'::date, '2027-06-28'::date),
    ('Data Science', 'Sep 2025', 4, '2027-06-28'::date, '2028-05-15'::date),
    ('Data Science', 'Sep 2025', 5, '2028-05-15'::date, '2029-01-08'::date),
    ('Data Science', 'Mar 2025', 1, '2025-03-24'::date, '2025-06-23'::date),
    ('Data Science', 'Mar 2025', 2, '2025-06-23'::date, '2025-12-15'::date),
    ('Data Science', 'Mar 2025', 3, '2025-12-15'::date, '2026-12-14'::date),
    ('Data Science', 'Mar 2025', 4, '2026-12-14'::date, '2027-11-15'::date),
    ('Data Science', 'Mar 2025', 5, '2027-11-15'::date, '2028-07-17'::date),
    ('Data Science', 'Sep 2024', 1, '2024-09-16'::date, '2025-01-06'::date),
    ('Data Science', 'Sep 2024', 2, '2025-01-06'::date, '2025-07-07'::date),
    ('Data Science', 'Sep 2024', 3, '2025-07-07'::date, '2026-07-06'::date),
    ('Data Science', 'Sep 2024', 4, '2026-07-06'::date, '2027-06-14'::date),
    ('Data Science', 'Sep 2024', 5, '2027-06-14'::date, '2028-01-17'::date),
    ('Data Science', 'Mar 2024', 1, '2024-03-25'::date, '2024-07-22'::date),
    ('Data Science', 'Mar 2024', 2, '2024-07-22'::date, '2025-01-13'::date),
    ('Data Science', 'Mar 2024', 3, '2025-01-13'::date, '2026-01-12'::date),
    ('Data Science', 'Mar 2024', 4, '2026-01-12'::date, '2026-12-14'::date),
    ('Data Science', 'Mar 2024', 5, '2026-12-14'::date, '2027-07-26'::date),
    ('Data Science', 'Sep 2023', 1, '2023-09-18'::date, '2024-01-22'::date),
    ('Data Science', 'Sep 2023', 2, '2024-01-22'::date, '2024-07-15'::date),
    ('Data Science', 'Sep 2023', 3, '2024-07-15'::date, '2025-07-14'::date),
    ('Data Science', 'Sep 2023', 4, '2025-07-14'::date, '2026-06-15'::date),
    ('Data Science', 'Sep 2023', 5, '2026-06-15'::date, '2027-01-25'::date),
    ('Data Science', 'Mar 2023', 1, '2023-03-20'::date, '2023-07-24'::date),
    ('Data Science', 'Mar 2023', 2, '2023-07-24'::date, '2024-01-15'::date),
    ('Data Science', 'Mar 2023', 3, '2024-01-15'::date, '2025-01-13'::date),
    ('Data Science', 'Mar 2023', 4, '2025-01-13'::date, '2025-12-15'::date),
    ('Data Science', 'Mar 2023', 5, '2025-12-15'::date, '2026-07-27'::date)
),
ordered_seasons AS (
    SELECT
        se.id AS season_id,
        se.program_id,
        p.name AS program_name,
        ROW_NUMBER() OVER (PARTITION BY se.program_id ORDER BY se.order_in_program) AS position
    FROM seasons se
    JOIN programs p ON p.id = se.program_id
),
resolved AS (
    SELECT
        os.program_id,
        c.id AS cohort_id,
        os.season_id,
        sd.start_date,
        sd.end_date,
        sd.program_name,
        sd.cohort_name,
        sd.position
    FROM season_dates sd
    JOIN ordered_seasons os
      ON os.program_name = sd.program_name AND os.position = sd.position
    JOIN cohorts c ON c.name = sd.cohort_name
)
INSERT INTO program_cohort_seasons (program_id, cohort_id, season_id, start_date, end_date)
SELECT program_id, cohort_id, season_id, start_date, end_date
FROM resolved
ON CONFLICT (program_id, cohort_id, season_id)
DO UPDATE SET start_date = EXCLUDED.start_date,
              end_date   = EXCLUDED.end_date;

-- ============================================================
-- Verification: run these after the upsert above.
-- ============================================================

-- Should show 112 (7 cohorts x 6 seasons for Software Engineering,
-- + 7 cohorts x 5 seasons each for AI/ML and Data Science).
-- If it's less than 112, some (program_name, cohort_name, position)
-- combination above didn't find a matching program/cohort/season row --
-- check for a program or cohort name mismatch against your actual
-- `programs.name` / `cohorts.name` values.
WITH season_dates (program_name, cohort_name, position, start_date, end_date) AS (
    VALUES
    ('Software Engineering', 'Mar 2026', 1, '2026-03-23'::date, '2026-07-06'::date),
    ('Software Engineering', 'Mar 2026', 2, '2026-07-06'::date, '2026-11-16'::date),
    ('Software Engineering', 'Mar 2026', 3, '2026-11-16'::date, '2027-04-05'::date),
    ('Software Engineering', 'Mar 2026', 4, '2027-04-05'::date, '2028-01-31'::date),
    ('Software Engineering', 'Mar 2026', 5, '2028-01-31'::date, '2028-12-04'::date),
    ('Software Engineering', 'Mar 2026', 6, '2028-12-04'::date, '2029-07-09'::date),
    ('Software Engineering', 'Sep 2025', 1, '2025-09-22'::date, '2026-01-05'::date),
    ('Software Engineering', 'Sep 2025', 2, '2026-01-05'::date, '2026-05-18'::date),
    ('Software Engineering', 'Sep 2025', 3, '2026-05-18'::date, '2026-10-05'::date),
    ('Software Engineering', 'Sep 2025', 4, '2026-10-05'::date, '2027-08-02'::date),
    ('Software Engineering', 'Sep 2025', 5, '2027-08-02'::date, '2028-05-15'::date),
    ('Software Engineering', 'Sep 2025', 6, '2028-05-15'::date, '2029-01-08'::date),
    ('Software Engineering', 'Mar 2025', 1, '2025-03-24'::date, '2025-06-16'::date),
    ('Software Engineering', 'Mar 2025', 2, '2025-06-16'::date, '2025-10-13'::date),
    ('Software Engineering', 'Mar 2025', 3, '2025-10-13'::date, '2026-03-16'::date),
    ('Software Engineering', 'Mar 2025', 4, '2026-03-16'::date, '2027-01-11'::date),
    ('Software Engineering', 'Mar 2025', 5, '2027-01-11'::date, '2027-11-15'::date),
    ('Software Engineering', 'Mar 2025', 6, '2027-11-15'::date, '2028-07-17'::date),
    ('Software Engineering', 'Sep 2024', 1, '2024-09-16'::date, '2024-12-30'::date),
    ('Software Engineering', 'Sep 2024', 2, '2024-12-30'::date, '2025-04-14'::date),
    ('Software Engineering', 'Sep 2024', 3, '2025-04-14'::date, '2025-09-29'::date),
    ('Software Engineering', 'Sep 2024', 4, '2025-09-29'::date, '2026-07-27'::date),
    ('Software Engineering', 'Sep 2024', 5, '2026-07-27'::date, '2027-06-14'::date),
    ('Software Engineering', 'Sep 2024', 6, '2027-06-14'::date, '2028-01-17'::date),
    ('Software Engineering', 'Mar 2024', 1, '2024-03-25'::date, '2024-07-08'::date),
    ('Software Engineering', 'Mar 2024', 2, '2024-07-08'::date, '2024-10-21'::date),
    ('Software Engineering', 'Mar 2024', 3, '2024-10-21'::date, '2025-04-07'::date),
    ('Software Engineering', 'Mar 2024', 4, '2025-04-07'::date, '2026-02-02'::date),
    ('Software Engineering', 'Mar 2024', 5, '2026-02-02'::date, '2026-12-14'::date),
    ('Software Engineering', 'Mar 2024', 6, '2026-12-14'::date, '2027-07-26'::date),
    ('Software Engineering', 'Sep 2023', 1, '2023-09-18'::date, '2024-01-01'::date),
    ('Software Engineering', 'Sep 2023', 2, '2024-01-01'::date, '2024-04-15'::date),
    ('Software Engineering', 'Sep 2023', 3, '2024-04-15'::date, '2024-09-23'::date),
    ('Software Engineering', 'Sep 2023', 4, '2024-09-23'::date, '2025-07-21'::date),
    ('Software Engineering', 'Sep 2023', 5, '2025-07-21'::date, '2026-06-15'::date),
    ('Software Engineering', 'Sep 2023', 6, '2026-06-15'::date, '2027-01-25'::date),
    ('Software Engineering', 'Mar 2023', 1, '2023-03-20'::date, '2023-07-03'::date),
    ('Software Engineering', 'Mar 2023', 2, '2023-07-03'::date, '2023-10-16'::date),
    ('Software Engineering', 'Mar 2023', 3, '2023-10-16'::date, '2024-03-25'::date),
    ('Software Engineering', 'Mar 2023', 4, '2024-03-25'::date, '2025-01-20'::date),
    ('Software Engineering', 'Mar 2023', 5, '2025-01-20'::date, '2025-12-15'::date),
    ('Software Engineering', 'Mar 2023', 6, '2025-12-15'::date, '2026-07-27'::date),
    ('AI/ML', 'Mar 2026', 1, '2026-03-23'::date, '2026-07-13'::date),
    ('AI/ML', 'Mar 2026', 2, '2026-07-13'::date, '2027-01-04'::date),
    ('AI/ML', 'Mar 2026', 3, '2027-01-04'::date, '2027-12-27'::date),
    ('AI/ML', 'Mar 2026', 4, '2027-12-27'::date, '2028-12-04'::date),
    ('AI/ML', 'Mar 2026', 5, '2028-12-04'::date, '2029-07-09'::date),
    ('AI/ML', 'Sep 2025', 1, '2025-09-22'::date, '2026-01-12'::date),
    ('AI/ML', 'Sep 2025', 2, '2026-01-12'::date, '2026-07-06'::date),
    ('AI/ML', 'Sep 2025', 3, '2026-07-06'::date, '2027-06-28'::date),
    ('AI/ML', 'Sep 2025', 4, '2027-06-28'::date, '2028-05-15'::date),
    ('AI/ML', 'Sep 2025', 5, '2028-05-15'::date, '2029-01-08'::date),
    ('AI/ML', 'Mar 2025', 1, '2025-03-24'::date, '2025-06-23'::date),
    ('AI/ML', 'Mar 2025', 2, '2025-06-23'::date, '2025-12-15'::date),
    ('AI/ML', 'Mar 2025', 3, '2025-12-15'::date, '2026-12-14'::date),
    ('AI/ML', 'Mar 2025', 4, '2026-12-14'::date, '2027-11-15'::date),
    ('AI/ML', 'Mar 2025', 5, '2027-11-15'::date, '2028-07-17'::date),
    ('AI/ML', 'Sep 2024', 1, '2024-09-16'::date, '2025-01-06'::date),
    ('AI/ML', 'Sep 2024', 2, '2025-01-06'::date, '2025-07-07'::date),
    ('AI/ML', 'Sep 2024', 3, '2025-07-07'::date, '2026-07-06'::date),
    ('AI/ML', 'Sep 2024', 4, '2026-07-06'::date, '2027-06-14'::date),
    ('AI/ML', 'Sep 2024', 5, '2027-06-14'::date, '2028-01-17'::date),
    ('AI/ML', 'Mar 2024', 1, '2024-03-25'::date, '2024-07-22'::date),
    ('AI/ML', 'Mar 2024', 2, '2024-07-22'::date, '2025-01-13'::date),
    ('AI/ML', 'Mar 2024', 3, '2025-01-13'::date, '2026-01-12'::date),
    ('AI/ML', 'Mar 2024', 4, '2026-01-12'::date, '2026-12-14'::date),
    ('AI/ML', 'Mar 2024', 5, '2026-12-14'::date, '2027-07-26'::date),
    ('AI/ML', 'Sep 2023', 1, '2023-09-18'::date, '2024-01-22'::date),
    ('AI/ML', 'Sep 2023', 2, '2024-01-22'::date, '2024-07-15'::date),
    ('AI/ML', 'Sep 2023', 3, '2024-07-15'::date, '2025-07-14'::date),
    ('AI/ML', 'Sep 2023', 4, '2025-07-14'::date, '2026-06-15'::date),
    ('AI/ML', 'Sep 2023', 5, '2026-06-15'::date, '2027-01-25'::date),
    ('AI/ML', 'Mar 2023', 1, '2023-03-20'::date, '2023-07-24'::date),
    ('AI/ML', 'Mar 2023', 2, '2023-07-24'::date, '2024-01-15'::date),
    ('AI/ML', 'Mar 2023', 3, '2024-01-15'::date, '2025-01-13'::date),
    ('AI/ML', 'Mar 2023', 4, '2025-01-13'::date, '2025-12-15'::date),
    ('AI/ML', 'Mar 2023', 5, '2025-12-15'::date, '2026-07-27'::date),
    ('Data Science', 'Mar 2026', 1, '2026-03-23'::date, '2026-07-13'::date),
    ('Data Science', 'Mar 2026', 2, '2026-07-13'::date, '2027-01-04'::date),
    ('Data Science', 'Mar 2026', 3, '2027-01-04'::date, '2027-12-27'::date),
    ('Data Science', 'Mar 2026', 4, '2027-12-27'::date, '2028-12-04'::date),
    ('Data Science', 'Mar 2026', 5, '2028-12-04'::date, '2029-07-09'::date),
    ('Data Science', 'Sep 2025', 1, '2025-09-22'::date, '2026-01-12'::date),
    ('Data Science', 'Sep 2025', 2, '2026-01-12'::date, '2026-07-06'::date),
    ('Data Science', 'Sep 2025', 3, '2026-07-06'::date, '2027-06-28'::date),
    ('Data Science', 'Sep 2025', 4, '2027-06-28'::date, '2028-05-15'::date),
    ('Data Science', 'Sep 2025', 5, '2028-05-15'::date, '2029-01-08'::date),
    ('Data Science', 'Mar 2025', 1, '2025-03-24'::date, '2025-06-23'::date),
    ('Data Science', 'Mar 2025', 2, '2025-06-23'::date, '2025-12-15'::date),
    ('Data Science', 'Mar 2025', 3, '2025-12-15'::date, '2026-12-14'::date),
    ('Data Science', 'Mar 2025', 4, '2026-12-14'::date, '2027-11-15'::date),
    ('Data Science', 'Mar 2025', 5, '2027-11-15'::date, '2028-07-17'::date),
    ('Data Science', 'Sep 2024', 1, '2024-09-16'::date, '2025-01-06'::date),
    ('Data Science', 'Sep 2024', 2, '2025-01-06'::date, '2025-07-07'::date),
    ('Data Science', 'Sep 2024', 3, '2025-07-07'::date, '2026-07-06'::date),
    ('Data Science', 'Sep 2024', 4, '2026-07-06'::date, '2027-06-14'::date),
    ('Data Science', 'Sep 2024', 5, '2027-06-14'::date, '2028-01-17'::date),
    ('Data Science', 'Mar 2024', 1, '2024-03-25'::date, '2024-07-22'::date),
    ('Data Science', 'Mar 2024', 2, '2024-07-22'::date, '2025-01-13'::date),
    ('Data Science', 'Mar 2024', 3, '2025-01-13'::date, '2026-01-12'::date),
    ('Data Science', 'Mar 2024', 4, '2026-01-12'::date, '2026-12-14'::date),
    ('Data Science', 'Mar 2024', 5, '2026-12-14'::date, '2027-07-26'::date),
    ('Data Science', 'Sep 2023', 1, '2023-09-18'::date, '2024-01-22'::date),
    ('Data Science', 'Sep 2023', 2, '2024-01-22'::date, '2024-07-15'::date),
    ('Data Science', 'Sep 2023', 3, '2024-07-15'::date, '2025-07-14'::date),
    ('Data Science', 'Sep 2023', 4, '2025-07-14'::date, '2026-06-15'::date),
    ('Data Science', 'Sep 2023', 5, '2026-06-15'::date, '2027-01-25'::date),
    ('Data Science', 'Mar 2023', 1, '2023-03-20'::date, '2023-07-24'::date),
    ('Data Science', 'Mar 2023', 2, '2023-07-24'::date, '2024-01-15'::date),
    ('Data Science', 'Mar 2023', 3, '2024-01-15'::date, '2025-01-13'::date),
    ('Data Science', 'Mar 2023', 4, '2025-01-13'::date, '2025-12-15'::date),
    ('Data Science', 'Mar 2023', 5, '2025-12-15'::date, '2026-07-27'::date)
),
ordered_seasons AS (
    SELECT
        se.id AS season_id,
        se.program_id,
        p.name AS program_name,
        ROW_NUMBER() OVER (PARTITION BY se.program_id ORDER BY se.order_in_program) AS position
    FROM seasons se
    JOIN programs p ON p.id = se.program_id
)
SELECT COUNT(*) AS matched_rows
FROM season_dates sd
JOIN ordered_seasons os
  ON os.program_name = sd.program_name AND os.position = sd.position
JOIN cohorts c ON c.name = sd.cohort_name;
