import { createError, getQuery } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

// GET /api/admin/canvas/competencies?courseId=328
//
// Returns per-student competency (Canvas "outcome") mastery, grouped by
// outcome group, for the Competency Matrix tab. Reads only from the
// already-synced canvas_outcomes / canvas_outcome_results tables -- no
// live Canvas calls happen here, only on "Sync Now". Caller must be an
// admin.
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const { data: callerRow, error: callerError } = await supabase
    .from('admin')
    .select('email')
    .eq('email', user.email)
    .maybeSingle()

  if (callerError) {
    throw createError({ statusCode: 500, statusMessage: callerError.message })
  }
  if (!callerRow) {
    throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
  }

  const query = getQuery(event)
  const canvasCourseId = Number(query.courseId)
  if (!canvasCourseId || Number.isNaN(canvasCourseId)) {
    throw createError({ statusCode: 400, statusMessage: 'courseId query param is required' })
  }

  const { data: enrollments, error: enrollmentsError } = await supabase
    .from('canvas_enrollments')
    .select('canvas_student_id, canvas_students(id, canvas_user_id, name, email)')
    .eq('canvas_course_id', canvasCourseId)

  if (enrollmentsError) {
    throw createError({ statusCode: 500, statusMessage: enrollmentsError.message })
  }

  const students = (enrollments || []).map((e) => e.canvas_students).filter(Boolean)

  const { data: outcomes, error: outcomesError } = await supabase
    .from('canvas_outcomes')
    .select('canvas_outcome_id, title, group_name, mastery_points, points_possible')
    .eq('canvas_course_id', canvasCourseId)
    .order('group_name', { ascending: true })

  if (outcomesError) {
    throw createError({ statusCode: 500, statusMessage: outcomesError.message })
  }

  const { data: results, error: resultsError } = await supabase
    .from('canvas_outcome_results')
    .select('*')
    .eq('canvas_course_id', canvasCourseId)

  if (resultsError) {
    throw createError({ statusCode: 500, statusMessage: resultsError.message })
  }

  const resultKey = (outcomeId, studentId) => `${outcomeId}::${studentId}`
  const resultByKey = new Map(
    (results || []).map((r) => [resultKey(r.canvas_outcome_id, r.canvas_student_id), r])
  )

  // Group outcome definitions once (shared shape across all students,
  // so the front end can render group headers even before picking a
  // student to expand).
  const groupNames = [...new Set((outcomes || []).map((o) => o.group_name))]

  const studentRows = students.map((student) => {
    const groups = groupNames.map((groupName) => {
      const groupOutcomes = (outcomes || []).filter((o) => o.group_name === groupName)
      const outcomeDetails = groupOutcomes.map((o) => {
        const result = resultByKey.get(resultKey(o.canvas_outcome_id, student.id))
        return {
          outcomeId: o.canvas_outcome_id,
          title: o.title,
          score: result?.score ?? null,
          masteryPoints: o.mastery_points,
          mastery: result?.mastery || false,
        }
      })
      const mastered = outcomeDetails.filter((o) => o.mastery).length
      return {
        groupName,
        mastered,
        total: outcomeDetails.length,
        outcomes: outcomeDetails,
      }
    })

    const overallTotal = groups.reduce((sum, g) => sum + g.total, 0)
    const overallMastered = groups.reduce((sum, g) => sum + g.mastered, 0)

    return {
      studentId: student.id,
      studentName: student.name,
      studentEmail: student.email,
      overallMastered,
      overallTotal,
      overallPercent: overallTotal > 0 ? Math.round((overallMastered / overallTotal) * 100) : 0,
      groups,
    }
  })

  return {
    data: {
      students: studentRows,
      totalCompetencies: (outcomes || []).length,
    },
  }
})
