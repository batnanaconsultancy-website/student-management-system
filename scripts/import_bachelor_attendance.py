#!/usr/bin/env python3
"""Read-only dry-run importer for the Bachelor's attendance ledger.

This module deliberately contains no INSERT, UPDATE, UPSERT, DELETE, or RPC
operation. It reads two fixed Google Sheets ranges and SELECTs reference data
from Supabase, then prints a privacy-safe summary.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

SPREADSHEET_ID = "1LQum-XZSTaun1cJ7AHxjS63JLGzMPFpCWEAES6gNZTg"

SHEETS = (
    {
        "gid": 334409729,
        "title": "Form responses 1",
        "live_column": None,
    },
    {
        "gid": 394749220,
        "title": "Form responses 2",
        "live_column": "K",
    },
)

HEADERS = {
    "timestamp": "Timestamp",
    "email": "Please enter your Amsterdam Tech email address",
    "date": "What date was the session you attended?",
    "type": "Which session is this form for?",
    "live": "Did you attend this session live?",
}

EMAIL_CORRECTIONS = {
    "nikolay.kirilov@amsterdam.tec": "nikolay.kirilov@elu.nl",
    "nikolay.kirilov@amsterdam.tech": "nikolay.kirilov@elu.nl",
    "dovydas.montvilas@amsterdam.tech": "dovydas.montvillas@amsterdam.tech",
    "hala.kheel@amsterdam.tech": "hala.kaheel@amsterdam.tech",
    "anna.kashkina@amsterdam.tech": "anna.kashkina@elu.nl",
}


def parse_session_date(value: str | None) -> date | None:
    """Use exactly the date formats accepted by the successful audit."""
    value = (value or "").strip()
    if not value:
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            pass
    return None


def parse_submission_timestamp(value: str | None) -> datetime | None:
    """Mirror the audit's explicit timestamp formats and ISO fallback."""
    value = (value or "").strip()
    if not value:
        return None
    for fmt in (
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f",
    ):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            pass
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(
            tzinfo=None
        )
    except ValueError:
        return None


def normalize_email(value: str | None) -> str:
    normalized = (value or "").strip().casefold()
    return EMAIL_CORRECTIONS.get(normalized, normalized)


def normalize_session_type(value: str | None) -> str:
    normalized = " ".join((value or "").casefold().split())
    aliases = {
        "workshop": "workshop",
        "workshops": "workshop",
        "mentoring": "mentoring",
        "stand-up": "standup",
        "stand up": "standup",
        "standup": "standup",
        "squad meeting": "squad_meeting",
    }
    return aliases.get(normalized, "unknown")


def normalize_live_status(value: str | None, *, available: bool = True) -> str:
    if not available:
        return "unavailable"
    normalized = " ".join((value or "").casefold().split())
    normalized = normalized.replace("–", "-").replace("—", "-")
    if normalized == "yes":
        return "yes"
    if (
        normalized.startswith("no")
        and "approved" in normalized
        and "exceptional" in normalized
    ):
        return "approved_exception"
    if not normalized:
        return "blank"
    return "other"


def _as_date(value: Any) -> date:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    return date.fromisoformat(str(value))


def match_schedule(
    session_date: date,
    program_id: str,
    cohort_id: str,
    schedules: list[dict[str, Any]],
) -> tuple[dict[str, Any] | None, str | None, bool | None]:
    """Return one date-matching schedule, a reason, and its final-season flag."""
    relevant = [
        row for row in schedules
        if str(row.get("program_id")) == str(program_id)
        and str(row.get("cohort_id")) == str(cohort_id)
    ]
    if not relevant:
        return None, "season_schedule_missing", None

    dated = []
    for row in relevant:
        start = _as_date(row["start_date"])
        end = _as_date(row["end_date"])
        dated.append((row, start, end))

    latest_end = max(end for _, _, end in dated)
    latest_count = sum(1 for _, _, end in dated if end == latest_end)

    matches = []
    for row, start, end in dated:
        is_final = end == latest_end and latest_count == 1
        in_window = session_date >= start and (
            session_date <= end if is_final else session_date < end
        )
        if in_window:
            matches.append((row, start, end, is_final))

    if not matches:
        return None, "season_schedule_gap", None
    if len(matches) > 1:
        return None, "season_schedule_ambiguous", None

    row, start, end, is_final = matches[0]
    if row.get("_references_valid") is False:
        return None, "season_schedule_reference_mismatch", None
    result = dict(row)
    result["start_date"] = start.isoformat()
    result["end_date"] = end.isoformat()
    return result, None, is_final


