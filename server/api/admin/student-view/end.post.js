import { createError, deleteCookie, getCookie, getRequestIP } from 'h3'
import {
  requireStudentViewAdmin,
  STUDENT_VIEW_COOKIE,
} from '~/server/utils/studentView'

export default defineEventHandler(async (event) => {
  const { user, service } = await requireStudentViewAdmin(event)
  const sessionId = getCookie(event, STUDENT_VIEW_COOKIE)

  if (!sessionId) {
    deleteCookie(event, STUDENT_VIEW_COOKIE, { path: '/' })
    return { data: { ended: false } }
  }

  const { data: session, error: lookupError } = await service
    .from('student_view_sessions')
    .select('id, student_id, student_email, status')
    .eq('id', sessionId)
    .eq('admin_email', user.email)
    .maybeSingle()

  if (lookupError) {
    throw createError({ statusCode: 500, statusMessage: 'Unable to load Student View session' })
  }

  if (!session || session.status !== 'active') {
    deleteCookie(event, STUDENT_VIEW_COOKIE, { path: '/' })
    return { data: { ended: false } }
  }

  const endedAt = new Date().toISOString()

  const { data: endedSession, error: updateError } = await service
    .from('student_view_sessions')
    .update({ status: 'ended', ended_at: endedAt })
    .eq('id', session.id)
    .eq('status', 'active')
    .select('id')
    .maybeSingle()

  if (updateError) {
    throw createError({ statusCode: 500, statusMessage: 'Unable to end Student View session' })
  }

  // Another request may have ended the session after our initial lookup.
  if (!endedSession) {
    deleteCookie(event, STUDENT_VIEW_COOKIE, { path: '/' })
    return { data: { ended: false } }
  }

  // The database session is ended; now clear the browser cookie.
  deleteCookie(event, STUDENT_VIEW_COOKIE, { path: '/' })

  const { error: auditError } = await service.from('audit_log').insert({
    admin_email: user.email,
    action: 'student_view_ended',
    entity_type: 'student',
    entity_id: session.student_id,
    ip_address: getRequestIP(event, { xForwardedFor: true }) || null,
    details: {
      session_id: session.id,
      student_email: session.student_email,
      ended_at: endedAt,
    },
  })

  if (auditError) {
    // The session has been ended already. Report the audit failure explicitly.
    throw createError({
      statusCode: 500,
      statusMessage: 'Session ended, but its audit event could not be recorded',
    })
  }

  return { data: { ended: true, ended_at: endedAt } }
})
