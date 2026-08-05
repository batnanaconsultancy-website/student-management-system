import { createError } from 'h3'
import { serverSupabaseClient } from '#supabase/server'

// Note: this used to compute "attendance %" against expected counts from
// cohort_meeting_stats / cohort_meetings / meeting_types -- tables nothing
// in the real data pipeline ever populates, so every average came out
// null. This reports real, always-computable numbers per cohort: total
// attended and average attended per student, per meeting type.
//
// It also reports a "percentage attendance" figure. Since there's no
// populated "expected sessions" table to use as a denominator, this is
// defined relative to the cohort's own top attendee: for each student,
// pct = their attended count / the highest attended count in their cohort.
// The cohort's percentage is the average of that across its students.
// This is a relative engagement measure, not literal "% of sessions held".
export default defineEventHandler(async (event) => {
    try {
        const client = await serverSupabaseClient(event)

        // Fetch all students with cohort ids and attendance counters (including inactive students)
        const { data: students = [], error: studentsErr } = await client
            .from('students')
            .select('id,username,cohort_id,workshops_attended,standup_attended,mentoring_attended')

        if (studentsErr) {
            console.error('Error fetching students', studentsErr)
            throw createError({ statusCode: 500, statusMessage: studentsErr.message || 'Failed fetching students' })
        }

        // Fetch cohort names so we can include cohort_name in the output
        const { data: cohortsTable = [] } = await client
            .from('cohorts')
            .select('id,name')

        const cohortNameMap = new Map()
        for (const c of cohortsTable) {
            cohortNameMap.set(c.id, c.name)
        }

        function perStudent(sum, count) {
            return count > 0 ? Math.round((sum / count) * 100) / 100 : null
        }

        // Percentage relative to the top attendee: value / max, as a 0-100 figure.
        // If max is 0 (nobody in the group attended anything), treat everyone as 0%.
        function pctOfMax(value, max) {
            if (!max || max <= 0) return 0
            return Math.round((value / max) * 10000) / 100
        }

        // Group students directly by cohort_name (some cohort names like
        // 'Sep 2025' appear across multiple programs/cohort ids, and we want
        // those combined into a single reported group, top-attendee included).
        const grouped = new Map()
        for (const s of students) {
            const name = cohortNameMap.get(s.cohort_id) ?? s.cohort_id ?? 'Unknown Cohort'
            if (!grouped.has(name)) {
                grouped.set(name, { cohort_name: name, cohort_ids: new Set(), students: [] })
            }
            const g = grouped.get(name)
            g.cohort_ids.add(s.cohort_id)
            g.students.push(s)
        }

        const finalResult = []
        for (const [name, g] of grouped.entries()) {
            const studentsCount = g.students.length

            let workshops = 0
            let standups = 0
            let mentoring = 0

            let maxWorkshop = 0
            let maxStandup = 0
            let maxMentoring = 0
            let maxOverall = 0

            const perStudentTotals = []
            for (const s of g.students) {
                const w = Number(s.workshops_attended || 0)
                const st = Number(s.standup_attended || 0)
                const m = Number(s.mentoring_attended || 0)
                const total = w + st + m

                workshops += w
                standups += st
                mentoring += m

                if (w > maxWorkshop) maxWorkshop = w
                if (st > maxStandup) maxStandup = st
                if (m > maxMentoring) maxMentoring = m
                if (total > maxOverall) maxOverall = total

                perStudentTotals.push({ w, st, m, total })
            }

            // Average each student's percentage-of-top-attendee, per type and overall
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

            const avgPct = (sum) => studentsCount > 0 ? Math.round((sum / studentsCount) * 100) / 100 : null

            finalResult.push({
                cohort_name: name,
                cohort_ids: Array.from(g.cohort_ids),
                students_count: studentsCount,
                attended: {
                    workshop: workshops,
                    standup: standups,
                    mentoring: mentoring,
                },
                averages: {
                    overall: perStudent(workshops + standups + mentoring, studentsCount),
                    workshop: perStudent(workshops, studentsCount),
                    standup: perStudent(standups, studentsCount),
                    mentoring: perStudent(mentoring, studentsCount),
                },
                // Percentage attendance relative to this cohort's own top attendee.
                percentages: {
                    overall: avgPct(pctOverallSum),
                    workshop: avgPct(pctWorkshopSum),
                    standup: avgPct(pctStandupSum),
                    mentoring: avgPct(pctMentoringSum),
                },
                // Raw counts used as the 100% reference, for transparency in the UI.
                top_attendee: {
                    overall: maxOverall,
                    workshop: maxWorkshop,
                    standup: maxStandup,
                    mentoring: maxMentoring,
                },
            })
        }

        return { data: { value: finalResult } }
    } catch (err) {
        console.error('Attendance by cohort handler error', err)
        throw createError({ statusCode: 500, statusMessage: err?.message || 'Internal server error' })
    }
})
