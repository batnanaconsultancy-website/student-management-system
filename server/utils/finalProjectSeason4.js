// server/utils/finalProjectSeason4.js
//
// "Season 04 Completed" (Final Project Assessment spec, Section 4) is
// deliberately NOT a new concept -- it's the existing season-progress
// system the rest of the app already uses (same `seasons` /
// `student_season_progress` tables, same isSeasonCompleted() 75%
// threshold as server/api/students/[id]/season-progress.js). This
// file just adds a batch lookup for "season whose order_in_program is
// 4, for these specific students," since the Final Project Assessment
// admin screens need that for many students at once rather than one
// at a time.
import { isSeasonCompleted } from '~/server/utils/seasonCompletion'

const SEASON_4_ORDER = 4

// Returns a Map<studentId, { seasonId, seasonName, progressPercentage, isCompleted }>
// for every student in `studentIds`. Students whose program has no
// Season 4 (or who have no progress row yet) still get an entry, with
// isCompleted: false -- the Admin UI should treat "no data" the same
// as "not completed," never silently skip the student.
export async function getSeason4StatusForStudents(supabase, studentIds) {
  const result = new Map()
  if (!studentIds || studentIds.length === 0) return result

  const { data: students, error: studentsError } = await supabase
    .from('students')
    .select('id, program_id')
    .in('id', studentIds)

  if (studentsError) throw studentsError
  if (!students || students.length === 0) return result

  const programIds = [...new Set(students.map((s) => s.program_id).filter(Boolean))]

  const { data: season4s, error: seasonsError } = programIds.length > 0
    ? await supabase
        .from('seasons')
        .select('id, name, program_id')
        .in('program_id', programIds)
        .eq('order_in_program', SEASON_4_ORDER)
    : { data: [], error: null }

  if (seasonsError) throw seasonsError

  const season4ByProgram = new Map((season4s || []).map((s) => [s.program_id, s]))
  const season4Ids = (season4s || []).map((s) => s.id)

  const { data: progressRows, error: progressError } = season4Ids.length > 0
    ? await supabase
        .from('student_season_progress')
        .select('student_id, season_id, progress_percentage, is_completed')
        .in('student_id', studentIds)
        .in('season_id', season4Ids)
    : { data: [], error: null }

  if (progressError) throw progressError

  const progressByStudent = new Map((progressRows || []).map((p) => [p.student_id, p]))

  for (const student of students) {
    const season4 = season4ByProgram.get(student.program_id)
    if (!season4) {
      result.set(student.id, { seasonId: null, seasonName: null, progressPercentage: 0, isCompleted: false })
      continue
    }
    const progress = progressByStudent.get(student.id)
    result.set(student.id, {
      seasonId: season4.id,
      seasonName: season4.name,
      progressPercentage: progress?.progress_percentage || 0,
      isCompleted: isSeasonCompleted(progress?.progress_percentage, progress?.is_completed),
    })
  }

  return result
}

export async function getSeason4StatusForStudent(supabase, studentId) {
  const map = await getSeason4StatusForStudents(supabase, [studentId])
  return map.get(studentId) || { seasonId: null, seasonName: null, progressPercentage: 0, isCompleted: false }
}
