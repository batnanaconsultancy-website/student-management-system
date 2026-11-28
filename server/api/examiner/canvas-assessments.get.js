import { createError } from 'h3'
import { serverSupabaseClient } from '#supabase/server'
import { requireCanvasAssessmentExaminer } from '~/server/utils/canvasAssessmentAuth'

// Canvas assessment visibility is based only on explicit Canvas scope
// assignments, never Final Project examiner links.
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const { scopes } = await requireCanvasAssessmentExaminer(event, supabase)
  if (!scopes.length) return { data: { scopes: [], courses: [], assignments: [], attempts: [] } }

  const [coursesResult, assignmentsResult] = await Promise.all([
    supabase.from('canvas_assessment_courses')
      .select('scope, canvas_course_id, is_enabled')
      .in('scope', scopes).eq('is_enabled', true),
    supabase.from('canvas_assessment_assignments')
      .select('scope, canvas_course_id, canvas_assignment_id')
      .in('scope', scopes).eq('is_assessment', true),
  ])
  for (const result of [coursesResult, assignmentsResult]) {
    if (result.error) throw createError({ statusCode: 500, statusMessage: result.error.message })
  }

  const enabledCourseIds = new Set((coursesResult.data || []).map((row) => row.canvas_course_id))
  const configuredAssignments = (assignmentsResult.data || [])
    .filter((row) => enabledCourseIds.has(row.canvas_course_id))
  if (!configuredAssignments.length) {
    return { data: { scopes, courses: coursesResult.data || [], assignments: [], attempts: [] } }
  }

  const courseIds = [...new Set(configuredAssignments.map((row) => row.canvas_course_id))]
  const [courseNamesResult, assignmentsDataResult] = await Promise.all([
    supabase.from('canvas_courses')
      .select('canvas_course_id, name, course_code')
      .in('canvas_course_id', courseIds),
    supabase.from('canvas_assignments')
      .select('canvas_course_id, canvas_assignment_id, name, due_at, points_possible')
      .in('canvas_course_id', courseIds),
  ])
  for (const result of [courseNamesResult, assignmentsDataResult]) {
    if (result.error) throw createError({ statusCode: 500, statusMessage: result.error.message })
  }

  const attemptRows = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from('canvas_submission_attempts')
      .select('id, canvas_course_id, canvas_assignment_id, canvas_student_id, attempt, is_latest, submission_type, submitted_at, captured_at, canvas_students(name, email)')
      .in('canvas_course_id', courseIds)
      .order('submitted_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + 999)
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    attemptRows.push(...(data || []))
    if (!data || data.length < 1000) break
  }

  const courseById = new Map((courseNamesResult.data || []).map((row) => [row.canvas_course_id, row]))
  const assignmentByKey = new Map((assignmentsDataResult.data || []).map((row) => [
    `${row.canvas_course_id}:${row.canvas_assignment_id}`, row,
  ]))
  const allowedKeys = new Set(configuredAssignments.map((row) =>
    `${row.canvas_course_id}:${row.canvas_assignment_id}`,
  ))

  const assignments = configuredAssignments.map((row) => {
    const course = courseById.get(row.canvas_course_id)
    const assignment = assignmentByKey.get(`${row.canvas_course_id}:${row.canvas_assignment_id}`)
    return {
      scope: row.scope,
      canvasCourseId: row.canvas_course_id,
      courseName: course?.name || `Course ${row.canvas_course_id}`,
      courseCode: course?.course_code || null,
      canvasAssignmentId: row.canvas_assignment_id,
      assignmentName: assignment?.name || `Assignment ${row.canvas_assignment_id}`,
      dueAt: assignment?.due_at || null,
      pointsPossible: assignment?.points_possible ?? null,
    }
  })

  const attempts = attemptRows
    .filter((row) => allowedKeys.has(`${row.canvas_course_id}:${row.canvas_assignment_id}`))
    .map((row) => {
      const assignment = assignmentByKey.get(`${row.canvas_course_id}:${row.canvas_assignment_id}`)
      const course = courseById.get(row.canvas_course_id)
      return {
        id: row.id,
        scope: configuredAssignments.find((a) =>
          a.canvas_course_id === row.canvas_course_id &&
          a.canvas_assignment_id === row.canvas_assignment_id
        )?.scope,
        canvasCourseId: row.canvas_course_id,
        courseName: course?.name || `Course ${row.canvas_course_id}`,
        canvasAssignmentId: row.canvas_assignment_id,
        assignmentName: assignment?.name || `Assignment ${row.canvas_assignment_id}`,
        studentName: row.canvas_students?.name || 'Canvas student',
        studentEmail: row.canvas_students?.email || null,
        attempt: row.attempt,
        isLatest: row.is_latest,
        submissionType: row.submission_type,
        submittedAt: row.submitted_at,
        capturedAt: row.captured_at,
      }
    })

  return { data: { scopes, courses: coursesResult.data || [], assignments, attempts } }
})
