#!/usr/bin/env python3
"""Sync Google Meet attendance emails into the Canvas Masters dashboard."""

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from googleapiclient.discovery import build
from supabase import create_client

from inspect_meet_email import (
    AMSTERDAM,
    ATTENDEE_RANGE,
    GMAIL_QUERY,
    GMAIL_SCOPE,
    SHEETS_SCOPE,
    collect_bodies,
    find_attendance_sheet_id,
    get_header,
    list_all_matching_messages,
    make_credentials,
    parse_meeting_datetime,
    required_env,
)

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

EXPECTED_HEADERS = [
    "first name",
    "last name",
    "email",
    "duration",
    "time joined",
    "time exited",
]

RPC_NAME = "replace_canvas_masters_meeting_attendance"


def parse_cutoff(value):
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise RuntimeError(
            "MEET_ATTENDANCE_START must be an ISO datetime, "
            "for example 2025-09-01T00:00:00"
        ) from exc

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=AMSTERDAM)

    return parsed.astimezone(AMSTERDAM)


def parse_duration_minutes(value):
    text = str(value or "").strip().lower()
    if not text:
        return None

    clock = re.fullmatch(r"(\d+):(\d{1,2})(?::(\d{1,2}))?", text)
    if clock:
        if clock.group(3) is not None:
            return (
                int(clock.group(1)) * 60
                + int(clock.group(2))
                + int(clock.group(3)) / 60
            )
        return int(clock.group(1)) + int(clock.group(2)) / 60

    total = 0.0
    found = False
    pattern = r"([\d.]+)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b"

    for match in re.finditer(pattern, text):
        amount = float(match.group(1))
        if amount < 0:
            continue

        unit = match.group(2)
        if unit in ("hour", "hours", "hr", "hrs", "h"):
            total += amount * 60
        elif unit in ("second", "seconds", "sec", "secs", "s"):
            total += amount / 60
        else:
            total += amount
        found = True

    if found:
        return round(total, 2)

    if re.fullmatch(r"\d+(?:\.\d+)?", text):
        return float(text)

    return None


def execute_sheets_request(request, attempts=6):
    """Retry temporary Google Sheets API errors with exponential backoff."""
    import random
    import time
    from googleapiclient.errors import HttpError

    for attempt in range(attempts):
        try:
            return request.execute()
        except HttpError as exc:
            status = getattr(exc.resp, "status", None)
            if status not in (429, 500, 502, 503, 504) or attempt == attempts - 1:
                raise

            delay = min(2 ** attempt, 32) + random.uniform(0, 1)
            print(
                f"Google Sheets returned HTTP {status}; "
                f"retrying in {delay:.1f} seconds "
                f"(attempt {attempt + 2}/{attempts})."
            )
            time.sleep(delay)


def read_meeting_sheet(sheets, spreadsheet_id):
    # One API request returns both the title and attendee values.
    response = execute_sheets_request(
        sheets.spreadsheets().get(
            spreadsheetId=spreadsheet_id,
            includeGridData=True,
            ranges=[ATTENDEE_RANGE],
            fields=(
                "properties(title),"
                "sheets(data(rowData(values(formattedValue))))"
            ),
        )
    )

    title = response.get("properties", {}).get(
        "title", "Untitled spreadsheet"
    )

    sheet_data = response.get("sheets", [])
    data_blocks = sheet_data[0].get("data", []) if sheet_data else []
    row_data = data_blocks[0].get("rowData", []) if data_blocks else []

    rows = [
        [
            cell.get("formattedValue", "")
            for cell in row.get("values", [])
        ]
        for row in row_data
    ]

    if not rows:
        raise RuntimeError(
            f"Spreadsheet {spreadsheet_id} has no worksheet headers"
        )

    headers = [str(value or "").strip().lower() for value in rows[0]]
    if headers[:len(EXPECTED_HEADERS)] != EXPECTED_HEADERS:
        raise RuntimeError(
            f"Spreadsheet {spreadsheet_id} has unexpected attendee headers"
        )

    # Preserve raw rows for the preview while retaining aggregated import records.
    attendees = {}
    raw_attendees = []

    for row_number, row in enumerate(rows[1:], start=2):
        if not any(str(cell or "").strip() for cell in row):
            continue

        padded = list(row[:6]) + [""] * max(0, 6 - len(row))
        first_name = str(padded[0] or "").strip()
        last_name = str(padded[1] or "").strip()
        email = str(padded[2] or "").strip().lower()
        duration = parse_duration_minutes(padded[3])

        raw_attendees.append({
            "sourceRow": row_number,
            "firstName": first_name,
            "lastName": last_name,
            "studentName": " ".join(part for part in (first_name, last_name) if part),
            "studentEmail": email,
            "durationMinutes": duration,
            "timeJoined": str(padded[4] or "").strip(),
            "timeExited": str(padded[5] or "").strip(),
            "valid": bool(email and duration is not None and duration >= 0),
        })

        if not email:
            continue

        if "@" not in email or email.startswith("@") or email.endswith("@"):
            raise RuntimeError(
                f"Spreadsheet {spreadsheet_id} has an invalid email "
                f"at attendee row {row_number}"
            )

        if duration is None or duration < 0:
            raise RuntimeError(
                f"Spreadsheet {spreadsheet_id} has an invalid duration "
                f"at attendee row {row_number}"
            )

        current = attendees.setdefault(
            email,
            {
                "email": email,
                "first_name": first_name,
                "last_name": last_name,
                "duration_minutes": 0.0,
            },
        )

        current["duration_minutes"] += duration

        if first_name:
            current["first_name"] = first_name
        if last_name:
            current["last_name"] = last_name

    for record in attendees.values():
        record["duration_minutes"] = round(
            record["duration_minutes"], 2
        )

    return title, list(attendees.values()), raw_attendees


