-- ============================================================
-- AMSTERDAM TECH — REAL CURRICULUM SEED DATA
-- Run this in Supabase SQL Editor AFTER schema.sql and all fixes
-- ============================================================

-- ============================================================
-- STEP 1: Fix meeting type frequencies to match real schedule
-- ============================================================
UPDATE meeting_types SET frequency_per_week = 1 WHERE name = 'workshop';
UPDATE meeting_types SET frequency_per_week = 1 WHERE name = 'mentoring';
UPDATE meeting_types SET frequency_per_week = 2 WHERE name = 'standup';  -- was 5, corrected


-- ============================================================
-- STEP 2: Seasons — raw definitions per programme
-- ============================================================

-- AI/ML seasons
INSERT INTO seasons (name, program_id, order_in_program)
SELECT 'Preseason',       id, 1 FROM programs WHERE name = 'AI/ML'
UNION ALL
SELECT 'Season 01',       id, 2 FROM programs WHERE name = 'AI/ML'
UNION ALL
SELECT 'Season 02',       id, 3 FROM programs WHERE name = 'AI/ML'
UNION ALL
SELECT 'Season 03',       id, 4 FROM programs WHERE name = 'AI/ML'
UNION ALL
SELECT 'Final Project',   id, 5 FROM programs WHERE name = 'AI/ML'
ON CONFLICT (name, program_id) DO NOTHING;

-- Data Science seasons (identical structure to AI/ML)
INSERT INTO seasons (name, program_id, order_in_program)
SELECT 'Preseason',       id, 1 FROM programs WHERE name = 'Data Science'
UNION ALL
SELECT 'Season 01',       id, 2 FROM programs WHERE name = 'Data Science'
UNION ALL
SELECT 'Season 02',       id, 3 FROM programs WHERE name = 'Data Science'
UNION ALL
SELECT 'Season 03',       id, 4 FROM programs WHERE name = 'Data Science'
UNION ALL
SELECT 'Final Project',   id, 5 FROM programs WHERE name = 'Data Science'
ON CONFLICT (name, program_id) DO NOTHING;

-- Software Engineering seasons (has Arc 01 / Arc 02 split in Season 01)
INSERT INTO seasons (name, program_id, order_in_program)
SELECT 'Preseason',           id, 1 FROM programs WHERE name = 'Software Engineering'
UNION ALL
SELECT 'Season 01 Arc 01',    id, 2 FROM programs WHERE name = 'Software Engineering'
UNION ALL
SELECT 'Season 01 Arc 02',    id, 3 FROM programs WHERE name = 'Software Engineering'
UNION ALL
SELECT 'Season 02',           id, 4 FROM programs WHERE name = 'Software Engineering'
UNION ALL
SELECT 'Season 03',           id, 5 FROM programs WHERE name = 'Software Engineering'
UNION ALL
SELECT 'Final Project',       id, 6 FROM programs WHERE name = 'Software Engineering'
ON CONFLICT (name, program_id) DO NOTHING;


-- ============================================================
-- STEP 3: Cohorts — one row per programme × cohort
-- All 7 intake cohorts for all 3 programmes
-- ============================================================

-- Helper: insert cohorts for all 3 programmes
INSERT INTO cohorts (name, program_id, start_date, end_date, is_active)
-- AI/ML
SELECT 'Mar 2023', id, '2023-03-20', '2026-07-27', FALSE FROM programs WHERE name = 'AI/ML'
UNION ALL
SELECT 'Sep 2023', id, '2023-09-18', '2027-01-25', FALSE FROM programs WHERE name = 'AI/ML'
UNION ALL
SELECT 'Mar 2024', id, '2024-03-25', '2027-07-26', FALSE FROM programs WHERE name = 'AI/ML'
UNION ALL
SELECT 'Sep 2024', id, '2024-09-16', '2028-01-17', FALSE FROM programs WHERE name = 'AI/ML'
UNION ALL
SELECT 'Mar 2025', id, '2025-03-24', '2028-07-17', TRUE  FROM programs WHERE name = 'AI/ML'
UNION ALL
SELECT 'Sep 2025', id, '2025-09-22', '2029-01-08', TRUE  FROM programs WHERE name = 'AI/ML'
UNION ALL
SELECT 'Mar 2026', id, '2026-03-23', '2029-07-09', TRUE  FROM programs WHERE name = 'AI/ML'

