// server/utils/cohortAttendance.js
//
// Shared by:
//   - server/api/students/[id]/cohort-attendance.get.js (admin student profile page)
//   - server/api/student/dashboard.js (student's own dashboard)
//
// Computes attendance as a PERCENTAGE relative to the top attendee in
// the student's cohort for each category (workshops, stand-ups,
// mentoring, total) -- the top attendee in a category is 100%, everyone
// else is scored relative to that. Kept in one place so both routes
// stay in sync rather than drifting if the formula ever changes.

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {{ id: string, cohort_id: string|null, workshops_attended: number|null, standup_attended: number|null, mentoring_attended: number|null }} student
 * @returns {Promise<{
 *   cohortSize: number,
 *   workshops: { value: number, max: number, percent: number },
 *   standups: { value: number, max: number, percent: number },
 *   mentoring: { value: number, max: number, percent: number },
 *   total: { value: number, max: number, percent: number },
 * }>}
 */
export async function computeCohortAttendance(client, student) {
  const workshops = student.workshops_attended || 0
  const standups = student.standup_attended || 0
  const mentoring = student.mentoring_attended || 0
  const total = workshops + standups + mentoring

  if (!student.cohort_id) {
    // No cohort assigned -- nothing to compare against, so this
    // student's own numbers are trivially "the top" in their (empty)
    // comparison group.
    return {
      cohortSize: 1,
      workshops: { value: workshops, max: workshops, percent: workshops > 0 ? 100 : 0 },
      standups: { value: standups, max: standups, percent: standups > 0 ? 100 : 0 },
      mentoring: { value: mentoring, max: mentoring, percent: mentoring > 0 ? 100 : 0 },
      total: { value: total, max: total, percent: total > 0 ? 100 : 0 },
    }
  }

  const { data: cohortStudents, error } = await client
    .from('students')
    .select('id, workshops_attended, standup_attended, mentoring_attended')
    .eq('cohort_id', student.cohort_id)

  if (error) {
    const err = new Error(error.message)
    err.statusCode = 500
    throw err
  }

  const withTotals = (cohortStudents || []).map((s) => {
    const w = s.workshops_attended || 0
    const st = s.standup_attended || 0
    const m = s.mentoring_attended || 0
    return { workshops: w, standups: st, mentoring: m, total: w + st + m }
  })

  const maxOf = (key) => Math.max(0, ...withTotals.map((s) => s[key]))
  const pct = (value, max) => (max > 0 ? Math.round((value / max) * 100) : 0)

  const maxWorkshops = maxOf('workshops')
  const maxStandups = maxOf('standups')
  const maxMentoring = maxOf('mentoring')
  const maxTotal = maxOf('total')

  return {
    cohortSize: withTotals.length,
    workshops: { value: workshops, max: maxWorkshops, percent: pct(workshops, maxWorkshops) },
    standups: { value: standups, max: maxStandups, percent: pct(standups, maxStandups) },
    mentoring: { value: mentoring, max: maxMentoring, percent: pct(mentoring, maxMentoring) },
    total: { value: total, max: maxTotal, percent: pct(total, maxTotal) },
  }
}
