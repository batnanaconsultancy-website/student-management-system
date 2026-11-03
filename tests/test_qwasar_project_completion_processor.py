import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from data_processor import ProjectCompletionProcessor, prepare_public_student_data


PROGRAM_ID = "program-1"
STUDENT_ID = "student-1"
PROJECT_ID = "project-1"
SEASON_ID = "season-1"


def approved_mapping():
    return {
        "mapping_id": "program-1|track-a|project-a",
        "program_id": PROGRAM_ID,
        "track_slug": "track-a",
        "season_id": SEASON_ID,
        "project_slug": "project-a",
        "sis_project_id": PROJECT_ID,
        "approval_status": "APPROVED",
        "approval": {
            "approved_by": "curriculum-admin",
            "approved_at": "2026-10-01T00:00:00Z",
        },
    }


class FakeQuery:
    def __init__(self, client, table):
        self.client = client
        self.table = table
        self.filters = []

    def select(self, columns):
        return self

    def in_(self, column, values):
        self.filters.append((column, set(values)))
        return self

    def execute(self):
        rows = list(self.client.tables.get(self.table, []))
        for column, values in self.filters:
            rows = [row for row in rows if row.get(column) in values]
        return SimpleNamespace(data=rows)


class FakeRPC:
    def __init__(self, client, name, params):
        self.client = client
        self.name = name
        self.params = params

    def execute(self):
        self.client.rpc_calls.append({
            "name": self.name,
            "params": self.params,
        })

        if self.client.rpc_error:
            raise self.client.rpc_error

        if self.name != "apply_qwasar_project_completion_batch":
            raise AssertionError(f"Unexpected RPC: {self.name}")

        # Prepare changes separately, simulating one atomic database operation.
        current = [
            dict(row)
            for row in self.client.tables["student_project_completion"]
        ]
        changed = 0

        grouped = {}
        for item in self.params["p_records"]:
            key = (item["student_id"], item["project_id"])
            status = item["status"]
            if status not in ("COMPLETED", "IN_PROGRESS"):
                raise ValueError("Invalid completion status")
            if key not in grouped or status == "COMPLETED":
                grouped[key] = status

        for (student_id, project_id), status in grouped.items():
            existing = next(
                (
                    row for row in current
                    if row["student_id"] == student_id
                    and row["project_id"] == project_id
                ),
                None,
            )

            if existing is None:
                current.append({
                    "student_id": student_id,
                    "project_id": project_id,
                    "is_completed": status == "COMPLETED",
                    "grade": None,
                    "completed_at": None,
                })
                changed += 1
            elif status == "COMPLETED" and existing["is_completed"] is not True:
                # Promote only the boolean. Preserve grade and completed_at.
                existing["is_completed"] = True
                changed += 1
            # IN_PROGRESS never modifies an existing row.

        self.client.tables["student_project_completion"] = current
        return SimpleNamespace(data=changed)


class FakeClient:
    def __init__(self, tables):
        self.tables = tables
        self.rpc_calls = []
        self.rpc_error = None

    def from_(self, table):
        return FakeQuery(self, table)

    def rpc(self, name, params):
        return FakeRPC(self, name, params)


class TestPublicStudentDataPreparation(unittest.TestCase):
    def test_removes_qwasar_observations_without_mutating_scraped_data(self):
        observations = [{
            "project_slug": "project-a",
            "completion_status": "COMPLETED",
        }]
        scraped_data = [{
            "name": "student-one",
            "points": 100,
            "qwasar_project_observations": observations,
        }]

        public_data = prepare_public_student_data(scraped_data)

        self.assertEqual(public_data, [{
            "name": "student-one",
            "points": 100,
        }])
        self.assertIsNot(public_data, scraped_data)
        self.assertEqual(
            scraped_data[0]["qwasar_project_observations"],
            observations,
        )


