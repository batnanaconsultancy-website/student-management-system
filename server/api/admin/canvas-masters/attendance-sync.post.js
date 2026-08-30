import { createError, readBody } from 'h3'
import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'
import { writeAuditLog } from '~/server/utils/auditLog'

// POST /api/admin/canvas/attendance-sync
// Body: { sheetUrl?: string }
//
// Imports the Masters attendance Google Sheet, which is a raw
// Zoom/Meet attendance log: one row per (meeting, attendee), with
// columns "Meeting Date", "First Name", "Last name", "Email",
// "Duration" (e.g. "1 hr 31 mins", "43 secs"), "Time joined",
// "Time exited", "File ID" -- confirmed against an actual export of
// the sheet. All four tabs in that workbook (Master Sheet, TechMBA,
// DS AI & Leadership, Leadership Modules) share this exact column
// layout, just filtered to different students, so this works
// regardless of which tab's gid is in the URL.
//
// This aggregates the raw log into one row per student: how many
// DISTINCT meetings they attended (deduped by the sheet's `File ID`,
// which uniquely identifies each meeting -- a student can have
// multiple join/leave rows in the same meeting after a disconnect,
// so counting rows directly would overcount) and their total minutes
// across all of them. Percentages (relative to the top attendee in
// their cohort) are computed at read time in the overview route, not
// here, so they stay correct as the roster changes without a re-sync.
//
// REQUIREMENT: the sheet must be shared as "Anyone with the link can
// view", since this fetches it unauthenticated.
export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient(event)
  const user = await serverSupabaseUser(event)

  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const { data: callerRow, error: callerError } = await supabase
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

  const body = await readBody(event).catch(() => ({}))
  const config = useRuntimeConfig()
  const sheetUrl = body?.sheetUrl || config.canvasAttendanceSheetUrl

  if (!sheetUrl) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'No sheet URL provided. Pass sheetUrl in the request body, or set CANVAS_ATTENDANCE_SHEET_URL in the server environment.',
    })
  }

  const csvUrl = toCsvExportUrl(sheetUrl)

  let csvText
  try {
    const response = await fetch(csvUrl)
    if (!response.ok) {
      throw new Error(`Sheet fetch failed with status ${response.status}`)
    }
    csvText = await response.text()
  } catch (err) {
    throw createError({
      statusCode: 502,
      statusMessage: `Could not fetch the Google Sheet: ${err.message}. Make sure it's shared as "Anyone with the link can view".`,
    })
  }

  // A sheet that isn't actually public returns Google's HTML login
  // page, not CSV -- catch that early with a clear error.
  if (csvText.trim().startsWith('<')) {
    throw createError({
      statusCode: 502,
      statusMessage:
        'The sheet did not return CSV data (got an HTML page instead). It likely needs to be shared as "Anyone with the link can view".',
    })
  }

  const rows = parseCsv(csvText)
  if (rows.length < 2) {
    throw createError({ statusCode: 502, statusMessage: 'Sheet appears to be empty.' })
  }

  const headers = rows[0].map((h) => h.trim())
  const col = (name) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase())

  const emailIdx = col('Email')
  const firstNameIdx = col('First Name')
  const lastNameIdx = col('Last name')
  const durationIdx = col('Duration')
  const fileIdIdx = col('File ID')
  const meetingDateIdx = col('Meeting Date')

  if (emailIdx === -1) {
    throw createError({
      statusCode: 502,
      statusMessage: `Could not find an "Email" column in the sheet. Headers found: ${headers.join(', ')}`,
    })
  }

  // Placeholder/host rows to exclude -- not real students, so they
  // shouldn't be aggregated as attendance for anyone, and shouldn't
  // skew the "top attendee" comparison in the overview page.
  const isPlaceholderEmail = (email) => email.startsWith('masters.')

  // email -> { firstName, lastName, meetingIds: Set, totalMinutes }
  const byEmail = new Map()

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const email = (row[emailIdx] || '').trim().toLowerCase()
    if (!email || !email.includes('@') || isPlaceholderEmail(email)) continue

    if (!byEmail.has(email)) {
      byEmail.set(email, {
        firstName: firstNameIdx !== -1 ? row[firstNameIdx] || '' : '',
        lastName: lastNameIdx !== -1 ? row[lastNameIdx] || '' : '',
        meetingIds: new Set(),
        totalMinutes: 0,
      })
    }
    const entry = byEmail.get(email)

    const meetingKey =
      fileIdIdx !== -1 && row[fileIdIdx]
        ? row[fileIdIdx]
        : meetingDateIdx !== -1
          ? row[meetingDateIdx]
          : `row-${i}` // last-resort fallback so a row is never silently dropped

    entry.meetingIds.add(meetingKey)
    entry.totalMinutes += parseDurationToMinutes(durationIdx !== -1 ? row[durationIdx] : '')
  }

  if (byEmail.size === 0) {
    throw createError({ statusCode: 502, statusMessage: 'No student attendance rows were found in the sheet.' })
  }

  const attendanceRows = [...byEmail.entries()].map(([email, entry]) => ({
    email,
    first_name: entry.firstName || null,
    last_name: entry.lastName || null,
    meetings_attended: entry.meetingIds.size,
    total_duration_minutes: Math.round(entry.totalMinutes * 10) / 10,
    synced_at: new Date().toISOString(),
  }))

  const { error: upsertError } = await supabase
    .from('canvas_sheet_attendance')
    .upsert(attendanceRows, { onConflict: 'email' })

  if (upsertError) {
    throw createError({ statusCode: 500, statusMessage: upsertError.message })
  }

  await writeAuditLog(supabase, user.email, 'sync_canvas_attendance_sheet', 'canvas_sheet_attendance', null,
    { students_synced: attendanceRows.length }, event)

  // Record when this finished, so the page can show "Attendance last
  // synced: <date>" instead of needing a destructive "clear" action --
  // re-running this is always safe (upserts on email), there's just
  // nothing to clear.
  await supabase
    .from('canvas_masters_sync_status')
    .upsert(
      {
        sync_key: 'attendance',
        last_synced_at: new Date().toISOString(),
        summary: { students_synced: attendanceRows.length },
      },
      { onConflict: 'sync_key' }
    )

  return {
    data: {
      studentsSynced: attendanceRows.length,
    },
  }
})