def collect_meetings(gmail, sheets, cutoff):
    messages = list_all_matching_messages(gmail)
    print(f"Google Meet report emails found: {len(messages)}")

    meetings = {}
    ignored_before_cutoff = 0
    skipped_non_attendance = []

    for message in messages:
        full_message = (
            gmail.users()
            .messages()
            .get(
                userId="me",
                id=message["id"],
                format="full",
            )
            .execute()
        )

        headers = full_message.get("payload", {}).get("headers", [])
        subject = get_header(headers, "Subject")
        meeting_at = parse_meeting_datetime(subject)

        if meeting_at is None:
            plain_body, html_body = collect_bodies(
                full_message.get("payload", {})
            )
            spreadsheet_id = find_attendance_sheet_id(
                html_body, plain_body
            )

            if not spreadsheet_id:
                body_text = f"{html_body}\n{plain_body}".lower()
                mentions_attendance = bool(
                    re.search(r"\battendance\b", body_text)
                )
                mentions_recording_or_transcript = bool(
                    re.search(r"recording|chat transcript", body_text)
                )

                if (
                    not mentions_attendance
                    and mentions_recording_or_transcript
                ):
                    skipped_non_attendance.append({
                        "message_id": message.get("id", "unknown"),
                        "subject": subject,
                    })
                    print(
                        "Skipped non-attendance email: "
                        f"{message.get('id', 'unknown')} — {subject}"
                    )
                    continue

                raise RuntimeError(
                    f"Unparseable subject and no attendance spreadsheet: "
                    f"{subject!r}; message ID: {message.get('id', 'unknown')}"
                )

            metadata = execute_sheets_request(
                sheets.spreadsheets().get(
                    spreadsheetId=spreadsheet_id,
                    fields="properties(title)"
                )
            )
            sheet_title = (
                metadata.get("properties", {}).get("title", "")
            )
            title_match = re.match(
                r"^\s*(\d{4}-\d{2}-\d{2})\s+"
                r"(\d{1,2}:\d{2})(?:\s|$)",
                sheet_title
            )

            if not title_match:
                raise RuntimeError(
                    f"Subject has no usable date/time and spreadsheet "
                    f"title has no leading timestamp: {sheet_title!r}; "
                    f"message ID: {message.get('id', 'unknown')}"
                )

            try:
                meeting_at = datetime.strptime(
                    f"{title_match.group(1)} {title_match.group(2)}",
                    "%Y-%m-%d %H:%M"
                ).replace(tzinfo=ZoneInfo("Europe/Amsterdam"))
            except ValueError as exc:
                raise RuntimeError(
                    f"Invalid date/time in attendance spreadsheet title: "
                    f"{sheet_title!r}"
                ) from exc

            print(
                f"Used spreadsheet-title timestamp for message "
                f"{message.get('id', 'unknown')}: "
                f"{meeting_at.isoformat()}"
            )

        if meeting_at < cutoff:
            ignored_before_cutoff += 1
            continue

        plain_body, html_body = collect_bodies(
            full_message.get("payload", {})
        )
        spreadsheet_id = find_attendance_sheet_id(html_body, plain_body)

        if not spreadsheet_id:
            body_text = f"{html_body}\n{plain_body}".lower()
            mentions_attendance = bool(
                re.search(r"\battendance\b", body_text)
            )
            mentions_recording_or_transcript = bool(
                re.search(r"recording|chat transcript", body_text)
            )

            if (
                not mentions_attendance
                and mentions_recording_or_transcript
            ):
                skipped_non_attendance.append({
                    "message_id": message.get("id", "unknown"),
                    "subject": subject,
                })
                print(
                    "Skipped non-attendance email: "
                    f"{message.get('id', 'unknown')} — {subject}"
                )
                continue

            raise RuntimeError(
                "A report after the configured cutoff appears relevant "
                "to attendance but has no identifiable spreadsheet. "
                f"Message ID: {message.get('id', 'unknown')}. "
                "No database writes have started."
            )

        meeting_at_utc = meeting_at.astimezone(timezone.utc)

        if spreadsheet_id in meetings:
            previous = meetings[spreadsheet_id]
            if previous["meeting_at"] != meeting_at_utc:
                raise RuntimeError(
                    "The same spreadsheet ID appears in reports with "
                    "different meeting times."
                )
            continue

        # Read and validate every sheet before writing any database data.
        title, records, raw_attendees = read_meeting_sheet(sheets, spreadsheet_id)
        meetings[spreadsheet_id] = {
            "meeting_id": spreadsheet_id,
            "meeting_at": meeting_at_utc,
            "title": title,
            "records": records,
            "raw_attendees": raw_attendees,
            "subject": subject,
            "source_message_id": message.get("id", "unknown"),
        }

        print(
            f"Validated meeting {len(meetings)}: "
            f"{title!r}; attendees={len(records)}"
        )

    if not meetings:
        raise RuntimeError(
            "No eligible attendance meetings were found. "
            "No database writes have started."
        )

    print(f"Reports before cutoff skipped: {ignored_before_cutoff}")
    print(f"Non-attendance emails skipped: {len(skipped_non_attendance)}")
    return list(meetings.values()), {
        "gmail_messages_found": len(messages),
        "skipped_before_cutoff": ignored_before_cutoff,
        "non_attendance_emails_skipped": len(skipped_non_attendance),
    }