UNION ALL
-- Data Science
SELECT 'Mar 2023', id, '2023-03-20', '2026-07-27', FALSE FROM programs WHERE name = 'Data Science'
UNION ALL
SELECT 'Sep 2023', id, '2023-09-18', '2027-01-25', FALSE FROM programs WHERE name = 'Data Science'
UNION ALL
SELECT 'Mar 2024', id, '2024-03-25', '2027-07-26', FALSE FROM programs WHERE name = 'Data Science'
UNION ALL
SELECT 'Sep 2024', id, '2024-09-16', '2028-01-17', FALSE FROM programs WHERE name = 'Data Science'
UNION ALL
SELECT 'Mar 2025', id, '2025-03-24', '2028-07-17', TRUE  FROM programs WHERE name = 'Data Science'
UNION ALL
SELECT 'Sep 2025', id, '2025-09-22', '2029-01-08', TRUE  FROM programs WHERE name = 'Data Science'
UNION ALL
SELECT 'Mar 2026', id, '2026-03-23', '2029-07-09', TRUE  FROM programs WHERE name = 'Data Science'

UNION ALL
-- Software Engineering
SELECT 'Mar 2023', id, '2023-03-20', '2026-07-27', FALSE FROM programs WHERE name = 'Software Engineering'
UNION ALL
SELECT 'Sep 2023', id, '2023-09-18', '2027-01-25', FALSE FROM programs WHERE name = 'Software Engineering'
UNION ALL
SELECT 'Mar 2024', id, '2024-03-25', '2027-07-26', FALSE FROM programs WHERE name = 'Software Engineering'
UNION ALL
SELECT 'Sep 2024', id, '2024-09-16', '2028-01-17', FALSE FROM programs WHERE name = 'Software Engineering'
UNION ALL
SELECT 'Mar 2025', id, '2025-03-24', '2028-07-17', TRUE  FROM programs WHERE name = 'Software Engineering'
UNION ALL
SELECT 'Sep 2025', id, '2025-09-22', '2029-01-08', TRUE  FROM programs WHERE name = 'Software Engineering'
UNION ALL
SELECT 'Mar 2026', id, '2026-03-23', '2029-07-09', TRUE  FROM programs WHERE name = 'Software Engineering'

ON CONFLICT (name, program_id) DO NOTHING;


-- ============================================================
-- STEP 4: Schedule seasons onto cohorts (program_cohort_seasons)
-- Each row: which season runs when for a specific cohort+programme
-- Dates taken directly from the SEASONS END DATES spreadsheet
-- ============================================================

-- ── AI/ML — Mar 2023 ─────────────────────────────────────────
INSERT INTO program_cohort_seasons (program_id, cohort_id, season_id, start_date, end_date)
SELECT p.id, c.id, s.id, '2023-03-20', '2023-07-24'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Mar 2023' AND c.program_id=p.id AND s.name='Preseason' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2023-07-25', '2024-01-15'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Mar 2023' AND c.program_id=p.id AND s.name='Season 01' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2024-01-16', '2025-01-13'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Mar 2023' AND c.program_id=p.id AND s.name='Season 02' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2025-01-14', '2025-12-15'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Mar 2023' AND c.program_id=p.id AND s.name='Season 03' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2025-12-16', '2026-07-27'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Mar 2023' AND c.program_id=p.id AND s.name='Final Project' AND s.program_id=p.id
ON CONFLICT (program_id, cohort_id, season_id) DO NOTHING;

-- ── AI/ML — Sep 2023 ─────────────────────────────────────────
INSERT INTO program_cohort_seasons (program_id, cohort_id, season_id, start_date, end_date)
SELECT p.id, c.id, s.id, '2023-09-18', '2024-01-22'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Sep 2023' AND c.program_id=p.id AND s.name='Preseason' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2024-01-23', '2024-07-15'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Sep 2023' AND c.program_id=p.id AND s.name='Season 01' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2024-07-16', '2025-07-14'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Sep 2023' AND c.program_id=p.id AND s.name='Season 02' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2025-07-15', '2026-06-15'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Sep 2023' AND c.program_id=p.id AND s.name='Season 03' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2026-06-16', '2027-01-25'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Sep 2023' AND c.program_id=p.id AND s.name='Final Project' AND s.program_id=p.id
ON CONFLICT (program_id, cohort_id, season_id) DO NOTHING;

