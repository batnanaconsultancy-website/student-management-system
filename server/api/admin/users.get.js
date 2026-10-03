import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Not authenticated',
    })
  }

  // Confirm the caller is an admin.
  const { data: callerRow, error: callerError } = await supabase
    .from('admin')
    .select('email')
    .eq('email', user.email)
    .maybeSingle()

  if (callerError) {
    throw createError({
      statusCode: 500,
      statusMessage: callerError.message,
    })
  }

  if (!callerRow) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Admin access required',
    })
  }

  const [
    studentsResult,
    facultyResult,
    adminResult,
    examinersResult,
  ] = await Promise.all([
    supabase
      .from('students')
      .select(
        'id, email, first_name, last_name, account_status, is_active, created_at, last_login'
      ),

    supabase
      .from('faculty')
      .select(
        'id, email, name, is_active, staff_type, created_at, updated_at'
      ),

    supabase
      .from('admin')
      .select('id, email, created_at'),

    supabase
      .from('examiners')
      .select('id, email, name, is_active, created_at, updated_at'),
  ])

  const results = [
    studentsResult,
    facultyResult,
    adminResult,
    examinersResult,
  ]

  const failedResult = results.find((result) => result.error)

  if (failedResult?.error) {
    throw createError({
      statusCode: 500,
      statusMessage: failedResult.error.message,
    })
  }

  const users = new Map()

  const getOrCreateUser = (email) => {
    const normalizedEmail = String(email || '').trim().toLowerCase()

    if (!normalizedEmail) {
      return null
    }

    if (!users.has(normalizedEmail)) {
      users.set(normalizedEmail, {
        email: normalizedEmail,
        name: null,
        type: 'User',
        staff_type: null,
        is_active: false,
        is_admin: false,
        is_faculty: false,
        is_examiner: false,
        student_id: null,
        faculty_id: null,
        admin_id: null,
        examiner_id: null,
        created_at: null,
        last_login: null,
      })
    }

    return users.get(normalizedEmail)
  }

  for (const student of studentsResult.data || []) {
    const row = getOrCreateUser(student.email)

    if (!row) continue

    row.student_id = student.id
    row.name =
      `${student.first_name || ''} ${student.last_name || ''}`.trim() ||
      row.name
    row.type = row.type === 'User' ? 'Student' : row.type
    row.is_active = row.is_active || Boolean(student.is_active)
    row.created_at = row.created_at || student.created_at
    row.last_login = student.last_login || row.last_login
  }

  for (const faculty of facultyResult.data || []) {
    const row = getOrCreateUser(faculty.email)

    if (!row) continue

    row.faculty_id = faculty.id
    row.name = faculty.name || row.name
    row.staff_type = faculty.staff_type
    row.is_faculty = true
    row.is_active = row.is_active || Boolean(faculty.is_active)
    row.created_at = row.created_at || faculty.created_at

    if (row.type === 'User' || row.type === 'Student') {
      row.type = 'Faculty'
    }
  }

  for (const admin of adminResult.data || []) {
    const row = getOrCreateUser(admin.email)

    if (!row) continue

    row.admin_id = admin.id
    row.is_admin = true
    row.is_active = true
    row.created_at = row.created_at || admin.created_at

    if (row.type === 'User') {
      row.type = 'Admin'
    }
  }

  for (const examiner of examinersResult.data || []) {
    const row = getOrCreateUser(examiner.email)

    if (!row) continue

    row.examiner_id = examiner.id
    row.is_examiner = Boolean(examiner.is_active)

    if (!row.name && examiner.name) {
      row.name = examiner.name
    }

    row.is_active = row.is_active || Boolean(examiner.is_active)
    row.created_at = row.created_at || examiner.created_at

    if (row.type === 'User') {
      row.type = 'Examiner'
    }
  }

  const data = Array.from(users.values()).sort((a, b) => {
    const nameA = String(a.name || a.email).toLowerCase()
    const nameB = String(b.name || b.email).toLowerCase()

    return nameA.localeCompare(nameB)
  })

  return {
    data,
    count: data.length,
  }
})
