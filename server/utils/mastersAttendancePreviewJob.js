import { createError } from "h3";

const GMAIL_QUERY =
  'from:meetings-noreply@google.com subject:"Meeting records"';

const ATTENDEE_RANGE = "Attendees!A1:F";
const AMSTERDAM = "Europe/Amsterdam";

const ZONE_OFFSETS = {
  UTC: 0,
  GMT: 0,
  CET: 60,
  CEST: 120,
  EST: -300,
  EDT: -240,
  CST: -360,
  CDT: -300,
  MST: -420,
  MDT: -360,
  PST: -480,
  PDT: -420,
};

function safeError(statusCode, statusMessage) {
  throw createError({ statusCode, statusMessage });
}

async function refreshAccessToken(config, refreshToken) {
  if (
    !config.mastersAttendanceGoogleClientId ||
    !config.mastersAttendanceGoogleClientSecret ||
    !refreshToken
  ) {
    safeError(
      500,
      "Google attendance preview credentials are not configured on the server.",
    );
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.mastersAttendanceGoogleClientId,
      client_secret: config.mastersAttendanceGoogleClientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok || !result.access_token) {
    safeError(
      502,
      "Google authentication failed. Check the server refresh token and its authorized scopes.",
    );
  }

  return result.access_token;
}

async function googleGet(url, token) {
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let response;
    let result = {};
    let retryAfterMs = null;

    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const retryAfter = response.headers.get("retry-after");
      if (retryAfter) {
        const seconds = Number(retryAfter);
        const parsedMs = Number.isFinite(seconds)
          ? seconds * 1000
          : Date.parse(retryAfter) - Date.now();

        if (Number.isFinite(parsedMs) && parsedMs >= 0) {
          retryAfterMs = parsedMs;
        }
      }

      result = await response.json().catch(() => ({}));

      if (response.ok) {
        return result;
      }

      const error = new Error(
        result.error?.message ||
          `Google API request failed (${response.status})`,
      );
      error.status = response.status;
      error.googleReason = result.error?.errors?.[0]?.reason;
      error.retryable =
        [429, 500, 502, 503, 504].includes(response.status) ||
        ["ratelimitexceeded", "userratelimitexceeded"].includes(
          String(error.googleReason || "").toLowerCase(),
        );

      if (!error.retryable || attempt === maxAttempts - 1) {
        throw error;
      }
    } catch (error) {
      const retryable =
        error.retryable ||
        ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(error.cause?.code);

      if (!retryable || attempt === maxAttempts - 1) {
        throw error;
      }
    }

    const isRateLimit =
      response?.status === 429 ||
      ["ratelimitexceeded", "userratelimitexceeded"].includes(
        String(
          response?.status === 403 ? result.error?.errors?.[0]?.reason : "",
        ).toLowerCase(),
      );

    const delayMs = isRateLimit
      ? Math.min(retryAfterMs ?? 15_000 * 2 ** attempt, 120_000)
      : Math.min(2 ** (attempt + 1), 60) * 1000;

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error("Google API retries exhausted");
}

async function listAllMessages(token) {
  const messages = [];
  let pageToken = "";

  do {
    const url = new URL(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages",
    );

    url.searchParams.set("q", GMAIL_QUERY);
    url.searchParams.set("maxResults", "500");

    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const page = await googleGet(url, token);

    messages.push(...(page.messages || []));
    pageToken = page.nextPageToken || "";
  } while (pageToken);

  return messages;
}

function headerValue(headers, name) {
  return (
    (headers || []).find(
      (header) => header.name?.toLowerCase() === name.toLowerCase(),
    )?.value || ""
  );
}