-- ── AI/ML — Mar 2024 ─────────────────────────────────────────
INSERT INTO program_cohort_seasons (program_id, cohort_id, season_id, start_date, end_date)
SELECT p.id, c.id, s.id, '2024-03-25', '2024-07-22'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Mar 2024' AND c.program_id=p.id AND s.name='Preseason' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2024-07-23', '2025-01-13'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Mar 2024' AND c.program_id=p.id AND s.name='Season 01' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2025-01-14', '2026-01-12'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Mar 2024' AND c.program_id=p.id AND s.name='Season 02' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2026-01-13', '2026-12-14'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Mar 2024' AND c.program_id=p.id AND s.name='Season 03' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2026-12-15', '2027-07-26'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Mar 2024' AND c.program_id=p.id AND s.name='Final Project' AND s.program_id=p.id
ON CONFLICT (program_id, cohort_id, season_id) DO NOTHING;

-- ── AI/ML — Sep 2024 ─────────────────────────────────────────
INSERT INTO program_cohort_seasons (program_id, cohort_id, season_id, start_date, end_date)
SELECT p.id, c.id, s.id, '2024-09-16', '2025-01-06'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Sep 2024' AND c.program_id=p.id AND s.name='Preseason' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2025-01-07', '2025-07-07'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Sep 2024' AND c.program_id=p.id AND s.name='Season 01' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2025-07-08', '2026-07-06'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Sep 2024' AND c.program_id=p.id AND s.name='Season 02' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2026-07-07', '2027-06-14'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Sep 2024' AND c.program_id=p.id AND s.name='Season 03' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2027-06-15', '2028-01-17'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Sep 2024' AND c.program_id=p.id AND s.name='Final Project' AND s.program_id=p.id
ON CONFLICT (program_id, cohort_id, season_id) DO NOTHING;

-- ── AI/ML — Mar 2025 ─────────────────────────────────────────
INSERT INTO program_cohort_seasons (program_id, cohort_id, season_id, start_date, end_date)
SELECT p.id, c.id, s.id, '2025-03-24', '2025-06-23'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Mar 2025' AND c.program_id=p.id AND s.name='Preseason' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2025-06-24', '2025-12-15'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Mar 2025' AND c.program_id=p.id AND s.name='Season 01' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2025-12-16', '2026-12-14'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Mar 2025' AND c.program_id=p.id AND s.name='Season 02' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2026-12-15', '2027-11-15'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Mar 2025' AND c.program_id=p.id AND s.name='Season 03' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2027-11-16', '2028-07-17'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Mar 2025' AND c.program_id=p.id AND s.name='Final Project' AND s.program_id=p.id
ON CONFLICT (program_id, cohort_id, season_id) DO NOTHING;

-- ── AI/ML — Sep 2025 ─────────────────────────────────────────
INSERT INTO program_cohort_seasons (program_id, cohort_id, season_id, start_date, end_date)
SELECT p.id, c.id, s.id, '2025-09-22', '2026-01-12'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Sep 2025' AND c.program_id=p.id AND s.name='Preseason' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2026-01-13', '2026-07-06'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Sep 2025' AND c.program_id=p.id AND s.name='Season 01' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2026-07-07', '2027-06-28'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Sep 2025' AND c.program_id=p.id AND s.name='Season 02' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2027-06-29', '2028-05-15'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Sep 2025' AND c.program_id=p.id AND s.name='Season 03' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2028-05-16', '2029-01-08'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Sep 2025' AND c.program_id=p.id AND s.name='Final Project' AND s.program_id=p.id
ON CONFLICT (program_id, cohort_id, season_id) DO NOTHING;

-- ── AI/ML — Mar 2026 ─────────────────────────────────────────
INSERT INTO program_cohort_seasons (program_id, cohort_id, season_id, start_date, end_date)
SELECT p.id, c.id, s.id, '2026-03-23', '2026-07-13'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Mar 2026' AND c.program_id=p.id AND s.name='Preseason' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2026-07-14', '2027-01-04'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Mar 2026' AND c.program_id=p.id AND s.name='Season 01' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2027-01-05', '2027-12-27'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Mar 2026' AND c.program_id=p.id AND s.name='Season 02' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2027-12-28', '2028-12-04'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Mar 2026' AND c.program_id=p.id AND s.name='Season 03' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2028-12-05', '2029-07-09'
FROM programs p, cohorts c, seasons s
WHERE p.name='AI/ML' AND c.name='Mar 2026' AND c.program_id=p.id AND s.name='Final Project' AND s.program_id=p.id
ON CONFLICT (program_id, cohort_id, season_id) DO NOTHING;