def classify_source_row(
    *,
    gid: int,
    row_number: int,
    timestamp_raw: str,
    email_raw: str,
    date_raw: str,
    type_raw: str,
    live_raw: str | None,
    live_available: bool,
    students_by_email: dict[str, list[dict[str, Any]]],
    schedules: list[dict[str, Any]],
) -> dict[str, Any]:
    """Classify one response without returning or logging the source email."""
    email_key = normalize_email(email_raw)
    student_matches = students_by_email.get(email_key, []) if email_key else []
    student = student_matches[0] if len(student_matches) == 1 else None

    parsed_date = parse_session_date(date_raw)
    parsed_timestamp = parse_submission_timestamp(timestamp_raw)
    session_type = normalize_session_type(type_raw)
    live_status = normalize_live_status(live_raw, available=live_available)

    result: dict[str, Any] = {
        "source_sheet_gid": gid,
        "source_row_number": row_number,
        "source_response_key": str(row_number),
        "source_submitted_at": (
            parsed_timestamp.isoformat() if parsed_timestamp else None
        ),
        "source_date_raw": date_raw.strip() or None,
        "source_session_type": type_raw.strip() or None,
        "source_live_status": (
            live_raw.strip() if live_available and live_raw else (
                "" if live_available else None
            )
        ),
        "session_date": parsed_date.isoformat() if parsed_date else None,
        "session_type": session_type,
        "live_status": live_status,
        "student_id": None,
        "program_id": None,
        "cohort_id": None,
        "season_id": None,
        "program_cohort_season_id": None,
        "eligibility_status": "excluded",
        "exclusion_reason": None,
        "points_awarded": 0,
        # Used only for in-memory duplicate diagnostics; never included in report.
        "_email_key": email_key,
    }

    if student is not None:
        result["student_id"] = student.get("id")
        result["program_id"] = student.get("program_id")
        result["cohort_id"] = student.get("cohort_id")

    if not date_raw.strip():
        result["exclusion_reason"] = "session_date_missing"
        return result
    if parsed_date is None:
        result["exclusion_reason"] = "session_date_invalid"
        return result
    if parsed_date > date.today():
        result["exclusion_reason"] = "session_date_in_future"
        return result

    if not email_key:
        result["eligibility_status"] = "unresolved"
        result["exclusion_reason"] = "student_email_missing"
        return result
    if len(student_matches) > 1:
        result["eligibility_status"] = "unresolved"
        result["exclusion_reason"] = "student_email_ambiguous"
        return result
    if student is None:
        result["eligibility_status"] = "unresolved"
        result["exclusion_reason"] = "student_email_not_found"
        return result
    if not student.get("program_id") or not student.get("cohort_id"):
        result["eligibility_status"] = "unresolved"
        result["exclusion_reason"] = "student_program_or_cohort_missing"
        return result

    schedule, schedule_reason, _is_final = match_schedule(
        parsed_date,
        str(student["program_id"]),
        str(student["cohort_id"]),
        schedules,
    )
    if schedule is not None:
        # Keep Season context for excluded rows too; it helps explain the
        # decision without making the row points-eligible.
        result["season_id"] = schedule.get("season_id")
        result["program_cohort_season_id"] = schedule.get("id")

    if session_type == "unknown":
        result["exclusion_reason"] = "session_type_unrecognized"
        return result
    if session_type == "squad_meeting":
        result["exclusion_reason"] = "session_type_not_points_eligible"
        return result

    if live_status == "unavailable":
        result["exclusion_reason"] = "live_status_unavailable"
        return result
    if live_status == "blank":
        result["exclusion_reason"] = "live_status_blank"
        return result
    if live_status == "other":
        result["exclusion_reason"] = "live_status_unrecognized"
        return result

    if schedule_reason:
        result["exclusion_reason"] = schedule_reason
        return result

    result["eligibility_status"] = "eligible"
    result["exclusion_reason"] = None
    result["points_awarded"] = 1 if session_type == "standup" else 3
    return result


def _cell(row: list[str], index: int) -> str:
    return row[index].strip() if index < len(row) and row[index] else ""


def validate_headers(title: str, values: list[list[str]], live_values: list[list[str]] | None) -> None:
    if not values:
        raise RuntimeError(f"{title}: worksheet has no values or header row.")
    header = values[0]
    expected = [
        HEADERS["timestamp"],
        HEADERS["email"],
        HEADERS["date"],
        HEADERS["type"],
    ]
    actual = [header[i].strip() if i < len(header) else "" for i in range(4)]
    if actual != expected:
        raise RuntimeError(
            f"{title}: columns A:D do not match the approved header mapping."
        )
    if live_values is not None:
        live_header = _cell(live_values[0], 0) if live_values else ""
        if live_header != HEADERS["live"]:
            raise RuntimeError(
                f"{title}: column K does not match the approved live-status header."
            )