function decodeBody(data) {
  if (!data) return "";

  try {
    return Buffer.from(
      data.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
  } catch {
    return "";
  }
}

function collectBodies(payload) {
  const plain = [];
  const html = [];

  function walk(part) {
    const body = decodeBody(part?.body?.data);

    if (part?.mimeType === "text/plain" && body) {
      plain.push(body);
    }

    if (part?.mimeType === "text/html" && body) {
      html.push(body);
    }

    for (const child of part?.parts || []) {
      walk(child);
    }
  }

  walk(payload || {});

  return {
    plain: plain.join("\n"),
    html: html.join("\n"),
  };
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#0*39;|&#x0*27;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

function spreadsheetIdFromUrl(value) {
  const text = decodeHtml(value || "");

  const match = text.match(
    /https?:\/\/(?:docs\.google\.com\/spreadsheets\/d\/|drive\.google\.com\/open\?id=)([A-Za-z0-9_-]+)/,
  );

  return match?.[1] || null;
}

function findAttendanceSheetId(html, plain) {
  const candidates = [];
  const attendanceCandidates = [];

  for (const match of (html || "").matchAll(
    /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const id = spreadsheetIdFromUrl(match[2]);

    if (!id) continue;

    candidates.push(id);

    const label = decodeHtml(match[3].replace(/<[^>]*>/g, " "));

    if (/\battendance\b/i.test(label)) {
      attendanceCandidates.push(id);
    }
  }

  if (attendanceCandidates.length) {
    return attendanceCandidates[0];
  }

  if (
    candidates.length &&
    /\battendance\b/i.test(html || "") &&
    new Set(candidates).size === 1
  ) {
    return candidates[0];
  }

  for (const match of (plain || "").matchAll(
    /https?:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+[^\s<>]*/gi,
  )) {
    const start = Math.max(0, match.index - 250);
    const context = plain.slice(start, match.index + match[0].length + 250);

    if (/\battendance\b/i.test(context)) {
      return spreadsheetIdFromUrl(match[0]);
    }
  }

  return null;
}

function amsterdamOffsetMinutes(instant) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: AMSTERDAM,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);

  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  const localAsUtc = Date.UTC(
    Number(value.year),
    Number(value.month) - 1,
    Number(value.day),
    Number(value.hour),
    Number(value.minute),
    Number(value.second),
  );

  return (localAsUtc - instant.getTime()) / 60000;
}

function localAmsterdamToUtc(year, month, day, hour, minute) {
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let instant = new Date(localAsUtc);

  for (let i = 0; i < 2; i++) {
    instant = new Date(localAsUtc - amsterdamOffsetMinutes(instant) * 60000);
  }

  return instant;
}

function parseDateText(text) {
  const normalized = text.replace(/\bSept\b/gi, "Sep").trim();

  const formats = [
    /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/,
    /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/,
  ];

  const months = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };

  let match = normalized.match(formats[0]);

  if (match) {
    return {
      day: Number(match[1]),
      month: months[match[2].toLowerCase()],
      year: Number(match[3]),
    };
  }

  match = normalized.match(formats[1]);

  if (match) {
    return {
      day: Number(match[2]),
      month: months[match[1].toLowerCase()],
      year: Number(match[3]),
    };
  }

  return null;
}

function parseMeetingDate(subject) {
  const match = subject.match(
    /Meeting records:\s*(.*?)\s+at\s+(\d{1,2}:\d{2}\s*[AP]M)\s*(.*?)\s*$/i,
  );

  if (!match) return null;

  const date = parseDateText(match[1]);

  if (!date?.month) return null;

  const time = match[2].match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);

  if (!time) return null;

  let hour = Number(time[1]) % 12;

  if (time[3].toUpperCase() === "PM") {
    hour += 12;
  }

  const minute = Number(time[2]);
  const zone = match[3].trim().toUpperCase();

  let instant;

  if (Object.hasOwn(ZONE_OFFSETS, zone)) {
    instant = new Date(
      Date.UTC(date.year, date.month - 1, date.day, hour, minute) -
        ZONE_OFFSETS[zone] * 60000,
    );
  } else {
    const offset = zone.match(/^(?:GMT|UTC)([+-])(\d{2}):?(\d{2})$/);

    if (offset) {
      let minutes = Number(offset[2]) * 60 + Number(offset[3]);

      if (offset[1] === "-") {
        minutes = -minutes;
      }

      instant = new Date(
        Date.UTC(date.year, date.month - 1, date.day, hour, minute) -
          minutes * 60000,
      );
    } else if (!zone) {
      instant = localAmsterdamToUtc(
        date.year,
        date.month,
        date.day,
        hour,
        minute,
      );
    } else {
      return null;
    }
  }

  return instant;
}