/**
 * Converts a normal Google Sheets share/edit URL (with a #gid= or
 * ?gid= fragment identifying the tab) into its CSV export URL. Leaves
 * already-CSV URLs untouched.
 */
function toCsvExportUrl(url) {
  if (url.includes('/export?format=csv')) return url

  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (!idMatch) {
    const err = new Error('Could not parse a spreadsheet ID out of the given URL')
    err.statusCode = 400
    throw err
  }
  const sheetId = idMatch[1]

  const gidMatch = url.match(/[?#&]gid=(\d+)/)
  const gid = gidMatch ? gidMatch[1] : '0'

  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`
}

/**
 * Parses durations like "1 hr 31 mins", "43 secs", "3 mins" into total
 * minutes (fractional for seconds-only durations). Missing/unparsed
 * values return 0 rather than throwing, since a single malformed cell
 * shouldn't fail the whole import.
 */
function parseDurationToMinutes(duration) {
  if (!duration) return 0
  const hrMatch = duration.match(/(\d+)\s*hr/)
  const minMatch = duration.match(/(\d+)\s*min/)
  const secMatch = duration.match(/(\d+)\s*sec/)
  const hrs = hrMatch ? parseInt(hrMatch[1], 10) : 0
  const mins = minMatch ? parseInt(minMatch[1], 10) : 0
  const secs = secMatch ? parseInt(secMatch[1], 10) : 0
  return hrs * 60 + mins + secs / 60
}

/**
 * Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped
 * quotes (""), and commas/newlines inside quotes. Good enough for a
 * Google Sheets CSV export without pulling in a dependency.
 */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const next = text[i + 1]

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"'
        i++
      } else if (char === '"') {
        inQuotes = false
      } else {
        field += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && next === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}
