import { serverSupabaseClient, serverSupabaseServiceRole, serverSupabaseUser } from '#supabase/server'
import { createError, readBody } from 'h3'
import { requireFinalProjectAdmin } from '~/server/utils/finalProjectAuth'
import { getSeason4StatusForStudents } from '~/server/utils/finalProjectSeason4'

// POST /api/admin/final-project-assessment/save-assignment
//
// The "SAVE" button at the end of the Admin workflow (spec Section 5):
//   Examiner(s) -> Assigned Student(s) -> Season 04 Completion -> Activated
//
// Body:
//   {
//     studentIds: string[],       // one or more
//     examinerIds: string[],      // one or more
//     assessmentActivated: bool,
//     season04Overrides?: { [studentId]: boolean }  // admin override when actual completion is false
//   }
//
// Handles BOTH creating a brand new assignment and editing an existing
// one (re-running Save on an already-assigned student updates that
// student's row rather than erroring or duplicating it -- enforced by
// the UNIQUE(student_id) constraint on final_project_assignments).
//
// IMPORTANT: never downgrades or clobbers a submission that's already
// IN_PROGRESS or SUBMITTED. Activating/deactivating only affects
// submissions still at NOT_ASSIGNED/ASSIGNED -- an examiner who has
// already started or finished their assessment is never silently reset
// by the admin re-saving the assignment.
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  await requireFinalProjectAdmin(event, supabase)
  const adminUser = await serverSupabaseUser(event)

  const body = await readBody(event)
  const studentIds = Array.isArray(body?.studentIds) ? body.studentIds.filter(Boolean) : []
  const examinerIds = Array.isArray(body?.examinerIds)
    ? [...new Set(body.examinerIds.filter(Boolean))]
    : []
  const assessmentActivated = Boolean(body?.assessmentActivated)
  const season04Overrides = body?.season04Overrides || {}

  if (studentIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Select at least one student.' })
  }
  if (examinerIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Select at least one examiner.' })
  }

  const season4Map = await getSeason4StatusForStudents(supabase, studentIds)
  const serviceRole = await serverSupabaseServiceRole(event)
  const savedAssignments = []

  // Keep calls sequential so partial failures identify the affected student.
  for (const studentId of studentIds) {
    const season4 = season4Map.get(studentId) || { isCompleted: false }
    const usingOverride = Boolean(season04Overrides[studentId]) && !season4.isCompleted
    const season04Confirmed = season4.isCompleted || usingOverride

    const { data: rpcData, error: rpcError } = await serviceRole.rpc(
      'save_final_project_assignment_atomic',
      {
        p_student_id: studentId,
        p_examiner_ids: examinerIds,
        p_season04_confirmed: season04Confirmed,
        p_season04_override: usingOverride,
        p_assessment_activated: assessmentActivated,
        p_admin_email: adminUser.email,
      },
    )

    if (rpcError) {
      const match = String(rpcError.message || '').match(
        /FP_ASSIGNMENT_(INVALID|NOT_FOUND|FORBIDDEN|CONFLICT):\s*(.*)/s,
      )

      if (match) {
        const statusCode = {
          INVALID: 400,
          NOT_FOUND: 404,
          FORBIDDEN: 403,
          CONFLICT: 409,
        }[match[1]]

        throw createError({
          statusCode,
          statusMessage: `Student ${studentId}: ${match[2].trim()}`,
        })
      }

      console.error('Atomic final project assignment save failed:', {
        studentId,
        message: rpcError.message,
        code: rpcError.code,
      })
      throw createError({
        statusCode: 500,
        statusMessage: `Student ${studentId}: Unable to save the final project assignment.`,
      })
    }

    if (!rpcData?.assignment?.id || rpcData.assignment.student_id !== studentId) {
      console.error('Atomic assignment RPC returned an unexpected result:', {
        studentId,
        rpcData,
      })
      throw createError({
        statusCode: 500,
        statusMessage: `Student ${studentId}: Assignment save returned an unexpected result.`,
      })
    }

    savedAssignments.push(rpcData.assignment)
  }

  return { data: { assignments: savedAssignments } }
})
