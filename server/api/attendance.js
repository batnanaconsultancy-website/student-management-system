import { createError } from 'h3'
import { serverSupabaseClient } from '#supabase/server'

// Note: this endpoint used to compute "attendance %" as attended / expected,
// where "expected" came from cohort_meeting_stats / cohort_meetings /
// meeting_types. Nothing in the actual data pipeline (scripts/update_attendance.py)
// ever writes to those tables -- they're leftover from an earlier design and
// stay permanently empty/stale, so that division always produced 0/null.
// This now reports real, always-computable numbers instead: total attended
// counts (already correct), average attended per student, and a percentage
// attendance figure defined relative to the single top attendee across all
// students (attended / highest attended, averaged across students) -- a
// relative engagement measure rather than "% of sessions held".
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

        // Percentage relative to the top attendee across the whole student body:
        // value / max, as a 0-100 figure. If max is 0, everyone is 0%.
        function pctOfMax(value, max) {
            if (!max || max <= 0) return 0
            return Math.round((value / max) * 10000) / 100
        }

        let maxWorkshop = 0
        let maxStandup = 0
        let maxMentoring = 0
        let maxOverall = 0

        const perStudentTotals = students.map((s) => {
            const w = Number(s.workshops_attended || 0)
            const st = Number(s.standup_attended || 0)
            const m = Number(s.mentoring_attended || 0)
            const total = w + st + m

            if (w > maxWorkshop) maxWorkshop = w
            if (st > maxStandup) maxStandup = st
            if (m > maxMentoring) maxMentoring = m
            if (total > maxOverall) maxOverall = total

            return { w, st, m, total }
        })

        let pctOverallSum = 0
        let pctWorkshopSum = 0
        let pctStandupSum = 0
        let pctMentoringSum = 0

        for (const p of perStudentTotals) {
            pctOverallSum += pctOfMax(p.total, maxOverall)
            pctWorkshopSum += pctOfMax(p.w, maxWorkshop)
            pctStandupSum += pctOfMax(p.st, maxStandup)
            pctMentoringSum += pctOfMax(p.m, maxMentoring)
        }

        const avgPct = (sum) => studentCount > 0 ? Math.round((sum / studentCount) * 100) / 100 : null

        const result = [
            { metric: 'overall_avg', value: avgOverall },
            { metric: 'workshop_avg', value: avgWorkshop },
            { metric: 'standup_avg', value: avgStandup },
            { metric: 'mentoring_avg', value: avgMentoring },
            { metric: 'overall_pct', value: avgPct(pctOverallSum) },
            { metric: 'workshop_pct', value: avgPct(pctWorkshopSum) },
            { metric: 'standup_pct', value: avgPct(pctStandupSum) },
            { metric: 'mentoring_pct', value: avgPct(pctMentoringSum) },
            { metric: 'workshop_attended', count: sumWorkshopAttended },
            { metric: 'standup_attended', count: sumStandupAttended },
            { metric: 'mentoring_attended', count: sumMentoringAttended },
            { metric: 'student_count', count: studentCount },
            { metric: 'overall_max', count: maxOverall },
            { metric: 'workshop_max', count: maxWorkshop },
            { metric: 'standup_max', count: maxStandup },
            { metric: 'mentoring_max', count: maxMentoring },
        ]

        return { data: { value: result } }
    } catch (err) {
        console.error('Attendance handler error', err)
        throw createError({ statusCode: 500, statusMessage: err?.message || 'Internal server error' })
    }
})
