import test from "node:test";
import assert from "node:assert/strict";

import {
  POINTS_TARGET,
  calculateStudentPoints,
  getCurrentPeriodStart,
  getPeriodBounds,
} from "../server/utils/bachelorAssessmentPoints.js";

test("April–September period has correct boundaries", () => {
  assert.deepEqual(getPeriodBounds("2026-04-01"), {
    startDate: "2026-04-01",
    endDate: "2026-09-30",
    endExclusive: "2026-10-01",
    label: "1 April – 30 September 2026",
  });
});

test("October–March period crosses the year boundary", () => {
  assert.deepEqual(getPeriodBounds("2026-10-01"), {
    startDate: "2026-10-01",
    endDate: "2027-03-31",
    endExclusive: "2027-04-01",
    label: "1 October 2026 – 31 March 2027",
  });
});

test("invalid reporting period starts are rejected", () => {
  for (const value of [
    "", "2026-04-02", "2026-10-02", "2026-01-01",
    "2026-13-01", "not-a-date", null, 20260401,
  ]) {
    assert.throws(() => getPeriodBounds(value), {
      statusCode: 400,
    });
  }
});

test("current period uses the Amsterdam calendar date", () => {
  assert.equal(
    getCurrentPeriodStart(new Date("2026-03-31T22:30:00.000Z")),
    "2026-04-01",
  );
  assert.equal(
    getCurrentPeriodStart(new Date("2026-09-30T22:30:00.000Z")),
    "2026-10-01",
  );
  assert.equal(
    getCurrentPeriodStart(new Date("2026-03-31T20:00:00.000Z")),
    "2025-10-01",
  );
  assert.equal(
    getCurrentPeriodStart(new Date("2026-09-30T20:00:00.000Z")),
    "2026-04-01",
  );
});

test("verified forum points and attendance combine correctly", () => {
  const result = calculateStudentPoints(100, {
    points: 7,
    presenterCount: 1,
    participantCount: 1,
  });

  assert.equal(result.attendance_points, 100);
  assert.equal(result.verified_forum_points, 7);
  assert.equal(result.total_points, 107);
  assert.equal(result.forum_presenter_count, 1);
  assert.equal(result.forum_participant_count, 1);
  assert.equal(result.shortfall_points, 33);
  assert.equal(result.surplus_points, 0);
  assert.equal(result.target_met, false);
});

test("exactly 140 points meets the target", () => {
  const result = calculateStudentPoints(133, {
    points: 7,
    presenterCount: 1,
    participantCount: 1,
  });

  assert.equal(POINTS_TARGET, 140);
  assert.equal(result.total_points, 140);
  assert.equal(result.target_met, true);
  assert.equal(result.shortfall_points, 0);
  assert.equal(result.surplus_points, 0);
});

test("points above target produce surplus only", () => {
  const result = calculateStudentPoints(145);

  assert.equal(result.total_points, 145);
  assert.equal(result.target_met, true);
  assert.equal(result.shortfall_points, 0);
  assert.equal(result.surplus_points, 5);
});

test("zero points produce a 140-point shortfall", () => {
  const result = calculateStudentPoints(0);

  assert.equal(result.total_points, 0);
  assert.equal(result.target_met, false);
  assert.equal(result.shortfall_points, 140);
  assert.equal(result.surplus_points, 0);
});
