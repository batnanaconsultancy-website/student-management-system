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
  const domain = (config.canvasDomain || "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const token = config.canvasToken || "";
  return { domain, token };
}

function isConfigured(cfg) {
  return Boolean(cfg.domain && cfg.token);
}

function assertConfigured(cfg) {
  if (!isConfigured(cfg)) {
    const err = new Error(
      "Canvas sync isn't configured. Set CANVAS_DOMAIN and CANVAS_TOKEN in the server environment."
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
        `Canvas API error ${response.status} for ${url}: ${body.slice(0, 300)}`
      );
      err.statusCode = response.status === 404 ? 404 : 502;
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

/**
 * Courses the configured Canvas token has teacher/TA/designer access to.
 * Used to populate the course dropdown on the admin Canvas page.
 */
/**
 * Courses the configured Canvas token has teacher/TA/designer access to.
 * Used to populate the course dropdown on the admin Canvas page.
 *
 * Canvas's /courses endpoint only accepts a single `enrollment_type`
 * value per request (unlike `state[]`, which does accept an array) --
 * passing it as an array causes Canvas's own API to 500. So this calls
 * once per type and merges + dedupes the results by course id.
 */
/**
 * Courses the configured Canvas token has teacher/TA/designer access to,
 * PLUS any course IDs manually listed in CANVAS_EXTRA_COURSE_IDS (comma
 * separated env var). The extra list exists because an account-admin
 * Canvas token can often view/manage any course but isn't personally
 * "enrolled" in most of them, so Canvas's own enrollment-based course
 * list won't include those courses even though the token can access
 * them directly by ID. Used to populate the course dropdown.
 */
export async function listCanvasCourses() {
  const cfg = getConfig();
  assertConfigured(cfg);

  const enrollmentTypes = ["teacher", "ta", "designer"];
  const coursesById = new Map();

  for (const enrollmentType of enrollmentTypes) {
    const courses = await getAllPages(cfg, "/courses", {
      enrollment_type: enrollmentType,
      per_page: 100,
      "state[]": ["available", "completed"],
    });
    for (const c of courses) {
      if (c && !c.access_restricted_by_date) {
        coursesById.set(c.id, c);
      }
    }
  }

  // Manually-listed extra course IDs, fetched directly (works even
  // without a teacher/TA enrollment, as long as the token can view
  // the course at all -- e.g. an account-level admin token).
  const config = useRuntimeConfig();
  const extraIds = (config.canvasExtraCourseIds || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const id of extraIds) {
    if (coursesById.has(Number(id))) continue; // already have it
    try {
      const course = await getCanvasCourse(id);
      if (course && !course.errors) {
        coursesById.set(course.id, course);
      }
    } catch (err) {
      // Don't let one bad/inaccessible ID break the whole dropdown --
      // just skip it silently, it'll simply be missing from the list.
    }
  }

  return [...coursesById.values()]
    .map((c) => ({
      id: c.id,
      name: c.name,
      course_code: c.course_code,
      term: c.term?.name || null,
    }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export async function getCanvasCourse(courseId) {
  const cfg = getConfig();
  assertConfigured(cfg);
  const response = await fetch(`https://${cfg.domain}/api/v1/courses/${courseId}`, {
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (!response.ok) {
    const err = new Error(`Could not fetch course ${courseId} from Canvas`);
    err.statusCode = response.status === 404 ? 404 : 502;
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
  return getAllPages(cfg, `/courses/${courseId}/assignments`, { per_page: 100 });
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
    { "include[]": ["user"], per_page: 100 }
  );
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
        (u.login_id || "").toLowerCase() === lower
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
        `Canvas API error ${response.status} for ${url}: ${body.slice(0, 300)}`
      );
      err.statusCode = response.status === 404 ? 404 : 502;
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
        `Canvas API error ${response.status} for ${url}: ${body.slice(0, 300)}`
      );
      err.statusCode = response.status === 404 ? 404 : 502;
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
