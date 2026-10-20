import { createError, getQuery } from 'h3'
import { requireStudentViewAdmin } from '~/server/utils/studentView'

export default defineEventHandler(async (event) => {
  const { service } = await requireStudentViewAdmin(event)
  const query = getQuery(event)
  const term = typeof query.q === 'string' ? query.q.trim() : ''

  if (term.length < 2) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Enter at least two characters to search',
    })
  }

  if (term.length > 150) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Search term is too long',
    })
  }

  // Strip SQL LIKE wildcard characters before validating the search.
  // This prevents a wildcard-only query from becoming an effectively empty search.
  const safeTerm = term.replace(/[%_\\]/g, '').trim()

  if (safeTerm.length < 2) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Enter at least two searchable characters',
    })
  }

  // Search by email only to keep the query predictable and safe.
  const { data, error } = await service
    .from('students')
    .select('id, email, first_name, last_name')
    .ilike('email', `%${safeTerm}%`)
    .order('email', { ascending: true })
    .limit(20)

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Student search failed',
    })
  }

  return {
    data: (data || []).map((student) => ({
      id: student.id,
      email: student.email,
      name: [student.first_name, student.last_name].filter(Boolean).join(' ').trim(),
    })),
  }
})
