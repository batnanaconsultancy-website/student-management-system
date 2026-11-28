// server/utils/canvasApi.js
//
// Thin wrapper around the Canvas (Instructure) REST API v1, used only by
// server/api/admin/canvas/*. Talks to Canvas using ONE shared instructor
// access token that this platform owns (not any individual admin's own
// Canvas login) -- same shared-credential pattern as googleCalendar.js.
//
// Setup required:
//   1. Generate a Canvas personal access token from an account that has
//      teacher/TA access to the courses you want to sync
//      (https://<your-domain>/profile/settings -> "New Access Token").
//   2. Set CANVAS_DOMAIN (bare domain, no "https://", e.g.
//      "amsterdamtech.instructure.com") and CANVAS_TOKEN in your
//      environment / .env.
//
// If those aren't set, every function here throws a clear, catchable
// error -- callers (the /api/admin/canvas/* routes) turn that into a
// normal 4xx response rather than a crash, so the rest of the app is
// unaffected if Canvas sync isn't configured yet.

function getConfig() {
  const config = useRuntimeConfig();
  const domain = (config.canvasDomain || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const token = config.canvasToken || "";
  return { domain, token };
}

function isConfigured(cfg) {
  return Boolean(cfg.domain && cfg.token);
}

function assertConfigured(cfg) {
  if (!isConfigured(cfg)) {
    const err = new Error(
      "Canvas sync isn't configured. Set CANVAS_DOMAIN and CANVAS_TOKEN in the server environment.",
    );
    err.statusCode = 501;
    throw err;
  }
}

/**
 * Follows Canvas's Link-header pagination and returns every result as a
 * flat array. `path` is relative to /api/v1 (e.g. "/courses/201/assignments").
 */
async function getAllPages(cfg, path, query = {}) {
  const baseUrl = `https://${cfg.domain}/api/v1`;
  let url = baseUrl + path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v);
    } else if (value !== undefined && value !== null) {
      params.append(key, value);
    }
  }
  if ([...params].length > 0) {
    url += `?${params.toString()}`;
  }

  const results = [];
  while (url) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${cfg.token}` },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const err = new Error(
        `Canvas API error ${response.status} for ${url}: ${body.slice(0, 300)}`,
      );
      // err.statusCode = response.status === 404 ? 404 : 502;
      err.statusCode = response.status;
      throw err;
    }

    const data = await response.json();
    if (Array.isArray(data)) {
      results.push(...data);
    } else {
      results.push(data);
    }

    // Parse the Link header for the next page URL
    const linkHeader = response.headers.get("Link") || "";
    let nextUrl = null;
    for (const part of linkHeader.split(",")) {
      if (part.includes('rel="next"')) {
        const match = part.match(/<([^>]+)>/);
        if (match) nextUrl = match[1];
      }
    }
    url = nextUrl;
  }

  return results;
}

/** Discover every Canvas course visible under the configured account.
 * Programme scope and assessment assignment selection are configured in SIS.
 */
export async function listCanvasCourses() {
  const cfg = getConfig();
  assertConfigured(cfg);
  const config = useRuntimeConfig();
  const accountId = config.canvasAccountId || "self";

  // Account-level discovery returns every course visible to this token,
  // including courses where the token has no personal teacher enrollment.
  // Assessment scope is configured separately in SIS; course metadata
  // must never implicitly classify a course as Bachelor or Masters.
  const courses = await getAllPages(cfg, `/accounts/${accountId}/courses`, {
    per_page: 100,
  });

  return courses
    .filter((course) => course && course.id)
    .map((course) => ({
      id: Number(course.id),
      name: course.name || `Course ${course.id}`,
      course_code: course.course_code || null,
      account_id: course.account_id ?? null,
      workflow_state: course.workflow_state || null,
      enrollment_term_id: course.enrollment_term_id ?? null,
      start_at: course.start_at || null,
      end_at: course.end_at || null,
      term: course.term?.name || null,
      metadata: course,
    }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export async function getCanvasCourse(courseId) {
  const cfg = getConfig();
  assertConfigured(cfg);
  const response = await fetch(
    `https://${cfg.domain}/api/v1/courses/${courseId}`,
    {
      headers: { Authorization: `Bearer ${cfg.token}` },
    },
  );
  if (!response.ok) {
    const err = new Error(`Could not fetch course ${courseId} from Canvas`);
    // err.statusCode = response.status === 404 ? 404 : 502;
    err.statusCode = response.status;
    throw err;
  }
  return response.json();
}

/**
 * Students enrolled in a course (the roster), independent of submissions.
 * Used to populate canvas_students / canvas_enrollments so the dashboard
 * can show every enrolled student, not just ones who've submitted something.
 */
