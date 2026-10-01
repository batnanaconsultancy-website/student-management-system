import { createError } from 'h3'
import { serverSupabaseUser } from '#supabase/server'

// server/utils/finalProjectAuth.js
//
// Auth helpers for the Final Project Assessment module's API
// endpoints. Mirrors the requireCanvasMastersAdmin pattern in
// server/utils/canvasMastersRoster.js so all the "who is this request
// allowed to act as" logic lives in one place per module, rather than
// being copy-pasted into every endpoint.

// Any admin has full access to every Final Project Assessment record
// -- no per-admin scoping, matching every other admin table in this
// app.
export async function requireFinalProjectAdmin(event, supabase) {
  const user = await serverSupabaseUser(event)
  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const { data: adminRow, error: adminError } = await supabase
    .from('admin')
    .select('email')
    .eq('email', user.email)
    .maybeSingle()

  if (adminError) {
    throw createError({ statusCode: 500, statusMessage: adminError.message })
  }
  if (!adminRow) {
    throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
  }

  return user
}

// Resolves the caller's examiner record. Independent of admin status
// -- an admin who is ALSO an examiner still resolves here when they're
// using examiner-facing endpoints (e.g. submitting their own
// assessment as an examiner).
export async function requireExaminer(event, supabase) {
  const user = await serverSupabaseUser(event)
  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const { data: examinerRow, error: examinerError } = await supabase
    .from('examiners')
    .select('id, email, name')
    .eq('email', user.email.toLowerCase())
    .eq('is_active', true)
    .maybeSingle()

  if (examinerError) {
    throw createError({ statusCode: 500, statusMessage: examinerError.message })
  }
  if (!examinerRow) {
    throw createError({ statusCode: 403, statusMessage: 'Examiner access required' })
  }

  return { user, examiner: examinerRow }
}

// For endpoints either an admin OR the examiner assigned to that
// specific record may call (e.g. reading a submission). Returns
// { user, isAdmin, examiner } -- examiner is null if the caller is an
// admin with no examiner record. Does NOT check assignment-level
// scoping (which examiner is linked to which student) -- that's left
// to Postgres RLS on the underlying tables, since it already encodes
// exactly that rule (see the migration's "examiner reads own" style
// policies). This helper only establishes identity, not per-row
// authorization.
export async function requireFinalProjectAdminOrExaminer(event, supabase) {
  const user = await serverSupabaseUser(event)
  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const [adminResult, examinerResult] = await Promise.all([
    supabase.from('admin').select('email').eq('email', user.email).maybeSingle(),
    supabase.from('examiners').select('id, email, name').eq('email', user.email.toLowerCase()).eq('is_active', true).maybeSingle(),
  ])

  const isAdminUser = Boolean(adminResult.data && !adminResult.error)
  const examiner = examinerResult.data && !examinerResult.error ? examinerResult.data : null

  if (!isAdminUser && !examiner) {
    throw createError({ statusCode: 403, statusMessage: 'Admin or examiner access required' })
  }

  return { user, isAdmin: isAdminUser, examiner }
}