function formatAmsterdam(instant) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: AMSTERDAM,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(instant);
}

function parseCutoff(value) {
  const text = String(value || "2025-09-01T00:00:00").trim();

  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(text)) {
    const date = new Date(text);

    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  const match = text.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );

  if (!match) {
    safeError(500, "MEET_ATTENDANCE_START must be an ISO datetime.");
  }

  return localAmsterdamToUtc(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
}

function parseDurationMinutes(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!text) return null;

  const clock = text.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (clock) {
    if (clock[3] !== undefined) {
      return Number(clock[1]) * 60 + Number(clock[2]) + Number(clock[3]) / 60;
    }
    return Number(clock[1]) + Number(clock[2]) / 60;
  }

  let total = 0;
  let found = false;
  const units =
    /([\d.]+)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g;

  for (const match of text.matchAll(units)) {
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount < 0) continue;

    const unit = match[2];
    if (/^(hour|hours|hr|hrs|h)$/.test(unit)) total += amount * 60;
    else if (/^(second|seconds|sec|secs|s)$/.test(unit)) total += amount / 60;
    else total += amount;

    found = true;
  }

  if (!found && /^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return found ? Math.round(total * 100) / 100 : null;
}

async function readSheet(id, token) {
  const base = "https://sheets.googleapis.com/v4/spreadsheets/";

  const metadataUrl = new URL(`${base}${encodeURIComponent(id)}`);
  metadataUrl.searchParams.set("fields", "properties(title)");

  const valuesUrl = new URL(
    `${base}${encodeURIComponent(id)}/values/${encodeURIComponent(ATTENDEE_RANGE)}`,
  );
  valuesUrl.searchParams.set("majorDimension", "ROWS");

  const [metadata, values] = await Promise.all([
    googleGet(metadataUrl, token),
    googleGet(valuesUrl, token),
  ]);

  const rows = values.values || [];
  const headers = (rows[0] || []).map((value) =>
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );
  const expectedHeaders = [
    "first name",
    "last name",
    "email",
    "duration",
    "time joined",
    "time exited",
  ];

  if (!expectedHeaders.every((header, index) => headers[index] === header)) {
    return {
      title: metadata.properties?.title || "Untitled spreadsheet",
      attendeeRows: Math.max(0, rows.length - 1),
      emailRows: 0,
      attendees: [],
      invalidHeaders: true,
    };
  }

  const attendees = rows
    .slice(1)
    .filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""))
    .map((row, index) => {
      const padded = [...row.slice(0, 6)];
      while (padded.length < 6) padded.push("");

      const firstName = String(padded[0] ?? "").trim();
      const lastName = String(padded[1] ?? "").trim();
      const email = String(padded[2] ?? "")
        .trim()
        .toLowerCase();
      const durationMinutes = parseDurationMinutes(padded[3]);

      return {
        sourceRow: index + 2,
        firstName,
        lastName,
        studentName: [firstName, lastName].filter(Boolean).join(" "),
        studentEmail: email,
        durationMinutes,
        timeJoined: String(padded[4] ?? "").trim(),
        timeExited: String(padded[5] ?? "").trim(),
        valid: Boolean(
          email && email.includes("@") && durationMinutes !== null,
        ),
      };
    });

  return {
    title: metadata.properties?.title || "Untitled spreadsheet",
    attendeeRows: attendees.length,
    emailRows: attendees.filter((row) => row.studentEmail).length,
    attendees,
    invalidHeaders: false,
  };
}
async function mapLimit(items, limit, callback) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (true) {
      const index = next++;

      if (index >= items.length) return;

      try {
        results[index] = await callback(items[index], index);
      } catch (error) {
        results[index] = { error };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );

  return results;
}

