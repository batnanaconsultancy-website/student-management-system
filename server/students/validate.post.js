import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'

// POST /api/students/validate
// Body: { students: [...] }  — same shape as /api/students/import
// Runs the full validation logic (program lookup, cohort lookup, duplicate check)
// but NEVER writes to the database. Returns a preview of what would happen:
//   - valid: rows that would be inserted
//   - duplicates: rows that already exist (would be skipped)
//   - errors: rows with problems (bad program, missing cohort, etc.)
// Used by the CSV preview step before the real import.

const programNameMap = {
  'AI and Machine Learning': 'AI/ML',
  'AI/ML': 'AI/ML',
  'Data Science': 'Data Science',
  'Software Engineering': 'Software Engineering'
}

export default defineEventHandler(async (event) => {
  const client = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const { data: callerRow, error: callerError } = await client
    .from('admin')
    .select('email')
    .eq('email', user.email)
    .maybeSingle()

  if (callerError) {
    throw createError({ statusCode: 500, statusMessage: callerError.message })
  }
  if (!callerRow) {
    throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
  }

  const body = await readBody(event)
  if (!body?.students || !Array.isArray(body.students)) {
    throw createError({ statusCode: 400, statusMessage: 'students array required' })
  }

  const { data: cohorts } = await client.from('cohorts').select('id, name, program_id')
  const { data: programs } = await client.from('programs').select('id, name')

  const programMap = new Map(programs.map(p => [p.name, p.id]))
  const cohortMap = new Map()
  cohorts.forEach(c => cohortMap.set(`${c.name}|${c.program_id}`, c.id))

  const valid = []
  const errors = []
  const csvEmails = new Set()
  const csvUsernames = new Set()

  for (let i = 0; i < body.students.length; i++) {
    const s = body.students[i]
    const rowNum = i + 2

    if (!s.name?.trim()) {
      errors.push({ row: rowNum, email: s.email, reason: 'Name is missing' })
      continue
    }
    if (!s.email?.trim() || !s.email.includes('@')) {
      errors.push({ row: rowNum, email: s.email, reason: 'Email is invalid or missing' })
      continue
    }
    if (csvEmails.has(s.email)) {
      errors.push({ row: rowNum, email: s.email, reason: 'Duplicate email within this CSV' })
      continue
    }
    if (s.qwasarId && csvUsernames.has(s.qwasarId)) {
      errors.push({ row: rowNum, email: s.email, reason: `Duplicate Qwasar ID "${s.qwasarId}" within this CSV` })
      continue
    }

    const programName = programNameMap[s.programme] || s.programme
    const programId = programMap.get(programName)
    if (!programId) {
      errors.push({ row: rowNum, email: s.email, reason: `Programme "${s.programme}" not found — must be exactly: Software Engineering, Data Science, or AI/ML` })
      continue
    }

    const cohortId = cohortMap.get(`${s.cohort}|${programId}`)
    if (!cohortId) {
      errors.push({ row: rowNum, email: s.email, reason: `Cohort "${s.cohort}" not found for programme "${programName}"` })
      continue
    }

    csvEmails.add(s.email)
    if (s.qwasarId) csvUsernames.add(s.qwasarId)

    const nameParts = s.name.trim().split(' ')
    valid.push({
      row: rowNum,
      name: s.name.trim(),
      first_name: nameParts[0],
      last_name: nameParts.slice(1).join(' ') || nameParts[0],
      email: s.email,
      username: s.qwasarId || null,
      programme: programName,
      cohort: s.cohort,
      program_id: programId,
      cohort_id: cohortId
    })
  }

  // Check valid rows against existing students
  const emails = valid.map(s => s.email)
  const usernames = valid.map(s => s.username).filter(Boolean)

  let existingEmails = new Set()
  let existingUsernames = new Set()

  if (emails.length > 0) {
    const { data: existing } = await client
      .from('students')
      .select('email, username')
      .or(`email.in.(${emails.join(',')}),username.in.(${usernames.length ? usernames.join(',') : 'null'})`)

    existingEmails = new Set(existing?.map(s => s.email) || [])
    existingUsernames = new Set(existing?.map(s => s.username).filter(Boolean) || [])
  }

  const toInsert = []
  const duplicates = []

  valid.forEach(s => {
    if (existingEmails.has(s.email) || (s.username && existingUsernames.has(s.username))) {
      duplicates.push({ row: s.row, name: s.name, email: s.email, reason: 'Already exists in database — will be skipped' })
    } else {
      toInsert.push(s)
    }
  })

  return {
    summary: {
      total: body.students.length,
      will_insert: toInsert.length,
      will_skip: duplicates.length,
      has_errors: errors.length
    },
    to_insert: toInsert,
    duplicates,
    errors
  }
})
