import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from update_points_assigned import (
    BACHELOR_PROGRAM_IDS,
    calculate_student_points,
    PointsAssignmentManager,
    fetch_all,
)


AI_ML = "bd715dd5-dc5a-414a-98f9-660274fd60e0"
DATA_SCIENCE = "c266131f-8e5e-4f39-9711-54523d65ea24"
SOFTWARE_ENGINEERING = "07bc935a-c743-4cab-b10c-a1d231eaf3e2"
NON_BACHELOR = "00000000-0000-0000-0000-000000000001"


class TestPointsAssignment(unittest.TestCase):

    def test_all_three_bachelor_programmes_use_ledger_points(self):
        for program_id in BACHELOR_PROGRAM_IDS:
            with self.subTest(program_id=program_id):
                student = {
                    "id": "student-1",
                    "program_id": program_id,
                    "workshops_attended": 100,
                    "mentoring_attended": 100,
                    "standup_attended": 100,
                }
                self.assertEqual(
                    calculate_student_points(student, {"student-1": 17}),
                    17,
                )

    def test_bachelor_without_eligible_records_gets_zero(self):
        student = {
            "id": "student-2",
            "program_id": AI_ML,
            "workshops_attended": 10,
            "mentoring_attended": 10,
            "standup_attended": 10,
        }
        self.assertEqual(calculate_student_points(student, {}), 0)

    def test_non_bachelor_retains_legacy_formula(self):
        student = {
            "id": "student-3",
            "program_id": NON_BACHELOR,
            "workshops_attended": 2,
            "mentoring_attended": 3,
            "standup_attended": 4,
        }
        self.assertEqual(calculate_student_points(student, {}), 19)

    def test_bachelor_uses_only_its_own_ledger_total(self):
        student = {
            "id": "student-4",
            "program_id": DATA_SCIENCE,
            "workshops_attended": 99,
            "mentoring_attended": 99,
            "standup_attended": 99,
        }
        totals = {"student-4": 12, "another-student": 500}
        self.assertEqual(calculate_student_points(student, totals), 12)

    def test_software_engineering_bachelor_uses_ledger(self):
        student = {
            "id": "student-5",
            "program_id": SOFTWARE_ENGINEERING,
            "workshops_attended": 0,
            "mentoring_attended": 0,
            "standup_attended": 0,
        }
        self.assertEqual(
            calculate_student_points(student, {"student-5": 2}),
            2,
        )


class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeQuery:
    def __init__(self, client, table):
        self.client = client
        self.table = table
        self.filters = {}
        self.start = 0
        self.end = None
        self.is_update = False
        self.update_values = None

    def select(self, _fields):
        return self

    def eq(self, field, value):
        self.filters[field] = value
        return self

    def range(self, start, end):
        self.start = start
        self.end = end
        return self

    def order(self, field, desc=False):
        self.order_field = field
        self.order_desc = desc
        return self

    def limit(self, count):
        self.limit_count = count
        return self

    def update(self, values):
        self.is_update = True
        self.update_values = values
        return self

    def execute(self):
        if self.is_update:
            self.client.updates.append(
                (self.table, self.filters.copy(), self.update_values)
            )
            for row in self.client.tables.get(self.table, []):
                if all(row.get(field) == value for field, value in self.filters.items()):
                    row.update(self.update_values)
            return FakeResponse([])

        rows = self.client.tables.get(self.table, [])

        for field, value in self.filters.items():
            rows = [row for row in rows if row.get(field) == value]

        if getattr(self, "order_field", None):
            rows = sorted(
                rows,
                key=lambda row: row.get(self.order_field) or 0,
                reverse=getattr(self, "order_desc", False),
            )

        if getattr(self, "limit_count", None) is not None:
            rows = rows[:self.limit_count]

        if self.end is not None:
            rows = rows[self.start:self.end + 1]

        return FakeResponse(rows)


class FakeSupabase:
    def __init__(self, tables):
        self.tables = tables
        self.updates = []

    def from_(self, table):
        return FakeQuery(self, table)


