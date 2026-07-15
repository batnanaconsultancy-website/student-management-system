import { createError } from 'h3'
import { serverSupabaseClient } from '#supabase/server'

// Note: this endpoint used to compute "attendance %" as attended / expected,
// where "expected" came from cohort_meeting_stats / cohort_meetings /
// meeting_types. Nothing in the actual data pipeline (scripts/update_attendance.py)
// ever writes to those tables -- they're leftover from an earlier design and
// stay permanently empty/stale, so that division always produced 0/null.
// This now reports real, always-computable numbers instead: total attended
// counts (already correct) and average attended per student.
export default defineEventHandler(async (event) => {
    try {
        const client = await serverSupabaseClient(event)

        // Fetch all students and their attendance counters (including inactive students)
        const { data: students, error: studentsErr } = await client
            .from('students')
            .select('id,username,cohort_id,workshops_attended,standup_attended,mentoring_attended')

        if (studentsErr) {
            console.error('Error fetching students', studentsErr)
            throw createError({ statusCode: 500, statusMessage: studentsErr.message || 'Failed fetching students' })
        }

        const sumWorkshopAttended = students.reduce((sum, s) => sum + (s.workshops_attended || 0), 0)
        const sumStandupAttended = students.reduce((sum, s) => sum + (s.standup_attended || 0), 0)
        const sumMentoringAttended = students.reduce((sum, s) => sum + (s.mentoring_attended || 0), 0)
        const studentCount = students.length

        function perStudent(sum) {
            return studentCount > 0 ? Math.round((sum / studentCount) * 100) / 100 : null
        }

        const avgWorkshop = perStudent(sumWorkshopAttended)
        const avgStandup = perStudent(sumStandupAttended)
        const avgMentoring = perStudent(sumMentoringAttended)
        const avgOverall = perStudent(sumWorkshopAttended + sumStandupAttended + sumMentoringAttended)

        const result = [
            { metric: 'overall_avg', value: avgOverall },
            { metric: 'workshop_avg', value: avgWorkshop },
            { metric: 'standup_avg', value: avgStandup },
            { metric: 'mentoring_avg', value: avgMentoring },
            { metric: 'workshop_attended', count: sumWorkshopAttended },
            { metric: 'standup_attended', count: sumStandupAttended },
            { metric: 'mentoring_attended', count: sumMentoringAttended },
            { metric: 'student_count', count: studentCount },
        ]

        return { data: { value: result } }
    } catch (err) {
        console.error('Attendance handler error', err)
        throw createError({ statusCode: 500, statusMessage: err?.message || 'Internal server error' })
    }
})