-- ── Data Science — all 7 cohorts (identical dates to AI/ML) ──
-- DS uses same season structure and dates as AI/ML per the spreadsheet
INSERT INTO program_cohort_seasons (program_id, cohort_id, season_id, start_date, end_date)
SELECT ds.id, c.id, s.id, pcs.start_date, pcs.end_date
FROM program_cohort_seasons pcs
JOIN programs aiml ON aiml.id = pcs.program_id AND aiml.name = 'AI/ML'
JOIN programs ds ON ds.name = 'Data Science'
JOIN cohorts c ON c.program_id = ds.id AND c.name = (
    SELECT name FROM cohorts WHERE id = pcs.cohort_id
)
JOIN seasons s ON s.program_id = ds.id AND s.name = (
    SELECT name FROM seasons WHERE id = pcs.season_id
)
ON CONFLICT (program_id, cohort_id, season_id) DO NOTHING;

-- ── Software Engineering — Mar 2023 ─────────────────────────
INSERT INTO program_cohort_seasons (program_id, cohort_id, season_id, start_date, end_date)
SELECT p.id, c.id, s.id, '2023-03-20', '2023-07-03'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Mar 2023' AND c.program_id=p.id AND s.name='Preseason' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2023-07-04', '2023-10-16'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Mar 2023' AND c.program_id=p.id AND s.name='Season 01 Arc 01' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2023-10-17', '2024-03-25'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Mar 2023' AND c.program_id=p.id AND s.name='Season 01 Arc 02' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2024-03-26', '2025-01-20'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Mar 2023' AND c.program_id=p.id AND s.name='Season 02' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2025-01-21', '2025-12-15'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Mar 2023' AND c.program_id=p.id AND s.name='Season 03' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2025-12-16', '2026-07-27'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Mar 2023' AND c.program_id=p.id AND s.name='Final Project' AND s.program_id=p.id
ON CONFLICT (program_id, cohort_id, season_id) DO NOTHING;

-- ── Software Engineering — Sep 2023 ─────────────────────────
INSERT INTO program_cohort_seasons (program_id, cohort_id, season_id, start_date, end_date)
SELECT p.id, c.id, s.id, '2023-09-18', '2024-01-01'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Sep 2023' AND c.program_id=p.id AND s.name='Preseason' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2024-01-02', '2024-04-15'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Sep 2023' AND c.program_id=p.id AND s.name='Season 01 Arc 01' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2024-04-16', '2024-09-23'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Sep 2023' AND c.program_id=p.id AND s.name='Season 01 Arc 02' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2024-09-24', '2025-07-21'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Sep 2023' AND c.program_id=p.id AND s.name='Season 02' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2025-07-22', '2026-06-15'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Sep 2023' AND c.program_id=p.id AND s.name='Season 03' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2026-06-16', '2027-01-25'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Sep 2023' AND c.program_id=p.id AND s.name='Final Project' AND s.program_id=p.id
ON CONFLICT (program_id, cohort_id, season_id) DO NOTHING;

-- ── Software Engineering — Mar 2024 ─────────────────────────
INSERT INTO program_cohort_seasons (program_id, cohort_id, season_id, start_date, end_date)
SELECT p.id, c.id, s.id, '2024-03-25', '2024-07-08'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Mar 2024' AND c.program_id=p.id AND s.name='Preseason' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2024-07-09', '2024-10-21'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Mar 2024' AND c.program_id=p.id AND s.name='Season 01 Arc 01' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2024-10-22', '2025-04-07'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Mar 2024' AND c.program_id=p.id AND s.name='Season 01 Arc 02' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2025-04-08', '2026-02-02'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Mar 2024' AND c.program_id=p.id AND s.name='Season 02' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2026-02-03', '2026-12-14'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Mar 2024' AND c.program_id=p.id AND s.name='Season 03' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2026-12-15', '2027-07-26'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Mar 2024' AND c.program_id=p.id AND s.name='Final Project' AND s.program_id=p.id
ON CONFLICT (program_id, cohort_id, season_id) DO NOTHING;

