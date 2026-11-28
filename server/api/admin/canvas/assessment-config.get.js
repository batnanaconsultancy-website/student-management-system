import { createError } from 'h3'
import { serverSupabaseClient } from '#supabase/server'
import { requireCanvasAssessmentAdmin } from '~/server/utils/canvasAssessmentAuth'

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  await requireCanvasAssessmentAdmin(event, supabase)

  const [coursesResult, assignmentsResult, examinersResult, facultyResult, linksResult] = await Promise.all([
    supabase.from('canvas_assessment_courses')
      .select('scope, canvas_course_id, is_enabled, selected_by, selected_at'),
    supabase.from('canvas_assessment_assignments')
      .select('scope, canvas_course_id, canvas_assignment_id, is_assessment, selected_by, selected_at'),
    supabase.from('examiners')
      .select('id, name, email, is_active')
      .eq('is_active', true)
      .order('name'),
    supabase.from('faculty')
      .select('email')
      .eq('is_active', true)
      .eq('staff_type', 'teaching'),
    supabase.from('canvas_assessment_examiners')
      .select('examiner_id, scope, assigned_by, assigned_at'),
  ])

  for (const result of [coursesResult, assignmentsResult, examinersResult, facultyResult, linksResult]) {
    if (result.error) throw createError({ statusCode: 500, statusMessage: result.error.message })
  }

  return {
    data: {
      courses: coursesResult.data || [],
      assignments: assignmentsResult.data || [],
      examiners: (examinersResult.data || []).filter((examiner) =>
        (facultyResult.data || []).some((faculty) =>
          String(faculty.email || '').toLowerCase() === String(examiner.email || '').toLowerCase()
        )
      ),
      examinerScopes: linksResult.data || [],
    },
  }
})
