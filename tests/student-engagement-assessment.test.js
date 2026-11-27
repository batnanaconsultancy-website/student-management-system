import test from "node:test"
import assert from "node:assert/strict"

import {
  ENGAGEMENT_HIGH_THRESHOLD,
  calculateStudentEngagement,
} from "../server/utils/studentEngagementAssessment.js"

const reportingDate = "2026-11-27"

function validInput(overrides = {}) {
  return {
    usesLedger: true,
    calendarCoverageStatus: "matched",
    reportingDate,
    scheduled: {
      workshops: { attended: 15, total: 20 },
      mentoring: { attended: 15, total: 20 },
      standups: { attended: 30, total: 40 },
      squad_meetings: { attended: 15, total: 20 },
    },
    cohortRelative: {
      reporting_date: reportingDate,
      cohort_size: 10,
      student_eligible_sessions: 80,
      cohort_max_eligible_sessions: 100,
    },
    ...overrides,
  }
}

test("75 percent is the high-engagement threshold", () => {
  assert.equal(ENGAGEMENT_HIGH_THRESHOLD, 75)

  const result = calculateStudentEngagement(
    validInput({
      scheduled: {
        workshops: { attended: 15, total: 20 },
        mentoring: { attended: 15, total: 20 },
        standups: { attended: 30, total: 40 },
        squad_meetings: { attended: 15, total: 20 },
      },
      cohortRelative: {
        reporting_date: reportingDate,
        cohort_size: 10,
        student_eligible_sessions: 75,
        cohort_max_eligible_sessions: 100,
      },
    }),
  )

  assert.equal(result.scheduled_attendance.percent, 75)
  assert.equal(result.cohort_relative.percent, 75)
  assert.equal(result.classification.key, "consistent_engagement")
})

test("both low measures produce priority for intervention", () => {
  const result = calculateStudentEngagement(
    validInput({
      scheduled: {
        workshops: { attended: 5, total: 20 },
        mentoring: { attended: 5, total: 20 },
        standups: { attended: 10, total: 40 },
        squad_meetings: { attended: 5, total: 20 },
      },
      cohortRelative: {
        reporting_date: reportingDate,
        cohort_size: 10,
        student_eligible_sessions: 40,
        cohort_max_eligible_sessions: 100,
      },
    }),
  )

  assert.equal(result.scheduled_attendance.percent, 25)
  assert.equal(result.cohort_relative.percent, 40)
  assert.equal(result.classification.key, "priority_for_intervention")
})

test("mixed measures prompt investigation, not at-risk classification", () => {
  const result = calculateStudentEngagement(
    validInput({
      cohortRelative: {
        reporting_date: reportingDate,
        cohort_size: 10,
        student_eligible_sessions: 60,
        cohort_max_eligible_sessions: 100,
      },
    }),
  )

  assert.equal(result.scheduled_attendance.percent, 75)
  assert.equal(result.cohort_relative.percent, 60)
  assert.equal(result.classification.key, "investigate_difference")
  assert.match(result.classification.description, /not an automatic at-risk classification/)
})

test("scheduled attendance uses a weighted total, not an average of percentages", () => {
  const result = calculateStudentEngagement(
    validInput({
      scheduled: {
        workshops: { attended: 1, total: 1 },
        mentoring: { attended: 0, total: 9 },
        standups: { attended: 0, total: 0 },
        squad_meetings: { attended: 0, total: 0 },
      },
    }),
  )

  assert.equal(result.scheduled_attendance.attended, 1)
  assert.equal(result.scheduled_attendance.total, 10)
  assert.equal(result.scheduled_attendance.percent, 10)
})

test("non-Bachelor programmes do not receive a classification", () => {
  const result = calculateStudentEngagement(
    validInput({ usesLedger: false }),
  )

  assert.equal(result.available, false)
  assert.equal(result.classification.key, "insufficient_data")
})

