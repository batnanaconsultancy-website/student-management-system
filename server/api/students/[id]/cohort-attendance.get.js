import { createError } from 'h3'
import { serverSupabaseClient } from '#supabase/server'
import { computeCohortAttendance } from '~/server/utils/cohortAttendance'

/**
 * GET /api/students/:id/cohort-attendance
 *
 * Returns this student's attendance as a percentage relative to the top
 * attendee in their cohort, for the admin student profile page. See
 * server/utils/cohortAttendance.js for the actual calculation -- the
 * same logic backs the student's own dashboard
 * (server/api/student/dashboard.js) so the two views never disagree.
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

    const data = await computeCohortAttendance(client, student)
    return { data }
  } catch (err) {
    if (err.statusCode) throw err
    throw createError({ statusCode: 500, statusMessage: err?.message || 'Internal server error' })
  }
})