def sync_meetings(supabase, meetings, dry_run=False):
    total_attendees = 0

    for meeting in meetings:
        records = meeting["records"]
        total_attendees += len(records)

        if dry_run:
            print(
                f"DRY RUN: would replace meeting {meeting['meeting_id']} "
                f"with {len(records)} unique attendees"
            )
            continue

        payload = {
            "p_meeting_id": meeting["meeting_id"],
            "p_meeting_at": meeting["meeting_at"].isoformat(),
            "p_records": records,
        }

        # The database function replaces the meeting and refreshes the
        # dashboard summary atomically.

        try:
            supabase.rpc(RPC_NAME, payload).execute()
        except Exception as exc:
            raise RuntimeError(
                f"Failed to save attendance for meeting "
                f"{meeting['meeting_id']}: {exc}"
            ) from exc

    summary = {
        "source": "google_meet_gmail_reports",
        "meetings_processed": len(meetings),
        "unique_meeting_attendee_records": total_attendees,
        "cutoff": os.environ.get(
            "MEET_ATTENDANCE_START", "2025-09-01T00:00:00"
        ),
        "dry_run": dry_run,
    }

    if not dry_run:
        supabase.table("canvas_masters_sync_status").upsert(
            {
                "sync_key": "attendance",
                "last_synced_at": datetime.now(timezone.utc).isoformat(),
                "summary": summary,
            },
            on_conflict="sync_key",
        ).execute()

    print(json.dumps(summary, indent=2))


def build_preview_snapshot(meetings, scan_stats, cutoff):
    """Build the dashboard-compatible, read-only preview from validated sheets."""
    reports = []
    non_empty_rows = 0
    rows_with_email = 0

    for meeting in meetings:
        meeting_at = meeting["meeting_at"].isoformat()
        subject = meeting.get("subject") or meeting["title"]
        raw_rows = meeting.get("raw_attendees", [])
        attendees = []

        for row in raw_rows:
            attendee = {
                **row,
                "meetingAt": meeting_at,
                "meetingId": meeting["meeting_id"],
                "sourceReport": subject,
            }
            attendees.append(attendee)

        non_empty_rows += len(raw_rows)
        rows_with_email += sum(
            1 for row in raw_rows if row.get("studentEmail")
        )

        reports.append({
            "subject": subject,
            "meetingAt": meeting_at,
            "timestamp": int(
                meeting["meeting_at"].timestamp() * 1000
            ),
            "spreadsheetId": meeting["meeting_id"],
            "spreadsheetTitle": meeting["title"],
            "attendeeRows": len(raw_rows),
            "emailRows": sum(
                1 for row in raw_rows if row.get("studentEmail")
            ),
            "attendees": attendees,
            "status": "OK",
            "detail": "Attendance sheet read and validated successfully.",
        })

    return {
        "readOnly": True,
        "cutoff": cutoff,
        "summary": {
            "gmailMessagesFound": scan_stats["gmail_messages_found"],
            "eligibleReportEmails": len(meetings),
            "skippedBeforeCutoff": scan_stats["skipped_before_cutoff"],
            "unparseableMeetingTimes": 0,
            "attendanceLinksNotFound": 0,
            "uniqueSpreadsheetIdsFound": len(meetings),
            "successfullyReadSpreadsheets": len(meetings),
            "nonEmptyAttendeeRows": non_empty_rows,
            "rowsContainingEmail": rows_with_email,
            "errors": 0,
        },
        "reports": reports,
    }


