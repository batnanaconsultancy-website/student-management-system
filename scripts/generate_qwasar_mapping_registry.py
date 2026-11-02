#!/usr/bin/env python3
"""Generate read-only Qwasar-to-SIS project mapping registries."""

import csv
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SOURCE_CANDIDATES = ROOT / "qwasar_project_mapping_candidates.json"
SOURCE_UNRESOLVED = ROOT / "qwasar_unresolved_mapping_analysis.json"
SOURCE_CATALOGUE = ROOT / "data" / "qwasar_sis_project_catalogue.csv"

OUTPUT_CANDIDATES = ROOT / "config" / "qwasar_project_mapping_candidates.json"
OUTPUT_APPROVED = ROOT / "config" / "qwasar_project_mappings.json"

REQUIRED_CATALOGUE_FIELDS = {
    "project_id",
    "project_name",
    "program_id",
    "program_name",
    "season_id",
    "season_name",
    "order_in_program",
    "project_order",
}


def load_json(path):
    with path.open(encoding="utf-8") as file:
        return json.load(file)


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def main():
    for path in (SOURCE_CANDIDATES, SOURCE_UNRESOLVED, SOURCE_CATALOGUE):
        if not path.is_file():
            raise FileNotFoundError(f"Required source file not found: {path}")

    source = load_json(SOURCE_CANDIDATES)
    unresolved = load_json(SOURCE_UNRESOLVED)

    with SOURCE_CATALOGUE.open(
        encoding="utf-8-sig", newline=""
    ) as file:
        reader = csv.DictReader(file)
        fields = set(reader.fieldnames or [])
        missing = REQUIRED_CATALOGUE_FIELDS - fields
        if missing:
            raise ValueError(
                f"Catalogue is missing required columns: {sorted(missing)}"
            )
        catalogue = list(reader)

    if not isinstance(source.get("candidates"), list):
        raise ValueError("Candidate source must contain a candidates list.")

    if not isinstance(source.get("unresolved"), list):
        raise ValueError("Candidate source must contain an unresolved list.")

    by_id = {}
    for row in catalogue:
        project_id = row["project_id"].strip()
        if not project_id:
            raise ValueError("Catalogue contains an empty project ID.")
        if project_id in by_id:
            raise ValueError(f"Duplicate SIS project ID in catalogue: {project_id}")
        by_id[project_id] = row

    seen_identities = set()
    seen_candidate_ids = set()
    validated = []
    errors = []

    track_seasons = defaultdict(set)

    for index, candidate in enumerate(source["candidates"], start=1):
        program = candidate["program_name"].strip()
        track = candidate["track_slug"].strip()
        slug = candidate["project_slug"].strip()
        project_id = candidate["sis_project_id"].strip()

        identity = (program, track, slug)
        if identity in seen_identities:
            errors.append(f"Duplicate Qwasar identity: {identity}")
            continue
        seen_identities.add(identity)

        catalogue_row = by_id.get(project_id)
        if catalogue_row is None:
            errors.append(
                f"Candidate {index}: SIS project ID not found: {project_id}"
            )
            continue

        expected = {
            "program_name": program,
            "season_name": candidate["expected_season"].strip(),
            "project_name": candidate["sis_project_name"].strip().casefold(),
        }
        actual = {
            "program_name": catalogue_row["program_name"].strip(),
            "season_name": catalogue_row["season_name"].strip(),
            "project_name": catalogue_row["project_name"].strip().casefold(),
        }

        mismatches = [
            field for field in expected if expected[field] != actual[field]
        ]
        if mismatches:
            errors.append(
                f"Candidate {index} ({program}/{track}/{slug}) "
                f"has catalogue mismatches: {mismatches}"
            )
            continue

        track_seasons[(program, track)].add(actual["season_name"])

        mapping_id = "|".join(identity)

        record = {
            "mapping_id": mapping_id,
            "program_name": program,
            "program_id": catalogue_row["program_id"],
            "track_slug": track,
            "season_name": catalogue_row["season_name"],
            "season_id": catalogue_row["season_id"],
            "order_in_program": int(catalogue_row["order_in_program"]),
            "project_slug": slug,
            "qwasar_project_name": candidate["qwasar_project_name"],
            "sis_project_id": project_id,
            "sis_project_name": catalogue_row["project_name"],
            "project_order": int(catalogue_row["project_order"]),
            "observations": int(candidate["observations"]),
            "validation_status": "CATALOGUE_VALIDATED",
            "approval_status": "PENDING_CURRICULUM_APPROVAL",
            "approval": None,
        }
        validated.append(record)

        if mapping_id in seen_candidate_ids:
            errors.append(f"Duplicate mapping ID: {mapping_id}")
        seen_candidate_ids.add(mapping_id)

    if errors:
        print("VALIDATION FAILED:")
        for error in errors:
            print(f"- {error}")
        return 1

    validated.sort(
        key=lambda item: (
            item["program_name"],
            item["track_slug"],
            item["project_order"],
            item["project_slug"],
        )
    )

    generated_at = datetime.now(timezone.utc).isoformat()

    candidate_registry = {
        "title": "Qwasar-to-SIS Project Mapping Candidates",
        "schema_version": 1,
        "generated_at": generated_at,
        "source_files": [
            "qwasar_project_mapping_candidates.json",
            "qwasar_unresolved_mapping_analysis.json",
            "data/qwasar_sis_project_catalogue.csv",
        ],
        "approval_status": "CANDIDATES_ONLY_NOT_APPROVED",
        "candidate_count": len(validated),
        "unresolved_identity_count": len(unresolved),
        "unresolved_track_group_count": len(source["unresolved"]),
        "track_season_mapping_status": (
            "OBSERVED_FROM_CANDIDATES_NOT_CURRICULUM_APPROVED"
        ),
        "track_season_observations": [
            {
                "program_name": program,
                "track_slug": track,
                "observed_seasons": sorted(seasons),
                "approval_status": "PENDING_CURRICULUM_APPROVAL",
            }
            for (program, track), seasons in sorted(track_seasons.items())
        ],
        "candidates": validated,
        "unresolved": source["unresolved"],
    }

    if OUTPUT_APPROVED.exists():
        approved_registry = load_json(OUTPUT_APPROVED)

        if not isinstance(approved_registry, dict):
            raise ValueError("Approved registry must contain a JSON object.")

        if not isinstance(approved_registry.get("mappings"), list):
            raise ValueError("Approved registry must contain a mappings list.")

        if approved_registry.get("mapping_count") != len(
            approved_registry["mappings"]
        ):
            raise ValueError(
                "Approved registry mapping_count does not match mappings."
            )

        if approved_registry.get("schema_version") != 1:
            raise ValueError("Unsupported approved registry schema version.")

        seen_approved_ids = set()

        for index, mapping in enumerate(
            approved_registry["mappings"],
            start=1,
        ):
            if not isinstance(mapping, dict):
                raise ValueError(
                    f"Approved mapping {index} must be a JSON object."
                )

            mapping_id = mapping.get("mapping_id")

            if not isinstance(mapping_id, str) or not mapping_id.strip():
                raise ValueError(
                    f"Approved mapping {index} has no valid mapping_id."
                )

            if mapping_id in seen_approved_ids:
                raise ValueError(
                    f"Duplicate approved mapping ID: {mapping_id}"
                )

            seen_approved_ids.add(mapping_id)

            if mapping.get("approval_status") != "APPROVED":
                raise ValueError(
                    f"Mapping {mapping_id} is not marked APPROVED."
                )

        print(
            "Existing approved mappings preserved: "
            f"{len(approved_registry['mappings'])}"
        )
    else:
        approved_registry = {
            "title": "Approved Qwasar-to-SIS Project Mappings",
            "schema_version": 1,
            "generated_at": generated_at,
            "approval_policy": (
                "Only explicitly approved mappings may be used for SIS credit."
            ),
            "mapping_count": 0,
            "mappings": [],
        }
        write_json(OUTPUT_APPROVED, approved_registry)

    write_json(OUTPUT_CANDIDATES, candidate_registry)

    print("===== REGISTRY GENERATION SUCCEEDED =====")
    print(f"Catalogue records: {len(catalogue)}")
    print(f"Validated candidates: {len(validated)}")
    print(f"Unresolved identities: {len(unresolved)}")
    print(f"Unresolved track groups: {len(source['unresolved'])}")
    print(f"Observed programme/track combinations: {len(track_seasons)}")
    def display_path(path):
        try:
            return str(path.relative_to(ROOT))
        except ValueError:
            return str(path)

    print(f"Candidate registry: {display_path(OUTPUT_CANDIDATES)}")
    print(f"Approved registry: {display_path(OUTPUT_APPROVED)}")
    print(
        "Approved mappings: "
        f"{approved_registry['mapping_count']}"
    )
    print("Database writes: 0")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