export async function buildPreview(config) {
  const attendanceRefresh = config.mastersAttendanceRefreshToken;

  const [gmailToken, sheetsToken] = await Promise.all([
    refreshAccessToken(config, attendanceRefresh),
    refreshAccessToken(config, attendanceRefresh),
  ]);

  let matching;

  try {
    matching = await listAllMessages(gmailToken);
  } catch {
    safeError(
      502,
      "Could not list Google Meet report emails. Check Gmail API access.",
    );
  }

  const cutoff = parseCutoff(config.meetAttendanceStart);

  const emailResults = await mapLimit(matching, 2, async (stub) => {
    const url =
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/` +
      `${encodeURIComponent(stub.id)}?format=full`;

    let message;

    try {
      message = await googleGet(url, gmailToken);
    } catch (error) {
      console.error("[Masters Attendance Preview] Gmail message read failed:", {
        status: error.status || null,
        googleReason: error.googleReason || null,
        errorName: error.name || null,
        networkCode: error.cause?.code || null,
      });

      throw error;
    }

    const headers = message.payload?.headers || [];

    const subject = headerValue(headers, "Subject") || "(no subject)";
    const sender = headerValue(headers, "From").toLowerCase();

    if (!sender.includes("meetings-noreply@google.com")) {
      return { ignored: true };
    }

    const instant = parseMeetingDate(subject);

    if (!instant) {
      return {
        subject,
        meetingAt: null,
        status: "UNPARSEABLE_MEETING_TIME",
        detail: "Meeting date or time could not be parsed.",
      };
    }

    if (instant < cutoff) {
      return { skipped: true };
    }

    const bodies = collectBodies(message.payload);

    const spreadsheetId = findAttendanceSheetId(bodies.html, bodies.plain);

    if (!spreadsheetId) {
      return {
        subject,
        meetingAt: formatAmsterdam(instant),
        timestamp: instant.getTime(),
        status: "ATTENDANCE_LINK_NOT_FOUND",
        detail: "No unambiguous attendance spreadsheet link was found.",
      };
    }

    return {
      subject,
      meetingAt: formatAmsterdam(instant),
      timestamp: instant.getTime(),
      spreadsheetId,
      status: "PENDING",
    };
  });

  const reports = [];

  let unparseable = 0;
  let skipped = 0;
  let missingLink = 0;
  let gmailErrors = 0;

  for (const result of emailResults) {
    if (result?.ignored) continue;

    if (result?.skipped) {
      skipped++;
      continue;
    }

    if (result?.error) {
      gmailErrors++;

      reports.push({
        subject: "Unable to read report email",
        meetingAt: null,
        status: "GMAIL_READ_ERROR",
        detail: "The Gmail API request failed.",
      });

      continue;
    }

    if (result.status === "UNPARSEABLE_MEETING_TIME") {
      unparseable++;
    }

    if (result.status === "ATTENDANCE_LINK_NOT_FOUND") {
      missingLink++;
    }

    reports.push(result);
  }

  const uniqueIds = [
    ...new Set(reports.map((report) => report.spreadsheetId).filter(Boolean)),
  ];

  const sheetResults = await mapLimit(uniqueIds, 2, async (id) => ({
    id,
    result: await readSheet(id, sheetsToken),
  }));

  const sheetMap = new Map();

  let sheetErrors = 0;
  let attendeeRowsTotal = 0;
  let emailRowsTotal = 0;
  let successfulSheets = 0;

  for (let index = 0; index < sheetResults.length; index++) {
    const item = sheetResults[index];

    if (item?.error) {
      sheetErrors++;

      const error = item.error;
      console.error("[Masters Attendance Preview] Spreadsheet read failed:", {
        status: error.status || null,
        googleReason: error.googleReason || null,
        errorName: error.name || null,
        networkCode: error.cause?.code || null,
      });

      sheetMap.set(uniqueIds[index], {
        error: true,
      });

      continue;
    }

    const { id, result } = item;

    sheetMap.set(id, result);

    successfulSheets++;
    if (result.invalidHeaders) {
      sheetErrors++;
      continue;
    }
    attendeeRowsTotal += result.attendeeRows;
    emailRowsTotal += result.emailRows;
  }

  for (const report of reports) {
    if (!report.spreadsheetId) continue;

    const sheet = sheetMap.get(report.spreadsheetId);

    if (!sheet || sheet.error) {
      report.status = "SHEETS_READ_ERROR";
      report.detail = "The linked spreadsheet could not be read.";
      continue;
    }

    if (sheet.invalidHeaders) {
      report.status = "UNEXPECTED_HEADERS";
      report.detail =
        "The linked spreadsheet does not have the expected six attendee columns.";
      continue;
    }

    report.spreadsheetTitle = sheet.title;
    report.attendeeRows = sheet.attendeeRows;
    report.emailRows = sheet.emailRows;
    report.attendees = sheet.attendees.map((attendee) => ({
      ...attendee,
      meetingAt: report.meetingAt,
      meetingId: report.spreadsheetId,
      sourceReport: report.subject,
    }));
    report.status = "OK";
    report.detail = "";
  }

  reports.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  return {
    readOnly: true,
    cutoff: cutoff.toISOString(),
    summary: {
      gmailMessagesFound: matching.length,
      eligibleReportEmails: reports.length,
      skippedBeforeCutoff: skipped,
      unparseableMeetingTimes: unparseable,
      attendanceLinksNotFound: missingLink,
      uniqueSpreadsheetIdsFound: uniqueIds.length,
      successfullyReadSpreadsheets: successfulSheets,
      nonEmptyAttendeeRows: attendeeRowsTotal,
      rowsContainingEmail: emailRowsTotal,
      errors: gmailErrors + sheetErrors,
    },
    reports,
  };
}


// Process-local background job state. This job only reads Google data.
let jobStatus = "idle";
let jobStartedAt = null;
let jobFinishedAt = null;
let jobErrorMessage = null;
let latestPreview = null;
let latestPreviewAt = null;
let previewInFlight = null;

export function getMastersAttendancePreviewJob() {
  return {
    status: jobStatus,
    startedAt: jobStartedAt,
    finishedAt: jobFinishedAt,
    errorMessage: jobErrorMessage,
    cachedAt: latestPreviewAt,
    preview: latestPreview,
  };
}

export function startMastersAttendancePreviewJob() {
  // Never launch a duplicate scan while one is already running.
  if (previewInFlight) {
    return getMastersAttendancePreviewJob();
  }

  jobStatus = "running";
  jobStartedAt = new Date().toISOString();
  jobFinishedAt = null;
  jobErrorMessage = null;

  // Deliberately do not await this promise in the HTTP request.
  previewInFlight = Promise.resolve()
    .then(() => buildPreview(useRuntimeConfig()))
    .then((result) => {
      latestPreview = result;
      latestPreviewAt = new Date().toISOString();
      jobStatus =
        result.summary.errors > 0 ? "completed_with_errors" : "completed";
    })
    .catch((error) => {
      jobStatus = "failed";
      jobErrorMessage =
        error?.statusMessage ||
        "The Google Meet preview scan failed. Check the server logs.";

      console.error("[Masters Attendance Preview] Background scan failed:", {
        status: error?.statusCode || null,
        message: jobErrorMessage,
        errorName: error?.name || null,
      });
    })
    .finally(() => {
      jobFinishedAt = new Date().toISOString();
      previewInFlight = null;
    });

  return getMastersAttendancePreviewJob();
}
