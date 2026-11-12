import unittest
from datetime import date

from scripts.import_bachelor_attendance import (
    classify_source_row,
    match_schedule,
    normalize_email,
    normalize_live_status,
    normalize_session_type,
    parse_session_date,
    parse_submission_timestamp,
)


class DateParsingTests(unittest.TestCase):
    def test_audit_date_formats_are_supported(self):
        self.assertEqual(parse_session_date("06/01/2026"), date(2026, 1, 6))
        self.assertEqual(parse_session_date("2026-01-06"), date(2026, 1, 6))
        self.assertEqual(parse_session_date("06-01-2026"), date(2026, 1, 6))

    def test_ambiguous_or_unsupported_dates_are_not_guessed(self):
        self.assertIsNone(parse_session_date(""))
        self.assertIsNone(parse_session_date("01/06/26"))
        self.assertIsNone(parse_session_date("2026/01/06"))
        self.assertIsNone(parse_session_date("31/02/2026"))

    def test_timestamp_formats_mirror_audit(self):
        self.assertIsNotNone(parse_submission_timestamp("06/01/2026 09:15:00"))
        self.assertIsNotNone(parse_submission_timestamp("06/01/2026 09:15"))
        self.assertIsNotNone(parse_submission_timestamp("2026-01-06 09:15:00"))
        self.assertIsNotNone(parse_submission_timestamp("2026-01-06T09:15:00"))
        self.assertIsNotNone(parse_submission_timestamp("2026-01-06T09:15:00.123"))
        parsed_iso_z = parse_submission_timestamp("2026-01-06T09:15:00Z")
        self.assertIsNotNone(parsed_iso_z)
        self.assertIsNone(parsed_iso_z.tzinfo)
        self.assertIsNone(parse_submission_timestamp("not a timestamp"))


class NormalizationTests(unittest.TestCase):
    def test_approved_email_corrections_are_exact(self):
        self.assertEqual(
            normalize_email(" Nikolay.Kirilov@Amsterdam.tech "),
            "nikolay.kirilov@elu.nl",
        )
        self.assertEqual(
            normalize_email("unlisted@example.com"),
            "unlisted@example.com",
        )

    def test_session_type_aliases(self):
        self.assertEqual(normalize_session_type("Workshops"), "workshop")
        self.assertEqual(normalize_session_type("Mentoring"), "mentoring")
        self.assertEqual(normalize_session_type("Stand-up"), "standup")
        self.assertEqual(normalize_session_type("Stand up"), "standup")
        self.assertEqual(normalize_session_type("Squad Meeting"), "squad_meeting")
        self.assertEqual(normalize_session_type("Something else"), "unknown")

    def test_live_status_classification(self):
        self.assertEqual(normalize_live_status("Yes"), "yes")
        self.assertEqual(
            normalize_live_status("No - approved exceptional circumstances"),
            "approved_exception",
        )
        self.assertEqual(normalize_live_status(""), "blank")
        self.assertEqual(normalize_live_status("No"), "other")
        self.assertEqual(normalize_live_status(None, available=False), "unavailable")


class SeasonMatchingTests(unittest.TestCase):
    def setUp(self):
        self.schedules = [
            {
                "id": "schedule-1",
                "program_id": "program-1",
                "cohort_id": "cohort-1",
                "season_id": "season-1",
                "start_date": "2026-01-01",
                "end_date": "2026-03-01",
            },
            {
                "id": "schedule-2",
                "program_id": "program-1",
                "cohort_id": "cohort-1",
                "season_id": "season-2",
                "start_date": "2026-03-01",
                "end_date": "2026-06-01",
            },
        ]

    def test_start_is_inclusive_and_nonfinal_end_is_exclusive(self):
        matched, reason, final = match_schedule(
            date(2026, 1, 1), "program-1", "cohort-1", self.schedules
        )
        self.assertEqual(matched["id"], "schedule-1")
        self.assertIsNone(reason)
        self.assertFalse(final)

        matched, reason, _ = match_schedule(
            date(2026, 3, 1), "program-1", "cohort-1", self.schedules
        )
        self.assertEqual(matched["id"], "schedule-2")
        self.assertIsNone(reason)

    def test_final_season_end_is_inclusive(self):
        matched, reason, final = match_schedule(
            date(2026, 6, 1), "program-1", "cohort-1", self.schedules
        )
        self.assertEqual(matched["id"], "schedule-2")
        self.assertIsNone(reason)
        self.assertTrue(final)

    def test_schedule_gap_is_not_assigned(self):
        matched, reason, final = match_schedule(
            date(2026, 7, 1), "program-1", "cohort-1", self.schedules
        )
        self.assertIsNone(matched)
        self.assertEqual(reason, "season_schedule_gap")
        self.assertIsNone(final)

    def test_duplicate_latest_end_is_not_marked_final(self):
        schedules = self.schedules + [{
            "id": "schedule-3",
            "program_id": "program-1",
            "cohort_id": "cohort-1",
            "season_id": "season-3",
            "start_date": "2026-05-01",
            "end_date": "2026-06-01",
        }]
        matched, reason, _ = match_schedule(
            date(2026, 6, 1), "program-1", "cohort-1", schedules
        )
        self.assertIsNone(matched)
        self.assertEqual(reason, "season_schedule_gap")

    def test_reference_mismatch_is_not_returned_as_a_valid_assignment(self):
        schedules = [{**self.schedules[0], "_references_valid": False}]
        matched, reason, _ = match_schedule(
            date(2026, 2, 1), "program-1", "cohort-1", schedules
        )
        self.assertIsNone(matched)
        self.assertEqual(reason, "season_schedule_reference_mismatch")


