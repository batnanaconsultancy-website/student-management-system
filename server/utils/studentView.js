import { createError, getCookie } from 'h3'
import {
  serverSupabaseServiceRole,
  serverSupabaseUser,
} from '#supabase/server'

export const STUDENT_VIEW_COOKIE = 'student_view_session'
export const STUDENT_VIEW_DURATION_SECONDS = 10 * 60

function forbidden(message = 'Student View access is not permitted') {
  return createError({ statusCode: 403, statusMessage: message })
}

export async function requireStudentViewAdmin(event) {
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Authentication required',
    })
  }

  const service = serverSupabaseServiceRole(event)
  const { data: admin, error } = await service
    .from('admin')
    .select('email')
    .eq('email', user.email)
    .maybeSingle()

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Unable to verify administrator access',
    })
  }

  if (!admin) {
    throw forbidden('Administrator access required')
  }

  return { user, admin, service }
}

export async function getActiveStudentViewSession(event) {
  const sessionId = getCookie(event, STUDENT_VIEW_COOKIE)
  if (!sessionId) return null

  const { user, service } = await requireStudentViewAdmin(event)

  const { data: session, error } = await service
    .from('student_view_sessions')
    .select(
      'id, admin_email, student_id, student_email, reason, student_authorized, status, started_at, expires_at, ended_at'
    )
    .eq('id', sessionId)
    .eq('status', 'active')
    .eq('admin_email', user.email)
    .gt('expires_at', new Date().toISOString())
    .is('ended_at', null)
    .maybeSingle()

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Unable to validate Student View session',
    })
  }

  if (!session) {
    throw forbidden('Student View session is invalid or has expired')
  }

  return { user, service, session }
}

/**
 * Resolve the authenticated student's record or the student bound to
 * the administrator's active, server-validated Student View session.
 * The client cannot choose the target student through request parameters.
 */
export async function resolveStudentViewContext(event, client) {
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Authentication required',
    })
  }

  const service = serverSupabaseServiceRole(event)
  const { data: admin, error: adminError } = await service
    .from('admin')
    .select('email')
    .eq('email', user.email)
    .maybeSingle()

  if (adminError) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Unable to verify account permissions',
    })
  }

  const cookieSessionId = getCookie(event, STUDENT_VIEW_COOKIE)

  if (cookieSessionId) {
    if (!admin) {
      throw forbidden('Student View is only available to administrators')
    }

    const context = await getActiveStudentViewSession(event)

    const { data: student, error } = await service
      .from('students')
      .select('*')
      .eq('id', context.session.student_id)
      .eq('email', context.session.student_email)
      .maybeSingle()

    if (error) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Unable to load the selected student',
      })
    }

    if (!student) {
      throw createError({
        statusCode: 404,
        statusMessage: 'The selected student record no longer exists',
      })
    }

    return {
      user,
      student,
      isStudentView: true,
      session: context.session,
      dataClient: service,
    }
  }

  if (admin) {
    throw forbidden('Start a Student View session before opening the student dashboard')
  }

  const { data: student, error } = await client
    .from('students')
    .select('*')
    .eq('email', user.email)
    .maybeSingle()

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Unable to load the student record',
    })
  }

  if (!student) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Student record not found for this account',
    })
  }

  return {
    user,
    student,
    isStudentView: false,
    session: null,
    dataClient: client,
  }
}

/**
 * Student write handlers must call this before doing any work.
 * Presence of the cookie fails closed, even if the session is stale.
 */
export function rejectStudentViewWrites(event) {
  if (getCookie(event, STUDENT_VIEW_COOKIE)) {
    throw forbidden('This action is disabled in read-only Student View')
  }
}