-- ── Software Engineering — Sep 2024 ─────────────────────────
INSERT INTO program_cohort_seasons (program_id, cohort_id, season_id, start_date, end_date)
SELECT p.id, c.id, s.id, '2024-09-16', '2024-12-30'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Sep 2024' AND c.program_id=p.id AND s.name='Preseason' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2024-12-31', '2025-04-14'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Sep 2024' AND c.program_id=p.id AND s.name='Season 01 Arc 01' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2025-04-15', '2025-09-29'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Sep 2024' AND c.program_id=p.id AND s.name='Season 01 Arc 02' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2025-09-30', '2026-07-27'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Sep 2024' AND c.program_id=p.id AND s.name='Season 02' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2026-07-28', '2027-06-14'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Sep 2024' AND c.program_id=p.id AND s.name='Season 03' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2027-06-15', '2028-01-17'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Sep 2024' AND c.program_id=p.id AND s.name='Final Project' AND s.program_id=p.id
ON CONFLICT (program_id, cohort_id, season_id) DO NOTHING;

-- ── Software Engineering — Mar 2025 ─────────────────────────
INSERT INTO program_cohort_seasons (program_id, cohort_id, season_id, start_date, end_date)
SELECT p.id, c.id, s.id, '2025-03-24', '2025-06-16'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Mar 2025' AND c.program_id=p.id AND s.name='Preseason' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2025-06-17', '2025-10-13'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Mar 2025' AND c.program_id=p.id AND s.name='Season 01 Arc 01' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2025-10-14', '2026-03-16'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Mar 2025' AND c.program_id=p.id AND s.name='Season 01 Arc 02' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2026-03-17', '2027-01-11'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Mar 2025' AND c.program_id=p.id AND s.name='Season 02' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2027-01-12', '2027-11-15'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Mar 2025' AND c.program_id=p.id AND s.name='Season 03' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2027-11-16', '2028-07-17'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Mar 2025' AND c.program_id=p.id AND s.name='Final Project' AND s.program_id=p.id
ON CONFLICT (program_id, cohort_id, season_id) DO NOTHING;

-- ── Software Engineering — Sep 2025 ─────────────────────────
INSERT INTO program_cohort_seasons (program_id, cohort_id, season_id, start_date, end_date)
SELECT p.id, c.id, s.id, '2025-09-22', '2026-01-05'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Sep 2025' AND c.program_id=p.id AND s.name='Preseason' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2026-01-06', '2026-05-18'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Sep 2025' AND c.program_id=p.id AND s.name='Season 01 Arc 01' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2026-05-19', '2026-10-05'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Sep 2025' AND c.program_id=p.id AND s.name='Season 01 Arc 02' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2026-10-06', '2027-08-02'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Sep 2025' AND c.program_id=p.id AND s.name='Season 02' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2027-08-03', '2028-05-15'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Sep 2025' AND c.program_id=p.id AND s.name='Season 03' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2028-05-16', '2029-01-08'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Sep 2025' AND c.program_id=p.id AND s.name='Final Project' AND s.program_id=p.id
ON CONFLICT (program_id, cohort_id, season_id) DO NOTHING;

-- ── Software Engineering — Mar 2026 ─────────────────────────
INSERT INTO program_cohort_seasons (program_id, cohort_id, season_id, start_date, end_date)
SELECT p.id, c.id, s.id, '2026-03-23', '2026-07-06'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Mar 2026' AND c.program_id=p.id AND s.name='Preseason' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2026-07-07', '2026-11-16'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Mar 2026' AND c.program_id=p.id AND s.name='Season 01 Arc 01' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2026-11-17', '2027-04-05'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Mar 2026' AND c.program_id=p.id AND s.name='Season 01 Arc 02' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2027-04-06', '2028-01-31'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Mar 2026' AND c.program_id=p.id AND s.name='Season 02' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2028-02-01', '2028-12-04'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Mar 2026' AND c.program_id=p.id AND s.name='Season 03' AND s.program_id=p.id
UNION ALL
SELECT p.id, c.id, s.id, '2028-12-05', '2029-07-09'
FROM programs p, cohorts c, seasons s
WHERE p.name='Software Engineering' AND c.name='Mar 2026' AND c.program_id=p.id AND s.name='Final Project' AND s.program_id=p.id
ON CONFLICT (program_id, cohort_id, season_id) DO NOTHING;


-- ============================================================
-- VERIFY: Check what was created
-- ============================================================
SELECT
  p.name AS programme,
  c.name AS cohort,
  s.name AS season,
  pcs.start_date,
  pcs.end_date
FROM program_cohort_seasons pcs
JOIN programs p ON p.id = pcs.program_id
JOIN cohorts c ON c.id = pcs.cohort_id
JOIN seasons s ON s.id = pcs.season_id
ORDER BY p.name, c.name, s.order_in_program;
