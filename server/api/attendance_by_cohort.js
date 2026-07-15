import { createError } from 'h3'
import { serverSupabaseClient } from '#supabase/server'

// Note: this used to compute "attendance %" against expected counts from
// cohort_meeting_stats / cohort_meetings / meeting_types -- tables nothing
// in the real data pipeline ever populates, so every average came out
// null. This now reports real, always-computable numbers per cohort:
// total attended and average attended per student, per meeting type.
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

        // Group students by cohort
        const cohorts = new Map()
        for (const s of students) {
            const cid = s.cohort_id || 'unknown'
            if (!cohorts.has(cid)) cohorts.set(cid, { students: [], totals: { workshops: 0, standups: 0, mentoring: 0 } })
            const entry = cohorts.get(cid)
            entry.students.push(s)
            entry.totals.workshops += Number(s.workshops_attended || 0)
            entry.totals.standups += Number(s.standup_attended || 0)
            entry.totals.mentoring += Number(s.mentoring_attended || 0)
        }

        function perStudent(sum, count) {
            return count > 0 ? Math.round((sum / count) * 100) / 100 : null
        }

        // Build result per cohort
        const result = []
        for (const [cohortId, info] of cohorts.entries()) {
            const studentsCount = info.students.length
            const { workshops, standups, mentoring } = info.totals

            result.push({
                cohort_id: cohortId,
                cohort_name: cohortNameMap.get(cohortId) ?? null,
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
            })
        }

        // Group results by cohort_name (some cohort names like 'Sep 2025' appear across multiple programs)
        const grouped = new Map()
        for (const item of result) {
            const name = item.cohort_name ?? item.cohort_id ?? 'unknown'
            if (!grouped.has(name)) {
                grouped.set(name, {
                    cohort_name: name,
                    cohort_ids: new Set(),
                    students_count: 0,
                    attended: { workshop: 0, standup: 0, mentoring: 0 },
                })
            }

            const g = grouped.get(name)
            g.cohort_ids.add(item.cohort_id)
            g.students_count += item.students_count || 0
            g.attended.workshop += item.attended.workshop
            g.attended.standup += item.attended.standup
            g.attended.mentoring += item.attended.mentoring
        }

        const finalResult = []
        for (const [name, g] of grouped.entries()) {
            const { workshop, standup, mentoring } = g.attended
            finalResult.push({
                cohort_name: name,
                cohort_ids: Array.from(g.cohort_ids),
                students_count: g.students_count,
                attended: g.attended,
                averages: {
                    overall: perStudent(workshop + standup + mentoring, g.students_count),
                    workshop: perStudent(workshop, g.students_count),
                    standup: perStudent(standup, g.students_count),
                    mentoring: perStudent(mentoring, g.students_count),
                },
            })
        }

        return { data: { value: finalResult } }
    } catch (err) {
        console.error('Attendance by cohort handler error', err)
        throw createError({ statusCode: 500, statusMessage: err?.message || 'Internal server error' })
    }
})
