import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'
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
  const examinerIds = Array.isArray(body?.examinerIds) ? body.examinerIds.filter(Boolean) : []
  const assessmentActivated = Boolean(body?.assessmentActivated)
  const season04Overrides = body?.season04Overrides || {}

  if (studentIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Select at least one student.' })
  }
  if (examinerIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Select at least one examiner.' })
  }

  const season4Map = await getSeason4StatusForStudents(supabase, studentIds)
  const nowIso = new Date().toISOString()
  const savedAssignments = []

  // Sequential, not Promise.all -- these are writes with their own
  // dependent inserts (assignment -> examiner links -> submissions),
  // and keeping them sequential makes a partial-failure error message
  // ("failed on student X") actually useful rather than an opaque
  // batch failure.
  for (const studentId of studentIds) {
    const season4 = season4Map.get(studentId) || { isCompleted: false }
    const usingOverride = Boolean(season04Overrides[studentId]) && !season4.isCompleted
    const season04Confirmed = season4.isCompleted || usingOverride

    // 1. Upsert the assignment itself.
    const { data: assignment, error: assignmentError } = await supabase
      .from('final_project_assignments')
      .upsert(
        {
          student_id: studentId,
          season04_confirmed: season04Confirmed,
          season04_override: usingOverride,
          season04_confirmed_by: adminUser.email,
          season04_confirmed_at: nowIso,
          assessment_activated: assessmentActivated,
          activated_by: assessmentActivated ? adminUser.email : null,
          activated_at: assessmentActivated ? nowIso : null,
          archived: false, // re-saving un-archives, since Save implies "this is active again"
          created_by: adminUser.email,
        },
        { onConflict: 'student_id' }
      )
      .select()
      .single()

    if (assignmentError) {
      throw createError({ statusCode: 500, statusMessage: `Student ${studentId}: ${assignmentError.message}` })
    }

    // 2. Replace the examiner links for this assignment with the
    // selected set. Simpler and more predictable than merging/diffing
    // -- "Save" with a chosen examiner list means that's now the
    // examiner list, not "add on top of whoever was there before."
    const { error: deleteLinksError } = await supabase
      .from('final_project_assignment_examiners')
      .delete()
      .eq('assignment_id', assignment.id)
    if (deleteLinksError) {
      throw createError({ statusCode: 500, statusMessage: deleteLinksError.message })
    }

    const { error: insertLinksError } = await supabase
      .from('final_project_assignment_examiners')
      .insert(
        examinerIds.map((examinerId) => ({
          assignment_id: assignment.id,
          examiner_id: examinerId,
          assigned_by: adminUser.email,
        }))
      )
    if (insertLinksError) {
      throw createError({ statusCode: 500, statusMessage: insertLinksError.message })
    }

    // 3. Ensure both submission rows exist, with status reflecting
    // activation -- but ONLY when the current status hasn't moved past
    // ASSIGNED yet (never touch IN_PROGRESS/SUBMITTED/ARCHIVED here).
    for (const assessmentType of ['submission', 'presentation']) {
      const { data: existingSubmission, error: existingError } = await supabase
        .from('final_project_submissions')
        .select('id, status')
        .eq('assignment_id', assignment.id)
        .eq('assessment_type', assessmentType)
        .maybeSingle()

      if (existingError) {
        throw createError({ statusCode: 500, statusMessage: existingError.message })
      }

      const targetStatus = assessmentActivated ? 'ACTIVATED' : 'ASSIGNED'

      if (!existingSubmission) {
        const { error: insertSubError } = await supabase.from('final_project_submissions').insert({
          assignment_id: assignment.id,
          assessment_type: assessmentType,
          status: targetStatus,
        })
        if (insertSubError) {
          throw createError({ statusCode: 500, statusMessage: insertSubError.message })
        }
      } else if (['NOT_ASSIGNED', 'ASSIGNED', 'ACTIVATED'].includes(existingSubmission.status)) {
        // Still safe to move between these three -- examiner hasn't
        // started entering grades yet.
        const { error: updateSubError } = await supabase
          .from('final_project_submissions')
          .update({ status: targetStatus })
          .eq('id', existingSubmission.id)
        if (updateSubError) {
          throw createError({ statusCode: 500, statusMessage: updateSubError.message })
        }
      }
      // else: IN_PROGRESS / SUBMITTED / ARCHIVED -- deliberately left untouched.
    }

    await supabase.from('audit_log').insert({
      admin_email: adminUser.email,
      action: 'final_project_assignment_saved',
      entity_type: 'final_project_assignment',
      entity_id: assignment.id,
      details: {
        studentId,
        examinerIds,
        assessmentActivated,
        season04Confirmed,
        season04Override: usingOverride,
      },
    })

    savedAssignments.push(assignment)
  }

  return { data: { assignments: savedAssignments } }
})
