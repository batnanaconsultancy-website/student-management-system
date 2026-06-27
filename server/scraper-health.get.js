import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

// GET /api/scraper-health
// Returns the last successful scrape time (most recent student last_login update),
// the last analytics snapshot time, and whether either looks stale (> 25 hours).
// Used by the admin dashboard to surface a warning when the pipeline has been silent.
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const { data: callerRow } = await supabase
    .from('admin')
    .select('email')
    .eq('email', user.email)
    .maybeSingle()

  if (!callerRow) {
    throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
  }

  // Most recent student update — proxy for "did the scraper run recently?"
  const { data: recentStudent } = await supabase
    .from('students')
    .select('updated_at')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .single()

  // Most recent analytics snapshot
  const { data: recentSnapshot } = await supabase
    .from('progress_snapshots')
    .select('snapshot_date')
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .single()

  const now = Date.now()
  const STALE_THRESHOLD_MS = 25 * 60 * 60 * 1000 // 25 hours

  const lastScrapeTime = recentStudent?.updated_at || null
  const lastSnapshotTime = recentSnapshot?.snapshot_date || null

  const scrapeStale = lastScrapeTime
    ? now - new Date(lastScrapeTime).getTime() > STALE_THRESHOLD_MS
    : true

  const snapshotStale = lastSnapshotTime
    ? now - new Date(lastSnapshotTime).getTime() > STALE_THRESHOLD_MS * 7 // snapshots are weekly
    : true

  return {
    lastScrapeTime,
    lastSnapshotTime,
    scrapeStale,
    snapshotStale,
    healthy: !scrapeStale
  }
})