class TestLedgerAggregationAndDryRun(unittest.TestCase):

    def test_ledger_aggregation_ignores_programme_mismatches(self):
        client = FakeSupabase({
            "bachelor_attendance_records": [
                {
                    "student_id": "student-1",
                    "program_id": AI_ML,
                    "points_awarded": 3,
                    "eligibility_status": "eligible",
                },
                {
                    "student_id": "student-1",
                    "program_id": AI_ML,
                    "points_awarded": 2,
                    "eligibility_status": "eligible",
                },
                {
                    "student_id": "student-1",
                    "program_id": DATA_SCIENCE,
                    "points_awarded": 100,
                    "eligibility_status": "eligible",
                },
                {
                    "student_id": "student-1",
                    "program_id": AI_ML,
                    "points_awarded": 50,
                    "eligibility_status": "excluded",
                },
            ]
        })
        manager = PointsAssignmentManager(client)
        manager._student_programs = {"student-1": AI_ML}

        totals, matched_count, mismatch_count = (
            manager.fetch_eligible_ledger_totals({"student-1"})
        )

        self.assertEqual(totals, {"student-1": 5})
        self.assertEqual(matched_count, 2)
        self.assertEqual(mismatch_count, 1)
        self.assertEqual(manager._ledger_record_counts["student-1"], 2)

    def test_ledger_pagination_fetches_every_page(self):
        client = FakeSupabase({
            "bachelor_attendance_records": [
                {
                    "student_id": "student-1",
                    "program_id": AI_ML,
                    "points_awarded": 1,
                    "eligibility_status": "eligible",
                }
                for _ in range(5)
            ]
        })
        manager = PointsAssignmentManager(client)
        manager._student_programs = {"student-1": AI_ML}

        # A page size of two forces multiple range requests.
        original_page_size = 2
        query = (
            client.from_("bachelor_attendance_records")
            .select("student_id, program_id, points_awarded")
            .eq("eligibility_status", "eligible")
        )
        rows = fetch_all(query, page_size=original_page_size)

        self.assertEqual(len(rows), 5)

    def test_dry_run_never_calls_update(self):
        client = FakeSupabase({
            "students": [
                {
                    "id": "bachelor-1",
                    "username": "bachelor",
                    "program_id": AI_ML,
                    "workshops_attended": 10,
                    "mentoring_attended": 10,
                    "standup_attended": 10,
                },
                {
                    "id": "other-1",
                    "username": "other",
                    "program_id": NON_BACHELOR,
                    "workshops_attended": 2,
                    "mentoring_attended": 3,
                    "standup_attended": 4,
                },
            ],
            "bachelor_attendance_records": [
                {
                    "student_id": "bachelor-1",
                    "program_id": AI_ML,
                    "points_awarded": 7,
                    "eligibility_status": "eligible",
                }
            ],
        })

        manager = PointsAssignmentManager(client)
        self.assertTrue(manager.update_all_student_points(dry_run=True))
        self.assertEqual(client.updates, [])

    def test_live_update_writes_calculated_values(self):
        client = FakeSupabase({
            "students": [
                {
                    "id": "bachelor-1",
                    "username": "bachelor",
                    "program_id": AI_ML,
                    "workshops_attended": 10,
                    "mentoring_attended": 10,
                    "standup_attended": 10,
                },
                {
                    "id": "other-1",
                    "username": "other",
                    "program_id": NON_BACHELOR,
                    "workshops_attended": 2,
                    "mentoring_attended": 3,
                    "standup_attended": 4,
                },
            ],
            "bachelor_attendance_records": [
                {
                    "student_id": "bachelor-1",
                    "program_id": AI_ML,
                    "points_awarded": 7,
                    "eligibility_status": "eligible",
                }
            ],
        })

        manager = PointsAssignmentManager(client)
        self.assertTrue(manager.update_all_student_points(dry_run=False))

        written = {
            filters["id"]: values["points_assigned"]
            for _table, filters, values in client.updates
        }
        self.assertEqual(written, {"bachelor-1": 7, "other-1": 19})



if __name__ == "__main__":
    unittest.main()