test("unmatched calendar coverage does not become low engagement", () => {
  const result = calculateStudentEngagement(
    validInput({ calendarCoverageStatus: "unmatched" }),
  )

  assert.equal(result.available, false)
  assert.equal(result.classification.key, "insufficient_data")
})

test("different reporting dates do not produce a classification", () => {
  const result = calculateStudentEngagement(
    validInput({
      cohortRelative: {
        reporting_date: "2026-11-26",
        cohort_size: 10,
        student_eligible_sessions: 80,
        cohort_max_eligible_sessions: 100,
      },
    }),
  )

  assert.equal(result.available, false)
  assert.match(result.classification.description, /same reporting date/)
})

test("a cohort with fewer than two students is insufficient", () => {
  const result = calculateStudentEngagement(
    validInput({
      cohortRelative: {
        reporting_date: reportingDate,
        cohort_size: 1,
        student_eligible_sessions: 80,
        cohort_max_eligible_sessions: 100,
      },
    }),
  )

  assert.equal(result.available, false)
  assert.match(result.classification.description, /At least two students/)
})

test("zero scheduled opportunities are insufficient", () => {
  const result = calculateStudentEngagement(
    validInput({
      scheduled: {
        workshops: { attended: 0, total: 0 },
        mentoring: { attended: 0, total: 0 },
        standups: { attended: 0, total: 0 },
        squad_meetings: { attended: 0, total: 0 },
      },
    }),
  )

  assert.equal(result.available, false)
  assert.match(result.classification.description, /No scheduled session opportunities/)
})

test("zero cohort maximum is insufficient rather than zero percent", () => {
  const result = calculateStudentEngagement(
    validInput({
      cohortRelative: {
        reporting_date: reportingDate,
        cohort_size: 10,
        student_eligible_sessions: 0,
        cohort_max_eligible_sessions: 0,
      },
    }),
  )

  assert.equal(result.available, false)
})

test("invalid scheduled counts are rejected", () => {
  const result = calculateStudentEngagement(
    validInput({
      scheduled: {
        workshops: { attended: 21, total: 20 },
        mentoring: { attended: 15, total: 20 },
        standups: { attended: 30, total: 40 },
        squad_meetings: { attended: 15, total: 20 },
      },
    }),
  )

  assert.equal(result.available, false)
})

test("student eligible sessions cannot exceed the cohort maximum", () => {
  const result = calculateStudentEngagement(
    validInput({
      cohortRelative: {
        reporting_date: reportingDate,
        cohort_size: 10,
        student_eligible_sessions: 101,
        cohort_max_eligible_sessions: 100,
      },
    }),
  )

  assert.equal(result.available, false)
  assert.equal(result.classification.key, "insufficient_data")
})

test("a rounded 75 percent does not pass the threshold when the actual rate is lower", () => {
  const result = calculateStudentEngagement(
    validInput({
      scheduled: {
        workshops: { attended: 70, total: 100 },
        mentoring: { attended: 75, total: 100 },
        standups: { attended: 150, total: 200 },
        squad_meetings: { attended: 78, total: 100 },
      },
      cohortRelative: {
        reporting_date: reportingDate,
        cohort_size: 10,
        student_eligible_sessions: 746,
        cohort_max_eligible_sessions: 1000,
      },
    }),
  )

  assert.equal(result.scheduled_attendance.percent, 75)
  assert.equal(result.cohort_relative.percent, 75)
  assert.equal(result.scheduled_attendance.level, "low")
  assert.equal(result.cohort_relative.level, "low")
  assert.equal(result.classification.key, "priority_for_intervention")
})

test("empty strings and fractional values are rejected as session counts", () => {
  for (const invalidCount of ["", 1.5]) {
    const result = calculateStudentEngagement(
      validInput({
        cohortRelative: {
          reporting_date: reportingDate,
          cohort_size: 10,
          student_eligible_sessions: invalidCount,
          cohort_max_eligible_sessions: 100,
        },
      }),
    )

    assert.equal(result.available, false)
    assert.equal(result.classification.key, "insufficient_data")
  }
})
