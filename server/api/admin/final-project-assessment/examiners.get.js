import { serverSupabaseClient } from '#supabase/server'
import { requireFinalProjectAdmin } from '~/server/utils/finalProjectAuth'

// GET /api/admin/final-project-assessment/examiners
//
// Full examiner roster (active and inactive), for the "Select
// Instructor(s)" dropdown and the examiner management table. Admin-only.
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  await requireFinalProjectAdmin(event, supabase)

  const { data, error } = await supabase
    .from('examiners')
    .select('id, email, name, is_active, created_at')
    .order('name', { ascending: true })

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  return { data: { examiners: data || [] } }
})
