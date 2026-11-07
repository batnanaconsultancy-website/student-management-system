import {
  serverSupabaseClient,
  serverSupabaseServiceRole,
} from '#supabase/server'
import { createError, readBody } from 'h3'
import { requireFinalProjectAdmin } from '~/server/utils/finalProjectAuth'

// POST /api/admin/final-project-assessment/reopen-submission
//
// Section 19's controlled correction flow:
// Request Correction -> Admin Review -> Reopen Assessment -> Examiner Edits -> Resubmit.
//
// This endpoint performs the actual reopen action after the admin's review.
// The reopen and audit-log entries are committed in one database transaction.
//
// The submission deliberately remains SUBMITTED. Examiner endpoints permit
// editing when reopened_at is newer than submitted_at, distinguishing a
// reopened assessment from one that has never been submitted.
//
// Body: { submissionId, reason }
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)

  let adminUser

  try {
    adminUser = await requireFinalProjectAdmin(event, supabase)
  } catch (error) {
    const message = String(error?.statusMessage || error?.message || '')

    if (message === 'Auth session missing!') {
      throw createError({
        statusCode: 401,
        statusMessage: 'Not authenticated',
      })
    }

    throw error
  }

  const body = await readBody(event)
  const submissionId = String(body?.submissionId || '').trim()
  const reason = String(body?.reason || '').trim()

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  if (!uuidPattern.test(submissionId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A valid submissionId is required.',
    })
  }

  if (!reason) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A reason is required so the examiner knows what to fix.',
    })
  }

  if (reason.length > 2000) {
    throw createError({
      statusCode: 400,
      statusMessage: 'The reason must be 2000 characters or fewer.',
    })
  }

  const adminClient = await serverSupabaseServiceRole(event)
  const { data, error } = await adminClient.rpc(
    'reopen_final_project_submission',
    {
      p_submission_id: submissionId,
      p_admin_email: adminUser.email,
      p_reason: reason,
    },
  )

  if (error) {
    const message = String(error.message || '')
    const match = message.match(
      /FP_REOPEN_SUBMISSION_(INVALID|NOT_FOUND|FORBIDDEN|CONFLICT):\s*(.*)/s,
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
        statusMessage: match[2] || 'The submission could not be reopened.',
      })
    }

    throw createError({
      statusCode: 500,
      statusMessage: 'The submission could not be reopened.',
    })
  }

  if (!data?.submission || !data?.auditId) {
    throw createError({
      statusCode: 500,
      statusMessage:
        'The reopen transaction returned an incomplete result. Check the database logs before retrying.',
    })
  }

  return {
    data: {
      submission: data.submission,
    },
  }
})
