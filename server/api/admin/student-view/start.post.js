import { createError, deleteCookie, getCookie, getRequestIP, readBody, setCookie } from 'h3'
import {
  requireStudentViewAdmin,
  getActiveStudentViewSession,
  STUDENT_VIEW_COOKIE,
  STUDENT_VIEW_DURATION_SECONDS,
} from '~/server/utils/studentView'

export default defineEventHandler(async (event) => {
  const { user, service } = await requireStudentViewAdmin(event)

  // Enforce one live session across all browsers for this administrator.
  // The unique database index also protects against concurrent start requests.
  const nowIso = new Date().toISOString()

  const { error: expireError } = await service
    .from('student_view_sessions')
    .update({ status: 'expired' })
    .eq('admin_email', user.email)
    .eq('status', 'active')
    .lte('expires_at', nowIso)

  if (expireError) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Unable to validate existing Student View sessions',
    })
  }

  const { data: activeSession, error: activeSessionError } = await service
    .from('student_view_sessions')
    .select('id')
    .eq('admin_email', user.email)
    .eq('status', 'active')
    .gt('expires_at', nowIso)
    .is('ended_at', null)
    .limit(1)
    .maybeSingle()

  if (activeSessionError) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Unable to check for an existing Student View session',
    })
  }

  if (activeSession) {
    throw createError({
      statusCode: 409,
      statusMessage: 'An active Student View session already exists for this administrator. End it before starting another.',
    })
  }

  // Clear an invalid or expired cookie only after checking the database.
  if (getCookie(event, STUDENT_VIEW_COOKIE)) {
    try {
      await getActiveStudentViewSession(event)
      throw createError({
        statusCode: 409,
        statusMessage: 'End the current Student View session before starting another',
      })
    } catch (error) {
      if (error?.statusCode !== 403) throw error
      deleteCookie(event, STUDENT_VIEW_COOKIE, { path: '/' })
    }
  }

  const body = await readBody(event)
  const email = typeof body?.student_email === 'string'
    ? body.student_email.trim()
    : ''
  const reason = typeof body?.reason === 'string'
    ? body.reason.trim()
    : ''

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createError({ statusCode: 400, statusMessage: 'Enter a valid student email' })
  }

  if (reason.length < 10 || reason.length > 1000) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Provide a reason between 10 and 1000 characters',
    })
  }

  if (body?.student_authorized !== true) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Confirm that the student has authorized this troubleshooting session',
    })
  }

  const { data: student, error: studentError } = await service
    .from('students')
    .select('id, email, first_name, last_name')
    .eq('email', email)
    .maybeSingle()

  if (studentError) {
    throw createError({ statusCode: 500, statusMessage: 'Unable to find student record' })
  }

  if (!student) {
    throw createError({ statusCode: 404, statusMessage: 'No student was found for that email' })
  }

  const startedAt = new Date()
  const expiresAt = new Date(
    startedAt.getTime() + STUDENT_VIEW_DURATION_SECONDS * 1000
  )

  const { data: session, error: sessionError } = await service
    .from('student_view_sessions')
    .insert({
      admin_email: user.email,
      student_id: student.id,
      student_email: student.email,
      reason,
      student_authorized: true,
      status: 'active',
      started_at: startedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    .select('id, student_id, student_email, started_at, expires_at')
    .single()

  if (sessionError) {
    if (sessionError.code === '23505') {
      throw createError({
        statusCode: 409,
        statusMessage: 'An active Student View session already exists for this administrator. End it before starting another.',
      })
    }

    throw createError({
      statusCode: 500,
      statusMessage: 'Unable to create Student View session. Check that the migration has been applied.',
    })
  }

  const { error: auditError } = await service.from('audit_log').insert({
    admin_email: user.email,
    action: 'student_view_started',
    entity_type: 'student',
    entity_id: student.id,
    ip_address: getRequestIP(event, { xForwardedFor: true }) || null,
    details: {
      session_id: session.id,
      student_email: student.email,
      reason,
      student_authorized: true,
      expires_at: expiresAt.toISOString(),
    },
  })

  if (auditError) {
    // Fail closed: do not leave a usable session if its audit record failed.
    await service
      .from('student_view_sessions')
      .update({ status: 'ended', ended_at: new Date().toISOString() })
      .eq('id', session.id)

    throw createError({
      statusCode: 500,
      statusMessage: 'Could not record the audit event; Student View was not started',
    })
  }

  setCookie(event, STUDENT_VIEW_COOKIE, session.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: STUDENT_VIEW_DURATION_SECONDS,
  })

  return {
    data: {
      session_id: session.id,
      student_email: student.email,
      student_name: [student.first_name, student.last_name].filter(Boolean).join(' ').trim(),
      started_at: session.started_at,
      expires_at: session.expires_at,
    },
  }
})