class TestApprovedQwasarProjectCompletionProcessor(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.registry_path = Path(self.temp_dir.name) / "approved.json"
        self.write_registry([approved_mapping()])

        self.client = FakeClient({
            "students": [{
                "id": STUDENT_ID,
                "username": "student-one",
                "program_id": PROGRAM_ID,
            }],
            "projects": [{
                "id": PROJECT_ID,
                "program_id": PROGRAM_ID,
                "season_id": SEASON_ID,
            }],
            "seasons": [{
                "id": SEASON_ID,
                "program_id": PROGRAM_ID,
            }],
            "student_project_completion": [],
        })

        self.processor = ProjectCompletionProcessor(
            self.client,
            registry_path=self.registry_path,
        )

    def tearDown(self):
        self.temp_dir.cleanup()

    def write_registry(self, mappings):
        self.registry_path.write_text(json.dumps({
            "schema_version": 1,
            "mapping_count": len(mappings),
            "mappings": mappings,
        }), encoding="utf-8")

    def scrape(self, observations):
        return [{
            "name": "student-one",
            "qwasar_project_observations": observations,
        }]

    def observation(self, status, **overrides):
        result = {
            "username": "student-one",
            "track_slug": "track-a",
            "project_slug": "project-a",
            "completion_status": status,
        }
        result.update(overrides)
        return result

    def existing_row(self, completed, grade=72, completed_at="2026-07-01T00:00:00Z"):
        return {
            "id": "completion-1",
            "student_id": STUDENT_ID,
            "project_id": PROJECT_ID,
            "is_completed": completed,
            "grade": grade,
            "completed_at": completed_at,
        }

    def test_empty_registry_is_no_op(self):
        self.write_registry([])
        processor = ProjectCompletionProcessor(
            self.client, registry_path=self.registry_path
        )
        self.assertFalse(
            processor.update_project_completion(
                self.scrape([self.observation("COMPLETED")])
            )
        )
        self.assertEqual(self.client.rpc_calls, [])

    def test_rejects_unapproved_mapping(self):
        mapping = approved_mapping()
        mapping["approval_status"] = "PENDING_CURRICULUM_APPROVAL"
        self.write_registry([mapping])
        with self.assertRaisesRegex(ValueError, "not marked APPROVED"):
            ProjectCompletionProcessor(
                self.client, registry_path=self.registry_path
            )

    def test_rejects_missing_approval_identity(self):
        mapping = approved_mapping()
        mapping["approval"]["approved_by"] = "   "
        self.write_registry([mapping])

        with self.assertRaisesRegex(ValueError, "approval.approved_by"):
            ProjectCompletionProcessor(
                self.client, registry_path=self.registry_path
            )

    def test_rejects_invalid_or_timezone_naive_approval_timestamp(self):
        invalid_timestamps = [
            "not-a-timestamp",
            "2026-10-01T00:00:00",
        ]

        for timestamp in invalid_timestamps:
            with self.subTest(timestamp=timestamp):
                mapping = approved_mapping()
                mapping["approval"]["approved_at"] = timestamp
                self.write_registry([mapping])

                with self.assertRaisesRegex(
                    ValueError, "approval.approved_at"
                ):
                    ProjectCompletionProcessor(
                        self.client, registry_path=self.registry_path
                    )

    def test_rejects_duplicate_identity(self):
        mapping = approved_mapping()
        duplicate = dict(mapping, mapping_id="another-id")
        self.write_registry([mapping, duplicate])
        with self.assertRaisesRegex(ValueError, "Duplicate approved Qwasar identity"):
            ProjectCompletionProcessor(
                self.client, registry_path=self.registry_path
            )

    def test_completed_observation_calls_rpc_and_inserts_completed_row(self):
        result = self.processor.update_project_completion(
            self.scrape([self.observation("COMPLETED")])
        )
        self.assertTrue(result)
        self.assertEqual(len(self.client.rpc_calls), 1)
        call = self.client.rpc_calls[0]
        self.assertEqual(call["name"], "apply_qwasar_project_completion_batch")
        self.assertEqual(call["params"]["p_records"], [{
            "student_id": STUDENT_ID,
            "project_id": PROJECT_ID,
            "status": "COMPLETED",
        }])
        row = self.client.tables["student_project_completion"][0]
        self.assertTrue(row["is_completed"])

    def test_in_progress_inserts_incomplete_row(self):
        self.assertTrue(
            self.processor.update_project_completion(
                self.scrape([self.observation("IN_PROGRESS")])
            )
        )
        row = self.client.tables["student_project_completion"][0]
        self.assertFalse(row["is_completed"])

    def test_completed_wins_when_both_statuses_are_observed(self):
        self.assertTrue(self.processor.update_project_completion(self.scrape([
            self.observation("IN_PROGRESS"),
            self.observation("COMPLETED"),
        ])))
        records = self.client.rpc_calls[0]["params"]["p_records"]
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["status"], "COMPLETED")
        self.assertTrue(self.client.tables["student_project_completion"][0]["is_completed"])

    def test_in_progress_never_downgrades_existing_completed_row(self):
        original = self.existing_row(True, 95, "2026-08-01T00:00:00Z")
        self.client.tables["student_project_completion"] = [dict(original)]

        self.assertTrue(
            self.processor.update_project_completion(
                self.scrape([self.observation("IN_PROGRESS")])
            )
        )
        self.assertEqual(self.client.tables["student_project_completion"], [original])

    def test_completed_promotes_incomplete_without_overwriting_metadata(self):
        original = self.existing_row(False, 72, "2026-07-01T00:00:00Z")
        self.client.tables["student_project_completion"] = [dict(original)]

        self.assertTrue(
            self.processor.update_project_completion(
                self.scrape([self.observation("COMPLETED")])
            )
        )
        row = self.client.tables["student_project_completion"][0]
        self.assertTrue(row["is_completed"])
        self.assertEqual(row["grade"], 72)
        self.assertEqual(row["completed_at"], "2026-07-01T00:00:00Z")

    def test_rpc_failure_is_reported(self):
        self.client.rpc_error = RuntimeError("simulated RPC failure")
        with self.assertRaisesRegex(RuntimeError, "Atomic Qwasar completion update failed"):
            self.processor.update_project_completion(
                self.scrape([self.observation("COMPLETED")])
            )
        self.assertEqual(self.client.tables["student_project_completion"], [])

    def test_rejects_project_from_another_programme(self):
        self.client.tables["projects"][0]["program_id"] = "other-program"
        self.assertFalse(
            self.processor.update_project_completion(
                self.scrape([self.observation("COMPLETED")])
            )
        )
        self.assertEqual(self.client.rpc_calls, [])

    def test_rejects_season_from_another_programme(self):
        self.client.tables["seasons"][0]["program_id"] = "other-program"
        self.assertFalse(
            self.processor.update_project_completion(
                self.scrape([self.observation("COMPLETED")])
            )
        )
        self.assertEqual(self.client.rpc_calls, [])

    def test_rejects_project_assigned_to_different_season(self):
        self.client.tables["projects"][0]["season_id"] = "other-season"
        self.assertFalse(
            self.processor.update_project_completion(
                self.scrape([self.observation("COMPLETED")])
            )
        )
        self.assertEqual(self.client.rpc_calls, [])

    def test_does_not_use_legacy_display_name_fields(self):
        self.assertFalse(self.processor.update_project_completion([{
            "name": "student-one",
            "completed_projects": ["Project A"],
            "ongoing_projects": [],
        }]))
        self.assertEqual(self.client.rpc_calls, [])

    def test_rejects_observation_username_mismatch(self):
        self.assertFalse(
            self.processor.update_project_completion(
                self.scrape([
                    self.observation("COMPLETED", username="someone-else")
                ])
            )
        )
        self.assertEqual(self.client.rpc_calls, [])


if __name__ == "__main__":
    unittest.main()
