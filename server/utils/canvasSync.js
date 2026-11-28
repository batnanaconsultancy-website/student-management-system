import { createError } from 'h3'
import { createHash } from 'node:crypto'
import {
  getCanvasCourse,
  listCanvasStudents,
  listCanvasAssignments,
  listAssignmentSubmissions,
  downloadCanvasAttachment,
  listOutcomeRollups,
  listOutcomeAlignments,
} from '~/server/utils/canvasApi'


const EVIDENCE_BUCKET = 'canvas-submission-evidence'
const MAX_EVIDENCE_FILE_BYTES = 50 * 1024 * 1024

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function safeFileName(value) {
  return String(value || 'attachment').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 160)
}

async function archiveSubmissionAttachments(supabase, courseId, assignmentId, studentId, attempt, attachments) {
  const archived = []
  for (const file of attachments || []) {
    const metadata = {
      id: file.id ?? null,
      filename: file.filename || file.display_name || 'attachment',
      display_name: file.display_name || file.filename || 'attachment',
      content_type: file['content-type'] || file.content_type || null,
      size: Number(file.size) || null,
      storage_path: null,
      download_status: 'metadata_only',
    }

    if (!file.url) {
      metadata.download_status = 'no_download_url'
      archived.push(metadata)
      continue
    }

    const { bytes, contentType, size } = await downloadCanvasAttachment(file.url)
    if (size > MAX_EVIDENCE_FILE_BYTES) {
      metadata.download_status = 'exceeds_50mb_limit'
      metadata.size = size
      archived.push(metadata)
      continue
    }

    const fileKey = file.id || createHash('sha256').update(`${metadata.filename}:${size}`).digest('hex').slice(0, 20)
    const storagePath = `${courseId}/${assignmentId}/${studentId}/${attempt}/${fileKey}-${safeFileName(metadata.filename)}`
    const { error } = await supabase.storage
      .from(EVIDENCE_BUCKET)
      .upload(storagePath, bytes, {
        contentType: contentType || metadata.content_type || 'application/octet-stream',
        upsert: true,
      })
    if (error) throw createError({ statusCode: 502, statusMessage: `Could not archive Canvas attachment ${metadata.filename}: ${error.message}` })

    metadata.content_type = contentType || metadata.content_type
    metadata.size = size
    metadata.storage_path = storagePath
    metadata.download_status = 'archived'
    archived.push(metadata)
  }
  return archived
}

