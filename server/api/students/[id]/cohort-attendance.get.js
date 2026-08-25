import { createError } from 'h3'
import { serverSupabaseClient } from '#supabase/server'

/**
 * GET /api/students/:id/cohort-attendance
 *
 * Returns this student's attendance figures alongside the *top attendee
 * in their cohort* for each category (workshops, stand-ups, mentoring,
 * and total) -- the top attendee in each category is treated as 100%,
 * and everyone else's percentage is scored relative to that. This is
 * separate from raw attendance counts (which the students.* select on
 * /api/students/:id already returns) because computing "top in cohort"
 * requires looking at every student in the same cohort, not just this
 * one.
 *
 * A cohort with only one student (or where nobody has attended
 * anything) safely returns 100%/0% rather than dividing by zero.
 */
export default defineEventHandler(async (event) => {
  try {
    const studentId = getRouterParam(event, 'id')
    if (!studentId) {
      throw createError({ statusCode: 400, statusMessage: 'Student ID is required' })
    }

    const client = await serverSupabaseClient(event)

    const { data: student, error: studentError } = await client
      .from('students')
      .select('id, cohort_id, workshops_attended, standup_attended, mentoring_attended')
      .eq('id', studentId)
      .single()

    if (studentError) {
      throw createError({ statusCode: 404, statusMessage: studentError.message || 'Student not found' })
    }

    if (!student.cohort_id) {
      // No cohort assigned -- nothing to compare against, so this
      // student's own numbers are trivially "the top" in their (empty)
      // comparison group.
      const workshops = student.workshops_attended || 0
      const standups = student.standup_attended || 0
      const mentoring = student.mentoring_attended || 0
      const total = workshops + standups + mentoring
      return {
        data: {
          cohortSize: 1,
          workshops: { value: workshops, max: workshops, percent: workshops > 0 ? 100 : 0 },
          standups: { value: standups, max: standups, percent: standups > 0 ? 100 : 0 },
          mentoring: { value: mentoring, max: mentoring, percent: mentoring > 0 ? 100 : 0 },
          total: { value: total, max: total, percent: total > 0 ? 100 : 0 },
        },
      }
    }

    const { data: cohortStudents, error: cohortError } = await client
      .from('students')
      .select('id, workshops_attended, standup_attended, mentoring_attended')
      .eq('cohort_id', student.cohort_id)

    if (cohortError) {
      throw createError({ statusCode: 500, statusMessage: cohortError.message })
    }

    const withTotals = (cohortStudents || []).map((s) => {
      const workshops = s.workshops_attended || 0
      const standups = s.standup_attended || 0
      const mentoring = s.mentoring_attended || 0
      return { workshops, standups, mentoring, total: workshops + standups + mentoring }
    })

    const maxOf = (key) => Math.max(0, ...withTotals.map((s) => s[key]))
    const pct = (value, max) => (max > 0 ? Math.round((value / max) * 100) : 0)

    const maxWorkshops = maxOf('workshops')
    const maxStandups = maxOf('standups')
    const maxMentoring = maxOf('mentoring')
    const maxTotal = maxOf('total')

    const workshops = student.workshops_attended || 0
    const standups = student.standup_attended || 0
    const mentoring = student.mentoring_attended || 0
    const total = workshops + standups + mentoring

    return {
      data: {
        cohortSize: withTotals.length,
        workshops: { value: workshops, max: maxWorkshops, percent: pct(workshops, maxWorkshops) },
        standups: { value: standups, max: maxStandups, percent: pct(standups, maxStandups) },
        mentoring: { value: mentoring, max: maxMentoring, percent: pct(mentoring, maxMentoring) },
        total: { value: total, max: maxTotal, percent: pct(total, maxTotal) },
      },
    }
  } catch (err) {
    if (err.statusCode) throw err
    throw createError({ statusCode: 500, statusMessage: err?.message || 'Internal server error' })
  }
})
