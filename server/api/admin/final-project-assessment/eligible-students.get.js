import { serverSupabaseClient } from '#supabase/server'
import { requireFinalProjectAdmin } from '~/server/utils/finalProjectAuth'
import { getSeason4StatusForStudents } from '~/server/utils/finalProjectSeason4'

// GET /api/admin/final-project-assessment/eligible-students?search=jane
//
// Powers the "Select Student(s)" step. Returns a search-limited list
// of students (name/email match), each with their computed Season 4
// status (NOT a stored flag -- read live from the same season-progress
// data the rest of the app uses) and, if they already have a Final
// Project Assessment assignment, a summary of it so the admin can see
// at a glance whether they're re-opening an existing assignment rather
// than creating a new one.
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  await requireFinalProjectAdmin(event, supabase)

  const query = getQuery(event)
  const search = String(query.search || '').trim()

  let studentsQuery = supabase
    .from('students')
    .select('id, first_name, last_name, email, program_id, programs ( name ), cohorts ( name )')
    .order('first_name', { ascending: true })
    .limit(50)

  if (search) {
    // Matches name OR email containing the search term.
    studentsQuery = studentsQuery.or(
      `first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`
    )
  }

  const { data: students, error: studentsError } = await studentsQuery
  if (studentsError) {
    throw createError({ statusCode: 500, statusMessage: studentsError.message })
  }
  if (!students || students.length === 0) {
    return { data: { students: [] } }
  }

  const studentIds = students.map((s) => s.id)

  const [season4Map, existingAssignmentsResult] = await Promise.all([
    getSeason4StatusForStudents(supabase, studentIds),
    supabase
      .from('final_project_assignments')
      .select('id, student_id, assessment_activated, archived')
      .in('student_id', studentIds),
  ])

  if (existingAssignmentsResult.error) {
    throw createError({ statusCode: 500, statusMessage: existingAssignmentsResult.error.message })
  }
  const assignmentByStudent = new Map(
    (existingAssignmentsResult.data || []).map((a) => [a.student_id, a])
  )

  const result = students.map((s) => {
    const existing = assignmentByStudent.get(s.id)
    return {
      id: s.id,
      name: `${s.first_name || ''} ${s.last_name || ''}`.trim(),
      email: s.email,
      program: s.programs?.name || null,
      cohort: s.cohorts?.name || null,
      season4: season4Map.get(s.id) || { seasonId: null, seasonName: null, progressPercentage: 0, isCompleted: false },
      existingAssignment: existing
        ? { id: existing.id, assessmentActivated: existing.assessment_activated, archived: existing.archived }
        : null,
    }
  })

  return { data: { students: result } }
})
