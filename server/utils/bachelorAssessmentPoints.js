import { createError } from "h3";

export const POINTS_TARGET = 140;

export function getCurrentPeriodStart(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  const year = Number(values.year);
  const month = Number(values.month);

  if (month >= 4 && month <= 9) return `${year}-04-01`;
  if (month >= 10) return `${year}-10-01`;

  return `${year - 1}-10-01`;
}

export function getPeriodBounds(periodStart) {
  if (
    typeof periodStart !== "string" ||
    !/^\d{4}-(04|10)-01$/.test(periodStart)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "periodStart must be 1 April or 1 October in YYYY-MM-DD format.",
    });
  }

  const [year, month] = periodStart.split("-").map(Number);
  const startDate = new Date(Date.UTC(year, month - 1, 1));

  if (
    Number.isNaN(startDate.getTime()) ||
    startDate.toISOString().slice(0, 10) !== periodStart
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid reporting period start date.",
    });
  }

  const endExclusive =
    month === 4 ? `${year}-10-01` : `${year + 1}-04-01`;

  const endDate = new Date(
    Date.UTC(
      Number(endExclusive.slice(0, 4)),
      Number(endExclusive.slice(5, 7)) - 1,
      1,
    ),
  );
  endDate.setUTCDate(endDate.getUTCDate() - 1);

  return {
    startDate: periodStart,
    endDate: endDate.toISOString().slice(0, 10),
    endExclusive,
    label:
      month === 4
        ? `1 April – 30 September ${year}`
        : `1 October ${year} – 31 March ${year + 1}`,
  };
}

export function calculateStudentPoints(attendancePoints, forum = {}) {
  const attendance = Number(attendancePoints || 0);
  const verifiedForumPoints = Number(forum.points || 0);
  const presenterCount = Number(forum.presenterCount || 0);
  const participantCount = Number(forum.participantCount || 0);
  const totalPoints = attendance + verifiedForumPoints;

  return {
    attendance_points: attendance,
    verified_forum_points: verifiedForumPoints,
    forum_presenter_count: presenterCount,
    forum_participant_count: participantCount,
    total_points: totalPoints,
    target_points: POINTS_TARGET,
    shortfall_points: Math.max(0, POINTS_TARGET - totalPoints),
    surplus_points: Math.max(0, totalPoints - POINTS_TARGET),
    target_met: totalPoints >= POINTS_TARGET,
  };
}
