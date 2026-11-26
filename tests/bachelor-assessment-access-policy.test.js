import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveBachelorAssessmentFacultyAccess,
} from "../server/utils/bachelorAssessmentAccessPolicy.js";

test("active Assessment Manager retains access with non-teaching staff_type", () => {
  assert.equal(
    resolveBachelorAssessmentFacultyAccess(
      { is_active: true, staff_type: "administrative" },
      { id: "appointment-1" },
    ),
    "assessment_manager",
  );
});

test("active teaching Assessment Manager receives manager access", () => {
  assert.equal(
    resolveBachelorAssessmentFacultyAccess(
      { is_active: true, staff_type: "teaching" },
      { id: "appointment-2" },
    ),
    "assessment_manager",
  );
});

test("inactive faculty is denied despite an active manager appointment", () => {
  assert.equal(
    resolveBachelorAssessmentFacultyAccess(
      { is_active: false, staff_type: "teaching" },
      { id: "appointment-3" },
    ),
    "denied",
  );
});

test("active faculty with a revoked appointment is not an Assessment Manager", () => {
  assert.equal(
    resolveBachelorAssessmentFacultyAccess(
      { is_active: true, staff_type: "teaching" },
      null,
    ),
    "teaching_faculty",
  );
});

test("active teaching faculty without a manager appointment remains eligible for assigned-student access", () => {
  assert.equal(
    resolveBachelorAssessmentFacultyAccess(
      { is_active: true, staff_type: "teaching" },
      null,
    ),
    "teaching_faculty",
  );
});

test("non-teaching faculty without a manager appointment is denied", () => {
  assert.equal(
    resolveBachelorAssessmentFacultyAccess(
      { is_active: true, staff_type: "administrative" },
      null,
    ),
    "denied",
  );
});

test("missing faculty record is denied", () => {
  assert.equal(
    resolveBachelorAssessmentFacultyAccess(null, null),
    "denied",
  );
});

test("inactive appointment does not grant manager access", () => {
  assert.equal(
    resolveBachelorAssessmentFacultyAccess(
      { is_active: true, staff_type: "administrative" },
      null,
    ),
    "denied",
  );
});
