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