export async function listCanvasStudents(courseId) {
  const cfg = getConfig();
  assertConfigured(cfg);
  return getAllPages(cfg, `/courses/${courseId}/users`, {
    "enrollment_type[]": ["student"],
    per_page: 100,
  });
}

export async function listCanvasAssignments(courseId) {
  const cfg = getConfig();
  assertConfigured(cfg);
  return getAllPages(cfg, `/courses/${courseId}/assignments`, {
    per_page: 100,
  });
}

/**
 * All submissions for one assignment, with user info embedded so we don't
 * need a separate per-student lookup.
 */
export async function listAssignmentSubmissions(courseId, assignmentId) {
  const cfg = getConfig();
  assertConfigured(cfg);
  return getAllPages(
    cfg,
    `/courses/${courseId}/assignments/${assignmentId}/submissions`,
    { "include[]": ["user", "submission_history"], per_page: 100 },
  );
}

/**
 * Downloads a Canvas file only when its URL belongs to the configured
 * Canvas host. This prevents a Canvas-provided attachment URL from being
 * used as an arbitrary server-side fetch target.
 */
export async function downloadCanvasAttachment(fileUrl) {
  const cfg = getConfig()
  assertConfigured(cfg)
  let parsed
  try {
    parsed = new URL(fileUrl)
  } catch {
    throw new Error('Canvas attachment URL is invalid')
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== cfg.domain) {
    throw new Error('Canvas attachment host does not match the configured Canvas domain')
  }

  const response = await fetch(parsed.toString(), {
    headers: { Authorization: `Bearer ${cfg.token}` },
    redirect: 'follow',
  })
  if (!response.ok) {
    const error = new Error(`Canvas attachment download failed (${response.status})`)
    error.statusCode = response.status
    throw error
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  return {
    bytes,
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    size: bytes.length,
  }
}

/**
 * Publishes an Examiner-approved score to Canvas. This is called only
 * from the explicit Examiner publish action, never by the AI worker.
 */
export async function publishCanvasGrade(courseId, assignmentId, canvasUserId, postedGrade, comment = null) {
  const cfg = getConfig()
  assertConfigured(cfg)
  const body = new URLSearchParams()
  body.set('submission[posted_grade]', String(postedGrade))
  if (comment) body.set('comment[text_comment]', String(comment))

  const response = await fetch(
    `https://${cfg.domain}/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${canvasUserId}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
  )

  if (!response.ok) {
    const message = await response.text().catch(() => '')
    const error = new Error(`Canvas grade publish failed (${response.status}): ${message.slice(0, 300)}`)
    error.statusCode = response.status
    throw error
  }
  return response.json()
}

export function isCanvasConfigured() {
  return isConfigured(getConfig());
}

/**
 * Finds a Canvas user account by email/login, searching the whole
 * Canvas account -- not just courses the token happens to already be
 * enrolled in. Requires the token to have account-admin rights on the
 * account given by CANVAS_ACCOUNT_ID (defaults to "self", which works
 * when the token's own account is the relevant root account).
 *
 * Used by Canvas Masters to resolve a roster student's Canvas user id
 * from their email alone, before we know which courses they're in.
 */
export async function findCanvasUserByEmail(email) {
  const cfg = getConfig();
  assertConfigured(cfg);
  const config = useRuntimeConfig();
  const accountId = config.canvasAccountId || "self";

  const users = await getAllPages(cfg, `/accounts/${accountId}/users`, {
    search_term: email,
    per_page: 10,
  });

  // search_term does a fuzzy match (name or email), so confirm we got
  // an exact login/email match rather than trusting the first result.
  const lower = email.toLowerCase();
  return (
    users.find(
      (u) =>
        (u.email || "").toLowerCase() === lower ||
        (u.login_id || "").toLowerCase() === lower,
    ) || null
  );
}

/**
 * Every course a given Canvas user is enrolled in as a student, across
 * the WHOLE account -- not scoped to any one course. This is what lets
 * Canvas Masters discover "all the courses this student is enrolled
 * in" directly from Canvas rather than only courses an admin happened
 * to sync individually first. Also requires account-admin rights.
 */
export async function listUserEnrollments(canvasUserId) {
  const cfg = getConfig();
  assertConfigured(cfg);
  return getAllPages(cfg, `/users/${canvasUserId}/enrollments`, {
    "type[]": ["StudentEnrollment"],
    per_page: 100,
  });
}

/**
 * Which assignments count toward which learning outcome, derived from
 * Canvas's /outcome_results endpoint (NOT /outcome_rollups -- rollups
 * only give a per-student aggregate score per outcome, with no record
 * of which specific assignment produced it; outcome_results gives the
 * individual assessment events, each with an "alignment" pointing at
 * the assessed item).
 *
 * Canvas's alignment object doesn't always expose a clean
 * `assignment_id` field directly, so this extracts it from the
 * alignment's `html_url` (which reliably follows the pattern
 * `/courses/:id/assignments/:id` when the outcome was assessed via an
 * assignment/rubric) rather than relying on a specific JSON field that
 * may not always be present. Alignments that aren't assignments at all
 * (e.g. quiz-only or manually-entered outcome results with no
 * assignment behind them) are simply skipped.
 *
 * Returns [{ outcomeId, assignmentId }], deduplicated.
 */
export async function listOutcomeAlignments(courseId) {
  const cfg = getConfig();
  assertConfigured(cfg);

  const baseUrl = `https://${cfg.domain}/api/v1`;
  const params = new URLSearchParams();
  params.append("include[]", "alignments");
  params.append("per_page", "100");
  let url = `${baseUrl}/courses/${courseId}/outcome_results?${params.toString()}`;

  const results = [];
  const alignmentsById = new Map();

  while (url) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${cfg.token}` },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const err = new Error(
        `Canvas API error ${response.status} for ${url}: ${body.slice(0, 300)}`,
      );
      // err.statusCode = response.status === 404 ? 404 : 502;
      err.statusCode = response.status;
      throw err;
    }

    const data = await response.json();
    results.push(...(data.outcome_results || []));
    for (const a of data.linked?.alignments || []) alignmentsById.set(a.id, a);

    const linkHeader = response.headers.get("Link") || "";
    let nextUrl = null;
    for (const part of linkHeader.split(",")) {
      if (part.includes('rel="next"')) {
        const match = part.match(/<([^>]+)>/);
        if (match) nextUrl = match[1];
      }
    }
    url = nextUrl;
  }

  const assignmentIdFromUrl = (htmlUrl) => {
    if (!htmlUrl) return null;
    const match = htmlUrl.match(/\/assignments\/(\d+)/);
    return match ? Number(match[1]) : null;
  };

  const pairs = new Map(); // dedupe key `${outcomeId}::${assignmentId}` -> pair

  for (const result of results) {
    const outcomeId = result.links?.learning_outcome;
    const alignmentId = result.links?.alignment;
    if (!outcomeId || !alignmentId) continue;

    const alignment = alignmentsById.get(alignmentId);
    const assignmentId = assignmentIdFromUrl(alignment?.html_url);
    if (!assignmentId) continue; // not an assignment-backed alignment (e.g. quiz or manual entry)

    const key = `${outcomeId}::${assignmentId}`;
    if (!pairs.has(key)) {
      pairs.set(key, { outcomeId: Number(outcomeId), assignmentId });
    }
  }

  return [...pairs.values()];
}

/**
 * Learning Mastery / Outcomes rollups for a course: per-student scores
 * against every competency (Canvas "outcome") in the course, plus the
 * outcome definitions themselves (title, mastery threshold) and their
 * position in Canvas's outcome-group hierarchy. Powers the Competency
 * Matrix tab.
 *
 * Canvas's /outcome_rollups endpoint returns a differently-shaped
 * response than the other list endpoints here ({ rollups, linked }
 * rather than a flat array), so it's paginated by hand rather than
 * reusing getAllPages -- each page's `linked.outcomes` /
 * `linked.outcome_paths` entries are merged and deduped by id as we go.
 */
export async function listOutcomeRollups(courseId) {
  const cfg = getConfig();
  assertConfigured(cfg);

  const baseUrl = `https://${cfg.domain}/api/v1`;
  const params = new URLSearchParams();
  params.append("include[]", "outcomes");
  params.append("include[]", "outcome_paths");
  params.append("per_page", "100");
  let url = `${baseUrl}/courses/${courseId}/outcome_rollups?${params.toString()}`;

  const rollups = [];
  const outcomesById = new Map();
  const pathsById = new Map();

  while (url) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${cfg.token}` },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const err = new Error(
        `Canvas API error ${response.status} for ${url}: ${body.slice(0, 300)}`,
      );
      // err.statusCode = response.status === 404 ? 404 : 502;
      err.statusCode = response.status;
      throw err;
    }

    const data = await response.json();
    rollups.push(...(data.rollups || []));
    for (const o of data.linked?.outcomes || []) outcomesById.set(o.id, o);
    for (const p of data.linked?.outcome_paths || []) pathsById.set(p.id, p);

    const linkHeader = response.headers.get("Link") || "";
    let nextUrl = null;
    for (const part of linkHeader.split(",")) {
      if (part.includes('rel="next"')) {
        const match = part.match(/<([^>]+)>/);
        if (match) nextUrl = match[1];
      }
    }
    url = nextUrl;
  }

  return {
    rollups,
    outcomes: [...outcomesById.values()],
    paths: [...pathsById.values()],
  };
}