def load_google_credentials():
    """Load service-account credentials without printing or exposing the secret."""
    from google.oauth2.service_account import Credentials

    raw_json = os.environ.get("GOOGLE_CREDENTIALS_JSON")
    if raw_json:
        try:
            info = json.loads(raw_json)
        except json.JSONDecodeError as exc:
            raise RuntimeError("GOOGLE_CREDENTIALS_JSON is not valid JSON.") from exc
        return Credentials.from_service_account_info(
            info,
            scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"],
        )

    credentials_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if credentials_path and Path(credentials_path).is_file():
        return Credentials.from_service_account_file(
            credentials_path,
            scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"],
        )

    raise RuntimeError(
        "Set GOOGLE_CREDENTIALS_JSON or GOOGLE_APPLICATION_CREDENTIALS "
        "to a read-only Google service-account credential."
    )


def read_source_sheets() -> list[dict[str, Any]]:
    from googleapiclient.discovery import build

    credentials = load_google_credentials()
    service = build("sheets", "v4", credentials=credentials, cache_discovery=False)

    metadata = service.spreadsheets().get(
        spreadsheetId=SPREADSHEET_ID,
        fields="sheets.properties(sheetId,title)",
    ).execute()
    actual = {
        int(sheet["properties"]["sheetId"]): sheet["properties"]["title"]
        for sheet in metadata.get("sheets", [])
    }

    collected: list[dict[str, Any]] = []
    for config in SHEETS:
        gid = config["gid"]
        title = config["title"]
        if actual.get(gid) != title:
            raise RuntimeError(
                f"Spreadsheet worksheet mismatch for GID {gid}; "
                "expected the approved worksheet title."
            )

        range_a_d = f"'{title}'!A:D"
        values_response = service.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID,
            range=range_a_d,
            valueRenderOption="FORMATTED_VALUE",
        ).execute()
        values = values_response.get("values", [])

        live_values = None
        if config["live_column"]:
            live_response = service.spreadsheets().values().get(
                spreadsheetId=SPREADSHEET_ID,
                range=f"'{title}'!K:K",
                valueRenderOption="FORMATTED_VALUE",
            ).execute()
            live_values = live_response.get("values", [])

        validate_headers(title, values, live_values)

        rows = []
        max_length = max(len(values), len(live_values or []))
        for row_number in range(2, max_length + 1):
            row = values[row_number - 1] if row_number - 1 < len(values) else []
            live_row = (
                live_values[row_number - 1]
                if live_values is not None and row_number - 1 < len(live_values)
                else []
            )
            first_four = [_cell(row, i) for i in range(4)]
            live_raw = _cell(live_row, 0) if live_values is not None else None
            if not any(first_four) and not (live_raw or "").strip():
                continue
            rows.append(
                {
                    "gid": gid,
                    "row_number": row_number,
                    "timestamp": first_four[0],
                    "email": first_four[1],
                    "date": first_four[2],
                    "type": first_four[3],
                    "live": live_raw,
                    "live_available": live_values is not None,
                }
            )
        collected.append({"gid": gid, "title": title, "rows": rows})
    return collected


def _fetch_all(query, page_size: int = 1000) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        response = query.range(start, start + page_size - 1).execute()
        page = response.data or []
        rows.extend(page)
        if len(page) < page_size:
            break
        start += page_size
    return rows


def read_reference_data() -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, Any]]]:
    """SELECT-only reference reads using the configured service-role client."""
    repo_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(repo_root))
    from scripts.utils import get_supabase_client

    client = get_supabase_client(service_role=True)

    students = _fetch_all(
        client.from_("students").select("id,email,program_id,cohort_id")
    )
    schedules = _fetch_all(
        client.from_("program_cohort_seasons").select(
            "id,program_id,cohort_id,season_id,start_date,end_date"
        )
    )

    # Confirm that schedule programme/cohort/Season references are internally valid.
    cohorts = _fetch_all(client.from_("cohorts").select("id,program_id"))
    seasons = _fetch_all(client.from_("seasons").select("id,program_id"))
    cohort_program = {str(row["id"]): str(row.get("program_id")) for row in cohorts}
    season_program = {str(row["id"]): str(row.get("program_id")) for row in seasons}

    checked_schedules = []
    invalid_schedule_count = 0
    for schedule in schedules:
        program_id = str(schedule.get("program_id"))
        references_valid = (
            cohort_program.get(str(schedule.get("cohort_id"))) == program_id
            and season_program.get(str(schedule.get("season_id"))) == program_id
        )
        if not references_valid:
            invalid_schedule_count += 1
        checked = dict(schedule)
        checked["_references_valid"] = references_valid
        checked_schedules.append(checked)

    students_by_email: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for student in students:
        key = normalize_email(student.get("email"))
        if key:
            students_by_email[key].append(student)

    # Attach a diagnostic count without exposing any student values.
    if invalid_schedule_count:
        print(
            "WARNING: reference data contains "
            f"{invalid_schedule_count} schedule rows with programme-reference mismatches."
        )

    return dict(students_by_email), checked_schedules