def save_preview_attempt(supabase, status, error=None, preview=None):
    """Update attempt metadata without replacing a prior snapshot on failure."""
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "snapshot_key": "latest",
        "last_attempt_at": now,
        "last_attempt_status": status,
        "last_error": error,
        "updated_at": now,
    }

    if preview is not None:
        row["preview"] = preview
        row["last_successful_scan_at"] = now

    # Update an existing row so omitted preview fields remain unchanged.
    update_values = {
        key: value for key, value in row.items()
        if key != "snapshot_key"
    }
    result = (
        supabase.table("canvas_masters_attendance_preview")
        .update(update_values)
        .eq("snapshot_key", "latest")
        .select("snapshot_key")
        .execute()
    )

    # First run: there is no row to update, so create one.
    if not result.data:
        supabase.table(
            "canvas_masters_attendance_preview"
        ).insert(row).execute()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Read and validate all reports without writing to Supabase",
    )
    args = parser.parse_args()

    supabase = None

    try:
        cutoff_value = os.environ.get(
            "MEET_ATTENDANCE_START", "2025-09-01T00:00:00"
        ).strip()
        cutoff = parse_cutoff(cutoff_value)

        supabase_url = required_env("SUPABASE_URL")

        if not args.dry_run:
            role_key = required_env("SUPABASE_ROLE_KEY")
            supabase = create_client(supabase_url, role_key)
            save_preview_attempt(supabase, "running")

        client_id = required_env("MASTERS_ATTENDANCE_GOOGLE_CLIENT_ID")
        client_secret = required_env(
            "MASTERS_ATTENDANCE_GOOGLE_CLIENT_SECRET"
        )
        refresh_token = required_env("MASTERS_ATTENDANCE_REFRESH_TOKEN")

        # Ensure the helper's credential builder sees the required values.
        os.environ["MASTERS_ATTENDANCE_GOOGLE_CLIENT_ID"] = client_id
        os.environ["MASTERS_ATTENDANCE_GOOGLE_CLIENT_SECRET"] = client_secret

        gmail_credentials = make_credentials(refresh_token, [GMAIL_SCOPE])
        sheets_credentials = make_credentials(refresh_token, [SHEETS_SCOPE])

        gmail = build(
            "gmail", "v1", credentials=gmail_credentials,
            cache_discovery=False,
        )
        sheets = build(
            "sheets", "v4", credentials=sheets_credentials,
            cache_discovery=False,
        )

        # Validate all source data before changing attendance or snapshot data.
        meetings, scan_stats = collect_meetings(gmail, sheets, cutoff)

        if args.dry_run:
            sync_meetings(None, meetings, dry_run=True)
            print("Dry run completed; database was not changed.")
            return 0

        # Preserve existing attendance synchronization behavior.
        sync_meetings(supabase, meetings, dry_run=False)

        preview = build_preview_snapshot(
            meetings, scan_stats, cutoff_value
        )
        save_preview_attempt(
            supabase, "completed", preview=preview
        )

        print(
            "Saved Masters Attendance Preview snapshot: "
            f"{len(preview['reports'])} reports, "
            f"{preview['summary']['nonEmptyAttendeeRows']} attendee rows."
        )
        print("Attendance sync and preview snapshot completed successfully.")
        return 0

    except Exception as exc:
        if supabase is not None:
            try:
                save_preview_attempt(
                    supabase, "failed", error=str(exc)[:4000]
                )
                print(
                    "Recorded failed attempt; the last successful "
                    "preview snapshot was preserved.",
                    file=sys.stderr,
                )
            except Exception as status_exc:
                print(
                    "WARNING: could not record failure status in Supabase: "
                    f"{status_exc}",
                    file=sys.stderr,
                )

        print(f"ERROR: Attendance sync failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
