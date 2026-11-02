import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import generate_qwasar_mapping_registry as registry


class TestQwasarMappingRegistry(unittest.TestCase):

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)

        self.candidates_path = self.root / "candidates.json"
        self.unresolved_path = self.root / "unresolved.json"
        self.catalogue_path = self.root / "catalogue.csv"
        self.output_candidates = self.root / "config" / "candidates.json"
        self.output_approved = self.root / "config" / "approved.json"

        self.catalogue_row = {
            "project_id": "sis-project-001",
            "project_name": "Quest00 Data",
            "program_id": "program-001",
            "program_name": "AI/ML",
            "season_id": "season-001",
            "season_name": "Preseason",
            "order_in_program": "1",
            "project_order": "1",
        }

        self.candidate = {
            "program_name": "AI/ML",
            "track_slug": "preseason-data",
            "expected_season": "Preseason",
            "project_slug": "quest00-data",
            "qwasar_project_name": "Quest00 Data",
            "sis_project_id": "sis-project-001",
            "sis_project_name": "Quest00 Data",
            "observations": 10,
            "mapping_status": (
                "CANDIDATE_REQUIRES_CURRICULUM_CONFIRMATION"
            ),
        }

        self.write_inputs()

    def tearDown(self):
        self.temp_dir.cleanup()

    def write_json(self, path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(data, indent=2),
            encoding="utf-8",
        )

    def write_inputs(self, candidates=None, catalogue_rows=None):
        if candidates is None:
            candidates = [self.candidate]

        if catalogue_rows is None:
            catalogue_rows = [self.catalogue_row]

        self.write_json(
            self.candidates_path,
            {
                "candidates": candidates,
                "unresolved": [],
            },
        )

        self.write_json(self.unresolved_path, [])

        with self.catalogue_path.open(
            "w",
            encoding="utf-8",
            newline="",
        ) as file:
            writer = csv.DictWriter(
                file,
                fieldnames=registry.REQUIRED_CATALOGUE_FIELDS,
            )
            writer.writeheader()
            writer.writerows(catalogue_rows)

    def run_generator(self):
        with (
            patch.object(registry, "SOURCE_CANDIDATES", self.candidates_path),
            patch.object(registry, "SOURCE_UNRESOLVED", self.unresolved_path),
            patch.object(registry, "SOURCE_CATALOGUE", self.catalogue_path),
            patch.object(registry, "OUTPUT_CANDIDATES", self.output_candidates),
            patch.object(registry, "OUTPUT_APPROVED", self.output_approved),
        ):
            return registry.main()

    def test_valid_candidate_generates_unapproved_registry(self):
        result = self.run_generator()

        self.assertEqual(result, 0)

        generated = json.loads(
            self.output_candidates.read_text(encoding="utf-8")
        )

        self.assertEqual(generated["schema_version"], 1)
        self.assertEqual(generated["candidate_count"], 1)
        self.assertEqual(
            generated["approval_status"],
            "CANDIDATES_ONLY_NOT_APPROVED",
        )

        mapping = generated["candidates"][0]

        self.assertEqual(mapping["sis_project_id"], "sis-project-001")
        self.assertEqual(mapping["validation_status"], "CATALOGUE_VALIDATED")
        self.assertEqual(
            mapping["approval_status"],
            "PENDING_CURRICULUM_APPROVAL",
        )
        self.assertIsNone(mapping["approval"])

        approved = json.loads(
            self.output_approved.read_text(encoding="utf-8")
        )

        self.assertEqual(approved["mapping_count"], 0)
        self.assertEqual(approved["mappings"], [])

    def test_duplicate_qwasar_identity_is_rejected(self):
        self.write_inputs(
            candidates=[self.candidate, self.candidate]
        )

        result = self.run_generator()

        self.assertEqual(result, 1)
        self.assertFalse(self.output_candidates.exists())

    def test_unknown_sis_project_id_is_rejected(self):
        candidate = dict(self.candidate)
        candidate["sis_project_id"] = "unknown-project"

        self.write_inputs(candidates=[candidate])

        result = self.run_generator()

        self.assertEqual(result, 1)
        self.assertFalse(self.output_candidates.exists())

    def test_programme_season_and_project_mismatches_are_rejected(self):
        mismatch_cases = [
            ("program_name", "Data Science"),
            ("season_name", "Season 02"),
            ("project_name", "Different Project"),
        ]

        for field, wrong_value in mismatch_cases:
            with self.subTest(field=field):
                row = dict(self.catalogue_row)
                row[field] = wrong_value

                self.write_inputs(catalogue_rows=[row])

                result = self.run_generator()

                self.assertEqual(result, 1)
                self.assertFalse(self.output_candidates.exists())

    def test_missing_catalogue_column_is_rejected(self):
        with self.catalogue_path.open(
            "w",
            encoding="utf-8",
            newline="",
        ) as file:
            writer = csv.DictWriter(
                file,
                fieldnames=[
                    field
                    for field in registry.REQUIRED_CATALOGUE_FIELDS
                    if field != "season_id"
                ],
            )
            writer.writeheader()

        with self.assertRaisesRegex(
            ValueError,
            "Catalogue is missing required columns",
        ):
            self.run_generator()

        self.assertFalse(self.output_candidates.exists())

    def test_existing_approved_mappings_survive_regeneration(self):
        existing_approval = {
            "title": "Approved Qwasar-to-SIS Project Mappings",
            "schema_version": 1,
            "approval_policy": (
                "Only explicitly approved mappings may be used for SIS credit."
            ),
            "mapping_count": 1,
            "mappings": [
                {
                    "mapping_id": "previously-approved-mapping",
                    "approval_status": "APPROVED",
                }
            ],
        }

        self.write_json(self.output_approved, existing_approval)

        result = self.run_generator()

        self.assertEqual(result, 0)

        preserved = json.loads(
            self.output_approved.read_text(encoding="utf-8")
        )

        self.assertEqual(preserved["mapping_count"], 1)
        self.assertEqual(
            preserved["mappings"][0]["mapping_id"],
            "previously-approved-mapping",
        )

    def test_unapproved_entry_in_approved_registry_is_rejected(self):
        invalid_approval = {
            "schema_version": 1,
            "mapping_count": 1,
            "mappings": [
                {
                    "mapping_id": "pending-mapping",
                    "approval_status": "PENDING_CURRICULUM_APPROVAL",
                }
            ],
        }

        self.write_json(self.output_approved, invalid_approval)
        original_content = self.output_approved.read_text(encoding="utf-8")

        with self.assertRaisesRegex(ValueError, "not marked APPROVED"):
            self.run_generator()

        self.assertEqual(
            self.output_approved.read_text(encoding="utf-8"),
            original_content,
        )

    def test_invalid_approved_registry_is_not_overwritten(self):
        invalid_approval = {
            "schema_version": 1,
            "mapping_count": 2,
            "mappings": [],
        }

        self.write_json(self.output_approved, invalid_approval)

        original_content = self.output_approved.read_text(encoding="utf-8")

        with self.assertRaises(ValueError):
            self.run_generator()

        self.assertEqual(
            self.output_approved.read_text(encoding="utf-8"),
            original_content,
        )


if __name__ == "__main__":
    unittest.main()