def build_summary(
    source_sheets: list[dict[str, Any]],
    students_by_email: dict[str, list[dict[str, Any]]],
    schedules: list[dict[str, Any]],
) -> dict[str, Any]:
    by_sheet: dict[str, Any] = {}
    type_counts: Counter[str] = Counter()
    live_counts: Counter[str] = Counter()
    eligibility_counts: Counter[str] = Counter()
    reason_counts: Counter[str] = Counter()
    cross_sheet_signatures: dict[int, set[tuple[Any, ...]]] = {}
    all_records = []

    for source in source_sheets:
        records = []
        signatures = set()
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
            # Duplicate signature is diagnostic only; it never suppresses a row.
            if (
                record["_email_key"]
                and record["source_submitted_at"]
                and record["session_date"]
            ):
                signatures.add(
                    (
                        record["_email_key"],
                        record["source_submitted_at"],
                        record["session_date"],
                        record["session_type"],
                    )
                )
            type_counts[record["session_type"]] += 1
            live_counts[record["live_status"]] += 1
            eligibility_counts[record["eligibility_status"]] += 1
            if record["exclusion_reason"]:
                reason_counts[record["exclusion_reason"]] += 1
            records.append(record)
            all_records.append(record)
        cross_sheet_signatures[source["gid"]] = signatures
        by_sheet[str(source["gid"])] = {
            "worksheet": source["title"],
            "source_rows": len(records),
            "eligible": sum(r["eligibility_status"] == "eligible" for r in records),
            "excluded": sum(r["eligibility_status"] == "excluded" for r in records),
            "unresolved": sum(r["eligibility_status"] == "unresolved" for r in records),
        }

    gids = [item["gid"] for item in source_sheets]
    cross_sheet_matches = 0
    if len(gids) == 2:
        cross_sheet_matches = len(
            cross_sheet_signatures.get(gids[0], set())
            & cross_sheet_signatures.get(gids[1], set())
        )

    total = len(all_records)
    eligible = eligibility_counts["eligible"]
    return {
        "mode": "DRY RUN — NO DATABASE WRITES",
        "spreadsheet_id": SPREADSHEET_ID,
        "source_rows": total,
        "eligible_rows": eligible,
        "excluded_rows": eligibility_counts["excluded"],
        "unresolved_rows": eligibility_counts["unresolved"],
        "points_preview": sum(r["points_awarded"] for r in all_records),
        "cross_sheet_exact_signature_matches": cross_sheet_matches,
        "cross_sheet_matches_are_not_deduplicated": True,
        "by_sheet": by_sheet,
        "session_types": dict(sorted(type_counts.items())),
        "live_statuses": dict(sorted(live_counts.items())),
        "eligibility": dict(sorted(eligibility_counts.items())),
        "reasons": dict(sorted(reason_counts.items())),
        "privacy": {
            "emails_printed_or_reported": False,
            "timestamps_printed_or_reported": False,
            "free_text_columns_read": False,
            "free_text_responses_stored": False,
            "row_level_records_in_report": False,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Read-only Bachelor's attendance ledger dry-run."
    )
    parser.add_argument(
        "--report",
        help="Optional path for a JSON summary report (contains aggregate counts only).",
    )
    args = parser.parse_args()

    # Load the repository .env without printing any values.
    repo_root = Path(__file__).resolve().parents[1]
    try:
        from dotenv import load_dotenv
        load_dotenv(repo_root / ".env")
    except ImportError:
        pass

    try:
        print("Reading the two approved Bachelor's attendance worksheets...")
        source_sheets = read_source_sheets()
        print("Reading reference data using SELECT-only Supabase queries...")
        students_by_email, schedules = read_reference_data()
        summary = build_summary(source_sheets, students_by_email, schedules)
    except Exception as exc:
        print(f"DRY-RUN STOPPED: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    rendered = json.dumps(summary, indent=2, sort_keys=True)
    print("\n===== PRIVACY-SAFE ATTENDANCE DRY-RUN SUMMARY =====")
    print(rendered)

    if args.report:
        report_path = Path(args.report).expanduser().resolve()
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(rendered + "\n", encoding="utf-8")
        print(f"\nAggregate-only report written to: {report_path}")

    print("\nNo attendance ledger rows were inserted or updated.")
    print("No student counters or points_assigned values were changed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
