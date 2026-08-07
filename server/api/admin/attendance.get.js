import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

export default defineEventHandler(async (event) => {
  const client = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const { data: adminRow, error: adminError } = await client
    .from('admin')
    .select('email')
    .eq('email', user.email)
    .maybeSingle()

  if (adminError) {
    throw createError({ statusCode: 500, statusMessage: adminError.message })
  }
  if (!adminRow) {
    throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
  }

  const { data: students, error } = await client
    .from('students')
    .select(`
      id,
      first_name,
      last_name,
      email,
      username,
      workshops_attended,
      standup_attended,
      mentoring_attended,
      cohorts(name),
      programs(name)
    `)

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  const data = (students || []).map((s) => ({
    id: s.id,
    name: `${s.first_name || ''} ${s.last_name || ''}`.trim(),
    email: s.email,
    username: s.username,
    program: s.programs?.name || '',
    cohort: s.cohorts?.name || '',
    workshops_attended: s.workshops_attended || 0,
    standup_attended: s.standup_attended || 0,
    mentoring_attended: s.mentoring_attended || 0,
    total_attended: (s.workshops_attended || 0) + (s.standup_attended || 0) + (s.mentoring_attended || 0),
  }))

  // ── Attendance %, relative to the top attendee within the SAME cohort ──
  // There's no "expected sessions" count tracked anywhere in the data
  // pipeline (see attendance_by_cohort.js), so this mirrors the same
  // relative-engagement definition used on the cohort analytics page:
  // a student's attended count divided by the highest attended count
  // among their own cohort-mates. 100% means they match their cohort's
  // most-engaged student; it isn't "% of sessions held".
  const cohortMax = new Map() // cohort name -> { overall, workshop, standup, mentoring }
  for (const s of data) {
    const key = s.cohort || 'Unknown Cohort'
    const current = cohortMax.get(key) || { overall: 0, workshop: 0, standup: 0, mentoring: 0 }
    if (s.total_attended > current.overall) current.overall = s.total_attended
    if (s.workshops_attended > current.workshop) current.workshop = s.workshops_attended
    if (s.standup_attended > current.standup) current.standup = s.standup_attended
    if (s.mentoring_attended > current.mentoring) current.mentoring = s.mentoring_attended
    cohortMax.set(key, current)
  }

  function pctOfMax(value, max) {
    if (!max || max <= 0) return 0
    return Math.round((value / max) * 10000) / 100
  }

  for (const s of data) {
    const max = cohortMax.get(s.cohort || 'Unknown Cohort')
    s.cohort_pct = pctOfMax(s.total_attended, max.overall)
    s.workshop_pct = pctOfMax(s.workshops_attended, max.workshop)
    s.standup_pct = pctOfMax(s.standup_attended, max.standup)
    s.mentoring_pct = pctOfMax(s.mentoring_attended, max.mentoring)
    // Raw count this student is being measured against, shown in the UI
    // so admins can see it's relative rather than a fixed target.
    s.cohort_top_attendee = max.overall
  }

  return { data }
})