class EligibilityTests(unittest.TestCase):
    def setUp(self):
        self.students = {
            "student@example.com": [{
                "id": "student-1",
                "email": "student@example.com",
                "program_id": "program-1",
                "cohort_id": "cohort-1",
            }]
        }
        self.schedules = [{
            "id": "schedule-1",
            "program_id": "program-1",
            "cohort_id": "cohort-1",
            "season_id": "season-1",
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
        }]
        self.base = dict(
            gid=394749220,
            row_number=2,
            timestamp_raw="06/01/2026 09:15:00",
            email_raw="student@example.com",
            date_raw="06/01/2026",
            type_raw="Workshop",
            live_raw="Yes",
            live_available=True,
            students_by_email=self.students,
            schedules=self.schedules,
        )

    def test_live_yes_workshop_earns_three_points(self):
        result = classify_source_row(**self.base)
        self.assertEqual(result["eligibility_status"], "eligible")
        self.assertEqual(result["points_awarded"], 3)
        self.assertEqual(result["program_cohort_season_id"], "schedule-1")
        self.assertNotIn("email", result)
        self.assertEqual(result["_email_key"], "student@example.com")

    def test_approved_exception_earns_normal_points(self):
        result = classify_source_row(**{**self.base, "live_raw": "No - approved exceptional circumstances"})
        self.assertEqual(result["eligibility_status"], "eligible")
        self.assertEqual(result["points_awarded"], 3)

    def test_standup_earns_one_point(self):
        result = classify_source_row(**{**self.base, "type_raw": "Stand-up"})
        self.assertEqual(result["eligibility_status"], "eligible")
        self.assertEqual(result["points_awarded"], 1)

    def test_blank_live_status_does_not_block_points(self):
        result = classify_source_row(**{**self.base, "live_raw": ""})
        self.assertEqual(result["eligibility_status"], "eligible")
        self.assertEqual(result["points_awarded"], 3)

    def test_legacy_sheet_without_live_status_earns_points(self):
        result = classify_source_row(**{**self.base, "live_raw": None, "live_available": False})
        self.assertEqual(result["eligibility_status"], "eligible")
        self.assertEqual(result["points_awarded"], 3)

    def test_squad_meeting_earns_two_points(self):
        result = classify_source_row(**{**self.base, "type_raw": "Squad Meeting"})
        self.assertEqual(result["eligibility_status"], "eligible")
        self.assertEqual(result["points_awarded"], 2)

    def test_future_session_date_is_excluded(self):
        from datetime import timedelta
        from datetime import date as date_type

        future = (date_type.today() + timedelta(days=10)).strftime("%d/%m/%Y")
        result = classify_source_row(**{**self.base, "date_raw": future})
        self.assertEqual(result["eligibility_status"], "excluded")
        self.assertEqual(result["exclusion_reason"], "session_date_in_future")
        self.assertEqual(result["points_awarded"], 0)

    def test_missing_student_is_unresolved(self):
        result = classify_source_row(**{**self.base, "email_raw": "missing@example.com"})
        self.assertEqual(result["eligibility_status"], "unresolved")
        self.assertEqual(result["exclusion_reason"], "student_email_not_found")

    def test_ambiguous_student_is_unresolved(self):
        students = {
            "student@example.com": [
                self.students["student@example.com"][0],
                {**self.students["student@example.com"][0], "id": "student-2"},
            ]
        }
        result = classify_source_row(**{**self.base, "students_by_email": students})
        self.assertEqual(result["eligibility_status"], "unresolved")
        self.assertEqual(result["exclusion_reason"], "student_email_ambiguous")

    def test_legacy_sheet_mentoring_record_earns_three_points(self):
        result = classify_source_row(**{
            **self.base,
            "gid": 334409729,
            "type_raw": "Mentoring",
            "live_raw": None,
            "live_available": False,
            "date_raw": "06/01/2026",
        })
        self.assertEqual(result["eligibility_status"], "eligible")
        self.assertEqual(result["points_awarded"], 3)


if __name__ == "__main__":
    unittest.main()
