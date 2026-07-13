/**
 * University policy: a student's program/season counts as "Completed"
 * (instead of "In Progress") once their progress reaches this percentage,
 * regardless of whether the scraped is_completed flag has caught up yet.
 *
 * This threshold is the single source of truth on the app side. The
 * scraper (scripts/data_processor.py) applies the same rule when it
 * writes student_season_progress.is_completed directly, so in normal
 * operation this function is a no-op safety net that just confirms what
 * the database already says. It matters when the DB hasn't been
 * refreshed yet (e.g. right after a manual edit, or before the next
 * scrape run).
 */
export const SEASON_COMPLETION_THRESHOLD = 75

export function isSeasonCompleted(progressPercentage, dbIsCompleted) {
  const pct = parseFloat(progressPercentage || 0)
  return Boolean(dbIsCompleted) || pct >= SEASON_COMPLETION_THRESHOLD
}
