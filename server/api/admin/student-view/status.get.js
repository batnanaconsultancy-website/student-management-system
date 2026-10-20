import { deleteCookie, getCookie, setResponseHeader } from 'h3'
import {
  requireStudentViewAdmin,
  getActiveStudentViewSession,
  STUDENT_VIEW_COOKIE,
} from '~/server/utils/studentView'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store, private')
  setResponseHeader(event, 'Pragma', 'no-cache')

  await requireStudentViewAdmin(event)

  if (!getCookie(event, STUDENT_VIEW_COOKIE)) {
    return { active: false }
  }

  try {
    const { session, service } = await getActiveStudentViewSession(event)

    const { data: student, error } = await service
      .from('students')
      .select('id, email, first_name, last_name')
      .eq('id', session.student_id)
      .maybeSingle()

    if (error || !student) {
      throw new Error('Student record unavailable')
    }

    setResponseHeader(event, 'Cache-Control', 'no-store, private')

    return {
      active: true,
      session: {
        id: session.id,
        student_id: student.id,
        student_email: student.email,
        student_name: [student.first_name, student.last_name].filter(Boolean).join(' ').trim(),
        reason: session.reason,
        started_at: session.started_at,
        expires_at: session.expires_at,
      },
    }
  } catch (error) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      deleteCookie(event, STUDENT_VIEW_COOKIE, { path: '/' })
      return { active: false }
    }

    // Preserve the cookie when a server/database error can be retried.
    throw error
  }
})
