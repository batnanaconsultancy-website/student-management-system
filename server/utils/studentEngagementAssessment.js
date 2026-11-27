export const ENGAGEMENT_HIGH_THRESHOLD = 75

const SCHEDULED_TYPES = [
  "workshops",
  "mentoring",
  "standups",
  "squad_meetings",
]

function validNonNegativeNumber(value) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return false
  }

  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0
}

function unavailable(reason, reportingDate = null) {
  return {
    available: false,
    reason,
    reporting_date: reportingDate,
    threshold_percent: ENGAGEMENT_HIGH_THRESHOLD,
    scheduled_attendance: null,
    cohort_relative: null,
    classification: {
      key: "insufficient_data",
      label: "Insufficient data",
      description: reason,
    },
  }
}

export function calculateStudentEngagement({
  usesLedger,
  calendarCoverageStatus,
  reportingDate,
  cohortRelative,
  scheduled,
}) {
  if (!usesLedger) {
    return unavailable(
      "Date-stamped Bachelor attendance records are not available for this programme.",
      reportingDate,
    )
  }

  if (calendarCoverageStatus !== "matched") {
    return unavailable(
      "A matched programme calendar is required for a comparable scheduled-attendance rate.",
      reportingDate,
    )
  }

  if (
    !reportingDate ||
    !cohortRelative?.reporting_date ||
    reportingDate !== cohortRelative.reporting_date
  ) {
    return unavailable(
      "The scheduled and cohort-relative measures do not share the same reporting date.",
      reportingDate,
    )
  }

  if (
    !validNonNegativeNumber(cohortRelative.cohort_size) ||
    Number(cohortRelative.cohort_size) < 2
  ) {
    return unavailable(
      "At least two students in the same cohort are required for a cohort-relative comparison.",
      reportingDate,
    )
  }

  if (
    !validNonNegativeNumber(cohortRelative.student_eligible_sessions) ||
    !validNonNegativeNumber(cohortRelative.cohort_max_eligible_sessions) ||
    Number(cohortRelative.cohort_max_eligible_sessions) <= 0 ||
    Number(cohortRelative.student_eligible_sessions) >
      Number(cohortRelative.cohort_max_eligible_sessions)
  ) {
    return unavailable(
      "There is not yet enough eligible cohort attendance to calculate a relative comparison.",
      reportingDate,
    )
  }

  if (!scheduled || typeof scheduled !== "object") {
    return unavailable(
      "Scheduled attendance data is unavailable.",
      reportingDate,
    )
  }

  let attended = 0
  let total = 0

  for (const type of SCHEDULED_TYPES) {
    const metric = scheduled[type]

    if (
      !metric ||
      !validNonNegativeNumber(metric.attended) ||
      !validNonNegativeNumber(metric.total) ||
      Number(metric.attended) > Number(metric.total)
    ) {
      return unavailable(
        "One or more scheduled-attendance categories have incomplete or invalid data.",
        reportingDate,
      )
    }

    attended += Number(metric.attended)
    total += Number(metric.total)
  }

  if (total <= 0) {
    return unavailable(
      "No scheduled session opportunities have elapsed in this reporting period.",
      reportingDate,
    )
  }

  const studentSessions = Number(cohortRelative.student_eligible_sessions)
  const cohortMaximum = Number(cohortRelative.cohort_max_eligible_sessions)

  // Apply the threshold to unrounded ratios. Rounding is for display only.
  const scheduledPercent = Math.round((100 * attended) / total)
  const cohortPercent = Math.round((100 * studentSessions) / cohortMaximum)

  const scheduledLevel =
    attended / total >= ENGAGEMENT_HIGH_THRESHOLD / 100 ? "high" : "low"
  const cohortLevel =
    studentSessions / cohortMaximum >= ENGAGEMENT_HIGH_THRESHOLD / 100
      ? "high"
      : "low"

  let classification

  if (scheduledLevel === "high" && cohortLevel === "high") {
    classification = {
      key: "consistent_engagement",
      label: "Consistent engagement",
      description:
        "Scheduled-session attendance and cohort-relative participation are both high.",
    }
  } else if (scheduledLevel === "low" && cohortLevel === "low") {
    classification = {
      key: "priority_for_intervention",
      label: "Priority for intervention",
      description:
        "Both scheduled-session attendance and cohort-relative participation are below the high-engagement threshold. Review the context and consider appropriate support.",
    }
  } else {
    classification = {
      key: "investigate_difference",
      label: "Investigate difference",
      description:
        "The two engagement measures differ. Review the attendance pattern and context; this mixed result is not an automatic at-risk classification.",
    }
  }

  return {
    available: true,
    reporting_date: reportingDate,
    threshold_percent: ENGAGEMENT_HIGH_THRESHOLD,
    scheduled_attendance: {
      attended,
      total,
      percent: scheduledPercent,
      level: scheduledLevel,
    },
    cohort_relative: {
      attended: Number(cohortRelative.student_eligible_sessions),
      max: Number(cohortRelative.cohort_max_eligible_sessions),
      cohort_size: Number(cohortRelative.cohort_size),
      percent: cohortPercent,
      level: cohortLevel,
    },
    classification,
  }
}
