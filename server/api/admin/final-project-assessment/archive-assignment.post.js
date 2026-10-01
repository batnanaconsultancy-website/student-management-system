import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'
import { createError, readBody } from 'h3'
import { requireFinalProjectAdmin } from '~/server/utils/finalProjectAuth'

// POST /api/admin/final-project-assessment/archive-assignment
//
// Section 6: "Archive =/= Delete." Hides an assignment from the active
// list without touching any of its submissions/grades/signatures --
// those remain fully intact and visible in the historical Preview
// (Section 7).
//
// Body: { assignmentId, archived: boolean }
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  await requireFinalProjectAdmin(event, supabase)
  const adminUser = await serverSupabaseUser(event)

  const body = await readBody(event)
  const assignmentId = body?.assignmentId
  const archived = Boolean(body?.archived)

  if (!assignmentId) {
    throw createError({ statusCode: 400, statusMessage: 'assignmentId is required' })
  }

  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('final_project_assignments')
    .update({
      archived,
      archived_by: archived ? adminUser.email : null,
      archived_at: archived ? nowIso : null,
    })
    .eq('id', assignmentId)
    .select()
    .single()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  await supabase.from('audit_log').insert({
    admin_email: adminUser.email,
    action: archived ? 'final_project_assignment_archived' : 'final_project_assignment_unarchived',
    entity_type: 'final_project_assignment',
    entity_id: assignmentId,
    details: {},
  })

  return { data: { assignment: data } }
})