// server/utils/canvasSync.js
//
// The actual "pull everything for one course from Canvas and upsert it"
// logic, extracted out of server/api/admin/canvas/sync.post.js so it can
// be called from two places without duplicating ~300 lines:
//   - the regular Canvas page's "Sync Now" button (one course at a time)
//   - Canvas Masters' account-wide sync (many courses in one click,
//     discovered via each roster student's Canvas enrollments)
//
// Order matters: students are upserted first so we have their internal
// UUIDs (canvas_students.id) on hand before writing submissions, since
// canvas_submissions.canvas_student_id is a foreign key to that table
// rather than storing name/email inline on every submission row.
//
// Every write here is an upsert keyed on Canvas's own IDs, so calling
// this repeatedly for the same course is always safe.
export async function syncCanvasCourse(supabase, canvasCourseId) {
  // 1. Confirm the course exists / token has access.
  const course = await getCanvasCourse(canvasCourseId)

  // Cache the course name/code so Canvas Masters can label this course
  // without a live Canvas call later.
  const { error: courseCacheError } = await supabase
    .from('canvas_courses')
    .upsert(
      {
        canvas_course_id: canvasCourseId,
        name: course.name || `Course ${canvasCourseId}`,
        course_code: course.course_code || null,
        account_id: course.account_id ?? null,
        workflow_state: course.workflow_state || null,
        enrollment_term_id: course.enrollment_term_id ?? null,
        start_at: course.start_at || null,
        end_at: course.end_at || null,
        course_metadata: course,
        synced_at: new Date().toISOString(),
      },
      { onConflict: 'canvas_course_id' }
    )
  if (courseCacheError) {
    throw createError({ statusCode: 500, statusMessage: courseCacheError.message })
  }

  // 2. Roster -> canvas_students + canvas_enrollments.
  const rosterUsers = await listCanvasStudents(canvasCourseId)
  const studentIdByCanvasUserId = new Map()

  if (rosterUsers.length > 0) {
    const studentRows = rosterUsers.map((u) => ({
      canvas_user_id: u.id,
      name: u.name || u.short_name || null,
      email: u.email || u.login_id || null,
      synced_at: new Date().toISOString(),
    }))

    const { data: upsertedStudents, error: studentsError } = await supabase
      .from('canvas_students')
      .upsert(studentRows, { onConflict: 'canvas_user_id' })
      .select('id, canvas_user_id')

    if (studentsError) {
      throw createError({ statusCode: 500, statusMessage: studentsError.message })
    }

    for (const row of upsertedStudents) {
      studentIdByCanvasUserId.set(row.canvas_user_id, row.id)
    }

    const enrollmentRows = upsertedStudents.map((row) => ({
      canvas_course_id: canvasCourseId,
      canvas_student_id: row.id,
      synced_at: new Date().toISOString(),
    }))

    const { error: enrollmentsError } = await supabase
      .from('canvas_enrollments')
      .upsert(enrollmentRows, { onConflict: 'canvas_course_id,canvas_student_id' })

    if (enrollmentsError) {
      throw createError({ statusCode: 500, statusMessage: enrollmentsError.message })
    }
  }

  // 3. Assignments.
  const assignments = await listCanvasAssignments(canvasCourseId)
  const assignmentRows = assignments.map((a) => ({
    canvas_course_id: canvasCourseId,
    canvas_assignment_id: a.id,
    name: a.name || `Assignment ${a.id}`,
    due_at: a.due_at || null,
    points_possible: a.points_possible ?? null,
    synced_at: new Date().toISOString(),
  }))

  if (assignmentRows.length > 0) {
    const { error: assignmentsError } = await supabase
      .from('canvas_assignments')
      .upsert(assignmentRows, { onConflict: 'canvas_course_id,canvas_assignment_id' })
    if (assignmentsError) {
      throw createError({ statusCode: 500, statusMessage: assignmentsError.message })
    }
  }

  // Preserve rubric definitions as versioned snapshots. A changed rubric
  // creates a new version; earlier AI suggestions remain tied to the
  // exact rubric they were generated against.
  const rubricVersionByAssignmentId = new Map()
  for (const assignment of assignments) {
    if (!Array.isArray(assignment.rubric) || assignment.rubric.length === 0) continue
    const rubricSettings = assignment.rubric_settings || {}
    const versionHash = createHash('sha256')
      .update(stableJson({ rubric: assignment.rubric, rubricSettings }))
      .digest('hex')
    const { data: rubricVersion, error: rubricError } = await supabase
      .from('canvas_assignment_rubric_versions')
      .upsert({
        canvas_course_id: canvasCourseId,
        canvas_assignment_id: assignment.id,
        version_hash: versionHash,
        rubric: assignment.rubric,
        rubric_settings: rubricSettings,
      }, { onConflict: 'canvas_course_id,canvas_assignment_id,version_hash' })
      .select('id')
      .single()
    if (rubricError) throw createError({ statusCode: 500, statusMessage: rubricError.message })
    rubricVersionByAssignmentId.set(assignment.id, rubricVersion.id)
  }

  // 4. Submissions, one Canvas request per assignment (Canvas has no
  // single "all submissions for a course" endpoint). Any submission from
  // a user not already in studentIdByCanvasUserId (e.g. the Canvas "Test
  // Student", or someone who's dropped the roster since) is upserted
  // into canvas_students on the fly so no submission is lost.
  let submissionCount = 0
  for (const assignment of assignments) {
    const submissions = await listAssignmentSubmissions(canvasCourseId, assignment.id)
    const usableSubmissions = submissions.filter((s) => s.user_id || s.user?.id)

    const missingUsers = usableSubmissions
      .map((s) => s.user)
      .filter((u) => u?.id && !studentIdByCanvasUserId.has(u.id))

    if (missingUsers.length > 0) {
      const dedupedRows = [...new Map(missingUsers.map((u) => [u.id, u])).values()].map((u) => ({
        canvas_user_id: u.id,
        name: u.name || u.short_name || null,
        email: u.email || u.login_id || null,
        synced_at: new Date().toISOString(),
      }))

      const { data: extraStudents, error: extraStudentsError } = await supabase
        .from('canvas_students')
        .upsert(dedupedRows, { onConflict: 'canvas_user_id' })
        .select('id, canvas_user_id')

      if (extraStudentsError) {
        throw createError({ statusCode: 500, statusMessage: extraStudentsError.message })
      }
      for (const row of extraStudents) {
        studentIdByCanvasUserId.set(row.canvas_user_id, row.id)
      }
    }

    const submissionRows = usableSubmissions
      .map((s) => {
        const canvasUserId = s.user?.id ?? s.user_id
        const canvasStudentId = studentIdByCanvasUserId.get(canvasUserId)
        if (!canvasStudentId) return null // shouldn't happen after the backfill above
        return {
          canvas_course_id: canvasCourseId,
          canvas_assignment_id: assignment.id,
          canvas_student_id: canvasStudentId,
          submission_type: s.submission_type || null,
          submitted_at: s.submitted_at || null,
          late: Boolean(s.late),
          seconds_late: s.seconds_late || 0,
          missing: Boolean(s.missing),
          workflow_state: s.workflow_state || null,
          attempt: s.attempt ?? null,
          score: s.score ?? null,
          grade: s.grade != null ? String(s.grade) : null,
          graded_at: s.graded_at || null,
          excused: Boolean(s.excused),
          preview_url: s.preview_url || null,
          synced_at: new Date().toISOString(),
        }
      })
      .filter(Boolean)

    if (submissionRows.length > 0) {
      const { error: submissionsError } = await supabase
        .from('canvas_submissions')
        .upsert(submissionRows, {
          onConflict: 'canvas_course_id,canvas_assignment_id,canvas_student_id',
        })
      if (submissionsError) {
        throw createError({ statusCode: 500, statusMessage: submissionsError.message })
      }
      submissionCount += submissionRows.length
    }

    // Capture every attempt returned by Canvas's submission_history. The
    // legacy canvas_submissions row above remains the current-state view.
    for (const submission of usableSubmissions) {
      const canvasUserId = submission.user?.id ?? submission.user_id
      const canvasStudentId = studentIdByCanvasUserId.get(canvasUserId)
      if (!canvasStudentId) continue

      const hasSubmissionHistory = Array.isArray(submission.submission_history) && submission.submission_history.length > 0
      const hasCurrentSubmission = Boolean(
        submission.submitted_at || submission.submission_type || submission.body || submission.url ||
        submission.attachments?.length || ['submitted', 'graded', 'pending_review'].includes(submission.workflow_state) || Number(submission.attempt) > 0 ||
        submission.score !== null && submission.score !== undefined || submission.graded_at
      )
      if (!hasSubmissionHistory && !hasCurrentSubmission) continue

      const history = Array.isArray(submission.submission_history) && submission.submission_history.length
        ? [...submission.submission_history]
        : [submission]
      const latestAttempt = Number(submission.attempt) || null
      if (latestAttempt && !history.some((item) => Number(item?.attempt) === latestAttempt)) {
        history.push(submission)
      }

      for (let index = 0; index < history.length; index += 1) {
        const item = history[index] || {}
        const attemptNumber = Number(item.attempt) || (history.length === 1 ? (latestAttempt || 1) : index + 1)
        if (!Number.isInteger(attemptNumber) || attemptNumber < 1) continue

        const isLatestAttempt = latestAttempt
          ? attemptNumber === latestAttempt
          : index === history.length - 1
        const isCurrentSnapshot = isLatestAttempt || history.length === 1
        const sourceAttachments = item.attachments?.length ? item.attachments : (isCurrentSnapshot ? submission.attachments || [] : [])
        const evidenceMetadata = {
          submission_type: item.submission_type || (isCurrentSnapshot ? submission.submission_type : null) || null,
          submitted_at: item.submitted_at || (isCurrentSnapshot ? submission.submitted_at : null) || null,
          body: item.body ?? (isCurrentSnapshot ? submission.body : null),
          url: item.url ?? (isCurrentSnapshot ? submission.url : null),
          attachments: sourceAttachments.map((file) => ({
            id: file.id ?? null,
            filename: file.filename || file.display_name || null,
            display_name: file.display_name || null,
            content_type: file['content-type'] || file.content_type || null,
            size: Number(file.size) || null,
          })),
          rubric_assessment: item.rubric_assessment || (isCurrentSnapshot ? submission.rubric_assessment : null) || null,
        }
        const contentHash = createHash('sha256').update(stableJson(evidenceMetadata)).digest('hex')
        if (isLatestAttempt) {
          const { error: clearLatestError } = await supabase
            .from('canvas_submission_attempts')
            .update({ is_latest: false })
            .eq('canvas_course_id', canvasCourseId)
            .eq('canvas_assignment_id', assignment.id)
            .eq('canvas_student_id', canvasStudentId)
            .neq('attempt', attemptNumber)
          if (clearLatestError) {
            throw createError({ statusCode: 500, statusMessage: clearLatestError.message })
          }
          const { error: markLatestError } = await supabase
            .from('canvas_submission_attempts')
            .update({ is_latest: true })
            .eq('canvas_course_id', canvasCourseId)
            .eq('canvas_assignment_id', assignment.id)
            .eq('canvas_student_id', canvasStudentId)
            .eq('attempt', attemptNumber)
          if (markLatestError) {
            throw createError({ statusCode: 500, statusMessage: markLatestError.message })
          }
        }

        const { data: existingAttempt, error: existingAttemptError } = await supabase
          .from('canvas_submission_attempts')
          .select('id, content_sha256')
          .eq('canvas_course_id', canvasCourseId)
          .eq('canvas_assignment_id', assignment.id)
          .eq('canvas_student_id', canvasStudentId)
          .eq('attempt', attemptNumber)
          .maybeSingle()
        if (existingAttemptError) {
          throw createError({ statusCode: 500, statusMessage: existingAttemptError.message })
        }
        if (existingAttempt?.content_sha256 === contentHash) continue

        const archivedAttachments = await archiveSubmissionAttachments(
          supabase, canvasCourseId, assignment.id, canvasStudentId, attemptNumber,
          sourceAttachments,
        )
        const rawPayload = item === submission
          ? Object.fromEntries(Object.entries(submission).filter(([key]) => key !== 'submission_history'))
          : item

        const { error: attemptError } = await supabase
          .from('canvas_submission_attempts')
          .upsert({
            canvas_course_id: canvasCourseId,
            canvas_assignment_id: assignment.id,
            canvas_student_id: canvasStudentId,
            attempt: attemptNumber,
            is_latest: isLatestAttempt,
            submission_type: evidenceMetadata.submission_type,
            submitted_at: evidenceMetadata.submitted_at,
            body: evidenceMetadata.body,
            url: evidenceMetadata.url,
            attachments: archivedAttachments,
            rubric_assessment: evidenceMetadata.rubric_assessment,
            raw_payload: rawPayload,
            content_sha256: contentHash,
            captured_at: new Date().toISOString(),
          }, { onConflict: 'canvas_course_id,canvas_assignment_id,canvas_student_id,attempt' })
        if (attemptError) {
          throw createError({ statusCode: 500, statusMessage: `Could not preserve Canvas attempt ${attemptNumber}: ${attemptError.message}` })
        }
      }
    }
  }

  // 5. Competencies (Canvas "outcomes") -- one Canvas request set for the
  // whole course via outcome_rollups, unlike submissions which need one
  // request per assignment.
  const { rollups, outcomes, paths } = await listOutcomeRollups(canvasCourseId)
  const pathByOutcomeId = new Map(paths.map((p) => [String(p.id), p]))

  const outcomeRows = outcomes.map((o) => {
    const path = pathByOutcomeId.get(String(o.id))
    const parts = path?.parts || []
    const groupName = parts.length > 1 ? parts[parts.length - 2]?.name : parts[0]?.name
    return {
      canvas_course_id: canvasCourseId,
      canvas_outcome_id: o.id,
      title: o.title || `Outcome ${o.id}`,
      group_name: groupName || 'Ungrouped',
      mastery_points: o.mastery_points ?? null,
      points_possible: o.points_possible ?? o.ratings?.[0]?.points ?? null,
      synced_at: new Date().toISOString(),
    }
  })

  if (outcomeRows.length > 0) {
    const { error: outcomesError } = await supabase
      .from('canvas_outcomes')
      .upsert(outcomeRows, { onConflict: 'canvas_course_id,canvas_outcome_id' })
    if (outcomesError) {
      throw createError({ statusCode: 500, statusMessage: outcomesError.message })
    }
  }

  const masteryPointsByOutcomeId = new Map(outcomeRows.map((o) => [o.canvas_outcome_id, o.mastery_points]))

  const outcomeResultRows = []
  for (const rollup of rollups) {
    const canvasUserId = rollup.links?.user
    const canvasStudentId = studentIdByCanvasUserId.get(Number(canvasUserId))
    if (!canvasStudentId) continue

    for (const s of rollup.scores || []) {
      const outcomeId = Number(s.links?.outcome)
      if (!outcomeId) continue
      const masteryPoints = masteryPointsByOutcomeId.get(outcomeId)
      const mastery = masteryPoints != null ? (s.score ?? 0) >= masteryPoints : Boolean(s.score)
      outcomeResultRows.push({
        canvas_course_id: canvasCourseId,
        canvas_outcome_id: outcomeId,
        canvas_student_id: canvasStudentId,
        score: s.score ?? null,
        mastery,
        synced_at: new Date().toISOString(),
      })
    }
  }

  let outcomeResultCount = 0
  if (outcomeResultRows.length > 0) {
    const { error: outcomeResultsError } = await supabase
      .from('canvas_outcome_results')
      .upsert(outcomeResultRows, {
        onConflict: 'canvas_course_id,canvas_outcome_id,canvas_student_id',
      })
    if (outcomeResultsError) {
      throw createError({ statusCode: 500, statusMessage: outcomeResultsError.message })
    }
    outcomeResultCount = outcomeResultRows.length
  }

  // 6. Outcome -> assignment alignment.
  const alignments = await listOutcomeAlignments(canvasCourseId)
  const alignmentRows = alignments.map((a) => ({
    canvas_course_id: canvasCourseId,
    canvas_outcome_id: a.outcomeId,
    canvas_assignment_id: a.assignmentId,
    synced_at: new Date().toISOString(),
  }))

  if (alignmentRows.length > 0) {
    const { error: alignmentsError } = await supabase
      .from('canvas_outcome_alignments')
      .upsert(alignmentRows, {
        onConflict: 'canvas_course_id,canvas_outcome_id,canvas_assignment_id',
      })
    if (alignmentsError) {
      throw createError({ statusCode: 500, statusMessage: alignmentsError.message })
    }
  }

  return {
    courseId: canvasCourseId,
    courseName: course.name,
    studentsSynced: rosterUsers.length,
    assignmentsSynced: assignmentRows.length,
    submissionsSynced: submissionCount,
    outcomesSynced: outcomeRows.length,
    outcomeResultsSynced: outcomeResultCount,
    outcomeAlignmentsSynced: alignmentRows.length,
  }
}
