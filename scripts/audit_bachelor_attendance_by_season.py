#!/usr/bin/env python3
"""Read-only, privacy-safe Bachelor attendance audit grouped by Season."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

# Ensure the repository root is importable when this file is run directly.
REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.import_bachelor_attendance import (
    SPREADSHEET_ID,
    _fetch_all,
    classify_source_row,
    read_reference_data,
    read_source_sheets,
)


def read_reporting_metadata() -> dict[str, dict[str, Any]]:
    """Read names and ordering for programme/cohort/Season labels."""
    from scripts.utils import get_supabase_client

    client = get_supabase_client(service_role=True)

    programs = _fetch_all(client.from_("programs").select("id,name"))
    cohorts = _fetch_all(client.from_("cohorts").select("id,name,program_id"))
    seasons = _fetch_all(
        client.from_("seasons").select("id,name,program_id,order_in_program")
    )
    schedules = _fetch_all(
        client.from_("program_cohort_seasons").select(
            "id,program_id,cohort_id,season_id,start_date,end_date"
        )
    )

    program_names = {str(r["id"]): r["name"] for r in programs}
    cohort_names = {str(r["id"]): r["name"] for r in cohorts}
    season_details = {str(r["id"]): r for r in seasons}

    result = {}
    for schedule in schedules:
        program_id = str(schedule["program_id"])
        cohort_id = str(schedule["cohort_id"])
        season_id = str(schedule["season_id"])
        season = season_details.get(season_id, {})
        result[str(schedule["id"])] = {
            "program": program_names.get(program_id, "Unknown programme"),
            "cohort": cohort_names.get(cohort_id, "Unknown cohort"),
            "season": season.get("name", "Unknown Season"),
            "season_order": season.get("order_in_program"),
            "start_date": str(schedule["start_date"]),
            "end_date": str(schedule["end_date"]),
            "program_id": program_id,
            "cohort_id": cohort_id,
            "season_id": season_id,
        }
    return result


def _empty_bucket(metadata: dict[str, Any]) -> dict[str, Any]:
    return {
        **metadata,
        "source_rows": 0,
        "eligible_rows": 0,
        "excluded_rows": 0,
        "unresolved_rows": 0,
        "source_forms": {},
        "session_types": Counter(),
        "eligible_session_types": Counter(),
        "live_statuses": Counter(),
        "exclusion_reasons": Counter(),
        "points_preview": 0,
    }


def _serialise_bucket(bucket: dict[str, Any]) -> dict[str, Any]:
    result = dict(bucket)
    result["source_forms"] = {
        name: dict(counts)
        for name, counts in sorted(result["source_forms"].items())
    }
    for key in (
        "session_types",
        "eligible_session_types",
        "live_statuses",
        "exclusion_reasons",
    ):
        result[key] = dict(sorted(result[key].items()))
    return result


def build_season_report(
    source_sheets: list[dict[str, Any]],
    students_by_email: dict[str, list[dict[str, Any]]],
    schedules: list[dict[str, Any]],
    metadata_by_schedule: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    buckets: dict[str, dict[str, Any]] = {}
    unassigned = {
        "source_rows": 0,
        "source_forms": {},
        "eligible": 0,
        "excluded": 0,
        "unresolved": 0,
        "reasons": Counter(),
    }
    source_totals = {
        source["title"]: {
            "source_rows": 0,
            "eligible_rows": 0,
            "excluded_rows": 0,
            "unresolved_rows": 0,
            "points_preview": 0,
        }
        for source in source_sheets
    }

    for source in source_sheets:
        form_title = source["title"]
        for row in source["rows"]:
            record = classify_source_row(
                gid=source["gid"],
                row_number=row["row_number"],
                timestamp_raw=row["timestamp"],
                email_raw=row["email"],
                date_raw=row["date"],
                type_raw=row["type"],
                live_raw=row["live"],
                live_available=row["live_available"],
                students_by_email=students_by_email,
                schedules=schedules,
            )

            # Count every submission independently in its originating form.
            totals = source_totals[form_title]
            totals["source_rows"] += 1
            status = record["eligibility_status"]
            totals[f"{status}_rows"] += 1
            if status == "eligible":
                totals["points_preview"] += record["points_awarded"]

            schedule_id = record.get("program_cohort_season_id")
            bucket_key = str(schedule_id) if schedule_id else None

            if bucket_key and bucket_key in metadata_by_schedule:
                if bucket_key not in buckets:
                    buckets[bucket_key] = _empty_bucket(
                        metadata_by_schedule[bucket_key]
                    )
                bucket = buckets[bucket_key]
                bucket["source_rows"] += 1
                form = bucket["source_forms"].setdefault(
                    form_title,
                    {
                        "source_rows": 0,
                        "eligible_rows": 0,
                        "excluded_rows": 0,
                        "unresolved_rows": 0,
                        "points_preview": 0,
                    },
                )
                form["source_rows"] += 1
                bucket[f"{status}_rows"] += 1
                form[f"{status}_rows"] += 1
                bucket["session_types"][record["session_type"]] += 1
                bucket["live_statuses"][record["live_status"]] += 1
                if record["exclusion_reason"]:
                    bucket["exclusion_reasons"][record["exclusion_reason"]] += 1
                if status == "eligible":
                    bucket["eligible_session_types"][record["session_type"]] += 1
                    bucket["points_preview"] += record["points_awarded"]
                    form["points_preview"] += record["points_awarded"]
            else:
                unassigned["source_rows"] += 1
                form = unassigned["source_forms"].setdefault(
                    form_title,
                    {
                        "source_rows": 0,
                        "eligible": 0,
                        "excluded": 0,
                        "unresolved": 0,
                    },
                )
                form["source_rows"] += 1
                status = record["eligibility_status"]
                unassigned[status] += 1
                form[status] += 1
                unassigned["reasons"][
                    record["exclusion_reason"] or "season_unassigned"
                ] += 1

    season_rows = sorted(
        (_serialise_bucket(bucket) for bucket in buckets.values()),
        key=lambda r: (
            r["program"], r["cohort"],
            r["season_order"] if r["season_order"] is not None else 9999,
            r["season"],
        ),
    )

    return {
        "mode": "READ-ONLY AUDIT — NO DATABASE WRITES",
        "spreadsheet_id": SPREADSHEET_ID,
        "source_rows": sum(len(s["rows"]) for s in source_sheets),
        "source_forms": {
            name: dict(counts)
            for name, counts in sorted(source_totals.items())
        },
        "combined_totals": {
            key: sum(counts[key] for counts in source_totals.values())
            for key in (
                "source_rows",
                "eligible_rows",
                "excluded_rows",
                "unresolved_rows",
                "points_preview",
            )
        },
        "season_count_with_source_rows": len(season_rows),
        "season_reports": season_rows,
        "unassigned_records": {
            "source_rows": unassigned["source_rows"],
            "source_forms": {
                name: dict(counts)
                for name, counts in sorted(unassigned["source_forms"].items())
            },
            "eligible": unassigned["eligible"],
            "excluded": unassigned["excluded"],
            "unresolved": unassigned["unresolved"],
            "reasons": dict(sorted(unassigned["reasons"].items())),
        },
        "attendance_denominator": {
            "status": "NOT CALCULATED",
            "reason": (
                "Scheduled sessions and calendar exceptions still require "
                "reconciliation by cohort and Season."
            ),
        },
        "privacy": {
            "emails_reported": False,
            "student_ids_reported": False,
            "timestamps_reported": False,
            "source_row_numbers_reported": False,
            "individual_records_reported": False,
            "free_text_columns_read": False,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Read-only Bachelor attendance audit grouped by Season."
    )
    parser.add_argument(
        "--report",
        default="reports/bachelor-attendance-season-audit.json",
        help="Output path for aggregate-only JSON report.",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    try:
        from dotenv import load_dotenv
        load_dotenv(repo_root / ".env")
    except ImportError:
        pass

    try:
        print("Reading the two approved attendance worksheets...")
        source_sheets = read_source_sheets()

        print("Reading student and Season schedule references...")
        students_by_email, schedules = read_reference_data()

        print("Reading programme, cohort and Season labels...")
        metadata = read_reporting_metadata()

        print("Building aggregate-only Season report...")
        report = build_season_report(
            source_sheets, students_by_email, schedules, metadata
        )
    except Exception as exc:
        print(
            f"AUDIT STOPPED: {type(exc).__name__}: {exc}",
            file=sys.stderr,
        )
        return 1

    rendered = json.dumps(report, indent=2, sort_keys=True)
    output_path = Path(args.report).expanduser()
    if not output_path.is_absolute():
        output_path = repo_root / output_path
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(rendered + "\n", encoding="utf-8")

    print("\n===== SEASON ATTENDANCE AUDIT =====")
    print(rendered)
    print(f"\nAggregate-only report saved to: {output_path}")
    print("No attendance ledger rows were inserted or updated.")
    print("No student counters or points_assigned values were changed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
