import { createError } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'
import { writeAuditLog } from '~/server/utils/auditLog'

// Map program name variations to database names
const programNameMap = {
  'AI and Machine Learning': 'AI/ML',
  'AI/ML': 'AI/ML',
  'Data Science': 'Data Science',
  'Software Engineering': 'Software Engineering'
}

export default defineEventHandler(async (event) => {
  try {
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

    if (!body.students || !Array.isArray(body.students)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid request: students array required'
      })
    }

    // Fetch all cohorts and programs for mapping
    const { data: cohorts, error: cohortsError } = await client
      .from('cohorts')
      .select('id, name, program_id')

    if (cohortsError) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to fetch cohorts'
      })
    }

    const { data: programs, error: programsError } = await client
      .from('programs')
      .select('id, name')

    if (programsError) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to fetch programs'
      })
    }

    // Create lookup maps
    const programMap = new Map(programs.map(p => [p.name, p.id]))

    // Create cohort map by cohort name + program_id
    const cohortMap = new Map()
    cohorts.forEach(c => {
      const key = `${c.name}|${c.program_id}`
      cohortMap.set(key, c.id)
    })

    const studentsToInsert = []
    const errors = []

    // Track emails and usernames within the CSV to detect duplicates
    const csvEmails = new Set()
    const csvUsernames = new Set()

    for (let i = 0; i < body.students.length; i++) {
      const student = body.students[i]

      try {
        // Check for duplicates within the CSV file
        if (csvEmails.has(student.email)) {
          errors.push(`Row ${i + 2}: Duplicate email "${student.email}" in CSV file`)
          continue
        }
        if (student.qwasarId && csvUsernames.has(student.qwasarId)) {
          errors.push(`Row ${i + 2}: Duplicate Qwasar ID "${student.qwasarId}" in CSV file`)
          continue
        }

        // Map program name
        const programName = programNameMap[student.programme] || student.programme

        // Find program ID first
        const programId = programMap.get(programName)
        if (!programId) {
          errors.push(`Row ${i + 2}: Program "${student.programme}" not found`)
          continue
        }

        // Find cohort ID using both cohort name and program_id
        const cohortKey = `${student.cohort}|${programId}`
        const cohortId = cohortMap.get(cohortKey)
        if (!cohortId) {
          errors.push(`Row ${i + 2}: Cohort "${student.cohort}" with program "${programName}" not found`)
          continue
        }

        // Split name into first and last name
        const nameParts = student.name.trim().split(' ')
        const firstName = nameParts[0]
        const lastName = nameParts.slice(1).join(' ') || nameParts[0]

        // Add to CSV tracking sets
        csvEmails.add(student.email)
        if (student.qwasarId) {
          csvUsernames.add(student.qwasarId)
        }

        studentsToInsert.push({
          username: student.qwasarId || null,
          email: student.email,
          first_name: firstName,
          last_name: lastName,
          cohort_id: cohortId,
          program_id: programId,
          status: null,
          role: 'student',
          is_active: true,
          exercises_completed: 0,
          points: 0,
          workshops_attended: 0,
          standup_attended: 0,
          mentoring_attended: 0
        })
      } catch (error) {
        errors.push(`Row ${i + 2}: ${error.message}`)
      }
    }

    if (studentsToInsert.length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'No valid students to import',
        data: { errors }
      })
    }

    // Check for existing students by username and email
    const usernames = studentsToInsert.map(s => s.username).filter(u => u !== null)
    const emails = studentsToInsert.map(s => s.email)

    const { data: existingStudents } = await client
      .from('students')
      .select('username, email')
      .or(`username.in.(${usernames.join(',')}),email.in.(${emails.join(',')})`)

    const existingUsernames = new Set(existingStudents?.map(s => s.username) || [])
    const existingEmails = new Set(existingStudents?.map(s => s.email) || [])

    // Filter out duplicates
    const newStudents = []
    const skipped = []

    studentsToInsert.forEach((student, index) => {
      if (existingUsernames.has(student.username) || existingEmails.has(student.email)) {
        skipped.push(`Skipped: ${student.first_name} ${student.last_name} (${student.email}) - already exists`)
      } else {
        newStudents.push(student)
      }
    })

    let insertedCount = 0
    let insertedStudents = []

    if (newStudents.length > 0) {
      // Insert only new students
      const { data, error: insertError } = await client
        .from('students')
        .insert(newStudents)
        .select()

      if (insertError) {
        console.error('Insert error:', insertError)
        throw createError({
          statusCode: 500,
          statusMessage: `Failed to insert students: ${insertError.message}`,
          data: { errors: [...errors, ...skipped] }
        })
      }

      insertedStudents = data
      insertedCount = data.length
    }

    // Throw error if no students were inserted
    if (insertedCount === 0 && skipped.length > 0) {
      throw createError({
        statusCode: 400,
        statusMessage: `All ${skipped.length} students were skipped - they already exist in the database`,
        data: { errors: [...errors, ...skipped] }
      })
    }

    await writeAuditLog(client, user.email, 'import_students', 'student', null,
      { inserted: insertedCount, skipped: skipped.length }, event)

    return {
      success: true,
      inserted: insertedCount,
      skipped: skipped.length,
      errors: [...errors, ...skipped].length > 0 ? [...errors, ...skipped] : undefined,
      students: insertedStudents
    }

  } catch (error) {
    console.error('Import error:', error)
    throw createError({
      statusCode: error.statusCode || 500,
      statusMessage: error.statusMessage || 'Failed to import students',
      data: error.data
    })
  }
})
