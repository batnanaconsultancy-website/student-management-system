#!/usr/bin/env python3
"""
Inspect Google Meet attendance-report emails and linked spreadsheets.

READ-ONLY:
- Reads Gmail messages.
- Reads Google Sheets attendance worksheets.
- Does not write to Gmail, Google Sheets, Supabase, or Canvas.
- Does not print attendee names or email addresses.

Required environment variables:
    MASTERS_ATTENDANCE_GOOGLE_CLIENT_ID
    MASTERS_ATTENDANCE_GOOGLE_CLIENT_SECRET
    MASTERS_ATTENDANCE_REFRESH_TOKEN
    MASTERS_ATTENDANCE_REFRESH_TOKEN

Optional:
    MEET_ATTENDANCE_START
    Default: 2025-09-01T00:00:00
"""

import os
import re
import sys
import base64
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from zoneinfo import ZoneInfo

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError


AMSTERDAM = ZoneInfo("Europe/Amsterdam")

DEFAULT_START = "2025-09-01T00:00:00"

GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"

GMAIL_QUERY = (
    'from:meetings-noreply@google.com '
    'subject:"Meeting records"'
)

ATTENDEE_RANGE = "Attendees!A1:F"

TIMEZONES = {
    "UTC": timezone.utc,
    "GMT": timezone.utc,
    "CET": timezone(timedelta(hours=1)),
    "CEST": timezone(timedelta(hours=2)),
    "EST": timezone(timedelta(hours=-5)),
    "EDT": timezone(timedelta(hours=-4)),
    "CST": timezone(timedelta(hours=-6)),
    "CDT": timezone(timedelta(hours=-5)),
    "MST": timezone(timedelta(hours=-7)),
    "MDT": timezone(timedelta(hours=-6)),
    "PST": timezone(timedelta(hours=-8)),
    "PDT": timezone(timedelta(hours=-7)),
}


def required_env(name):
    value = os.environ.get(name, "").strip()

    if not value:
        raise RuntimeError(
            f"Required environment variable is missing: {name}"
        )

    return value


def make_credentials(refresh_token, scopes):
    return Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=required_env("MASTERS_ATTENDANCE_GOOGLE_CLIENT_ID"),
        client_secret=required_env("MASTERS_ATTENDANCE_GOOGLE_CLIENT_SECRET"),
        scopes=scopes,
    )


def decode_part(data):
    if not data:
        return ""

    data += "=" * (-len(data) % 4)

    try:
        return base64.urlsafe_b64decode(data).decode(
            "utf-8",
            errors="replace"
        )
    except Exception:
        return ""


def collect_bodies(payload):
    """Return the plain-text and HTML bodies of a Gmail message."""

    plain_parts = []
    html_parts = []

    def walk(part):
        mime_type = part.get("mimeType", "")
        body = part.get("body", {})
        data = decode_part(body.get("data"))

        if mime_type == "text/plain" and data:
            plain_parts.append(data)

        elif mime_type == "text/html" and data:
            html_parts.append(data)

        for child in part.get("parts", []) or []:
            walk(child)

    walk(payload)

    return "\n".join(plain_parts), "\n".join(html_parts)


class AnchorParser(HTMLParser):
    """Collect links and their visible anchor text from HTML."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.anchors = []
        self.current_href = None
        self.current_text = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "a":
            self.current_href = dict(attrs).get("href") or ""
            self.current_text = []

    def handle_data(self, data):
        if self.current_href is not None:
            self.current_text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self.current_href is not None:
            label = " ".join(self.current_text).strip()

            self.anchors.append((self.current_href, label))

            self.current_href = None
            self.current_text = []


def extract_spreadsheet_id(text):
    """Extract an ID only from an actual spreadsheet URL."""

    if not text:
        return None

    patterns = [
        r"https?://docs\.google\.com/spreadsheets/d/([A-Za-z0-9_-]+)",
        r"https?://drive\.google\.com/open\?id=([A-Za-z0-9_-]+)",
    ]

    for pattern in patterns:
        match = re.search(pattern, text)

        if match:
            return match.group(1)

    return None


def find_attendance_sheet_id(html_body, plain_body):
    """
    Find the spreadsheet linked to attendance in the email.

    Prefer an explicit attendance link. Never guess spreadsheet IDs.
    """

    if html_body:
        parser = AnchorParser()

        try:
            parser.feed(html_body)
        except Exception:
            pass

        attendance_candidates = []
        all_sheet_candidates = []

        for href, label in parser.anchors:
            sheet_id = extract_spreadsheet_id(href)

            if not sheet_id:
                continue

            all_sheet_candidates.append(sheet_id)

            if "attendance" in label.lower():
                attendance_candidates.append(sheet_id)

        if attendance_candidates:
            return attendance_candidates[0]

        # Accept a generic spreadsheet link only when the email explicitly
        # mentions attendance and exactly one spreadsheet ID is present.
        if (
            all_sheet_candidates
            and re.search(r"\battendance\b", html_body, re.IGNORECASE)
            and len(set(all_sheet_candidates)) == 1
        ):
            return all_sheet_candidates[0]

    if plain_body:
        pattern = (
            r"https?://docs\.google\.com/spreadsheets/d/"
            r"[A-Za-z0-9_-]+[^\s<>]*"
        )

        for match in re.finditer(pattern, plain_body, re.IGNORECASE):
            start = max(0, match.start() - 250)
            end = min(len(plain_body), match.end() + 250)

            context = plain_body[start:end]

            if re.search(r"\battendance\b", context, re.IGNORECASE):
                return extract_spreadsheet_id(match.group(0))

    return None


def parse_meeting_datetime(subject):
    """
    Parse subjects such as:
      Meeting records: 11 Aug 2026 at 6:58 PM CEST
      Meeting records: 6 May 2026 at 1:01 PM GMT-03:00
      Meeting records: 25 Feb 2026 at 11:56 AM EST
    """

    match = re.search(
        r"Meeting records:\s*(.*?)\s+at\s+"
        r"(\d{1,2}:\d{2}\s*[AP]M)\s*(.*?)\s*$",
        subject,
        re.IGNORECASE,
    )

    if not match:
        return None

    date_text = match.group(1).strip()
    date_text = re.sub(
    r"\bSept\b", "Sep", date_text, flags=re.IGNORECASE
    )
    time_text = re.sub(
        r"\s+", " ", match.group(2).strip()
    ).upper()
    zone_text = match.group(3).strip().upper()

    parsed_date = None

    for fmt in (
        "%d %b %Y",
        "%d %B %Y",
        "%b %d, %Y",
        "%B %d, %Y",
    ):
        try:
            parsed_date = datetime.strptime(
                date_text, fmt
            ).date()
            break
        except ValueError:
            continue

    if parsed_date is None:
        return None

    try:
        parsed_time = datetime.strptime(
            time_text, "%I:%M %p"
        ).time()
    except ValueError:
        return None

    tz = TIMEZONES.get(zone_text)

    if tz is None:
        offset_match = re.fullmatch(
            r"(?:GMT|UTC)([+-])(\d{2}):?(\d{2})",
            zone_text,
        )

        if offset_match:
            hours = int(offset_match.group(2))
            minutes = int(offset_match.group(3))

            offset = timedelta(
                hours=hours,
                minutes=minutes,
            )

            if offset_match.group(1) == "-":
                offset = -offset

            tz = timezone(offset)

        elif not zone_text:
            tz = AMSTERDAM

        else:
            return None

    meeting_time = datetime.combine(
        parsed_date,
        parsed_time,
        tzinfo=tz,
    )

    return meeting_time.astimezone(AMSTERDAM)


def get_header(headers, header_name):
    for header in headers:
        if header.get("name", "").lower() == header_name.lower():
            return header.get("value", "")

    return ""


def list_all_matching_messages(gmail):
    """Retrieve all matching Gmail message IDs, including later pages."""

    messages = []
    page_token = None

    while True:
        response = (
            gmail.users()
            .messages()
            .list(
                userId="me",
                q=GMAIL_QUERY,
                maxResults=500,
                pageToken=page_token,
            )
            .execute()
        )

        messages.extend(response.get("messages", []))
        page_token = response.get("nextPageToken")

        if not page_token:
            break

    return messages


def read_attendance_sheet(sheets, spreadsheet_id):
    """
    Read the Attendees worksheet.

    Returns counts only, not names or email addresses.
    The first row is treated as the header.
    """

    response = (
        sheets.spreadsheets()
        .values()
        .get(
            spreadsheetId=spreadsheet_id,
            range=ATTENDEE_RANGE,
            majorDimension="ROWS",
        )
        .execute()
    )

    rows = response.get("values", [])

    if not rows:
        return 0, 0

    attendee_rows = [
        row for row in rows[1:]
        if any(str(cell).strip() for cell in row)
    ]

    email_count = sum(
        1
        for row in attendee_rows
        if len(row) >= 3 and str(row[2]).strip()
    )

    return len(attendee_rows), email_count


def main():
    start_text = os.environ.get(
        "MEET_ATTENDANCE_START",
        DEFAULT_START,
    ).strip()

    try:
        cutoff = datetime.fromisoformat(start_text)

        if cutoff.tzinfo is None:
            cutoff = cutoff.replace(tzinfo=AMSTERDAM)
        else:
            cutoff = cutoff.astimezone(AMSTERDAM)

    except ValueError:
        print(
            "ERROR: MEET_ATTENDANCE_START must be an ISO datetime, "
            "for example 2025-09-01T00:00:00",
            file=sys.stderr,
        )
        return 2

    # These may be separate tokens, depending on how OAuth was configured.
    gmail_refresh = os.environ.get(
        "MASTERS_ATTENDANCE_REFRESH_TOKEN", ""
    ).strip()

    sheets_refresh = os.environ.get(
        "MASTERS_ATTENDANCE_REFRESH_TOKEN", ""
    ).strip()

    # Fall back to the other token if only one is configured.
    if not gmail_refresh:
        gmail_refresh = sheets_refresh

    if not sheets_refresh:
        sheets_refresh = gmail_refresh

    try:
        gmail_credentials = make_credentials(
            gmail_refresh,
            [GMAIL_SCOPE],
        )

        sheets_credentials = make_credentials(
            sheets_refresh,
            [SHEETS_SCOPE],
        )

        gmail = build(
            "gmail",
            "v1",
            credentials=gmail_credentials,
            cache_discovery=False,
        )

        sheets = build(
            "sheets",
            "v4",
            credentials=sheets_credentials,
            cache_discovery=False,
        )

        matching = list_all_matching_messages(gmail)

        print("=" * 64)
        print("Google Meet attendance email inspection (read-only)")
        print("=" * 64)
        print(f"Gmail messages found: {len(matching)}")
        print(f"Amsterdam cutoff: {cutoff.isoformat()}")

        eligible = 0
        skipped_before_cutoff = 0
        unparseable_time = 0
        missing_link = 0
        errors = 0

        unique_sheet_ids = set()
        sheet_results = {}
        failures = []

        for stub in matching:
            message_id = stub["id"]

            try:
                message = (
                    gmail.users()
                    .messages()
                    .get(
                        userId="me",
                        id=message_id,
                        format="full",
                    )
                    .execute()
                )

            except Exception as exc:
                errors += 1
                failures.append(
                    (message_id, "GMAIL_READ_ERROR", type(exc).__name__)
                )
                continue

            payload = message.get("payload", {})
            headers = payload.get("headers", [])

            subject = get_header(headers, "Subject") or "(no subject)"
            sender = get_header(headers, "From").lower()

            if "meetings-noreply@google.com" not in sender:
                continue

            meeting_dt = parse_meeting_datetime(subject)

            if meeting_dt is None:
                unparseable_time += 1
                failures.append(
                    (message_id, "UNPARSEABLE_MEETING_TIME", subject)
                )
                continue

            if meeting_dt < cutoff:
                skipped_before_cutoff += 1
                continue

            eligible += 1

            plain_body, html_body = collect_bodies(payload)

            spreadsheet_id = find_attendance_sheet_id(
                html_body,
                plain_body,
            )

            if not spreadsheet_id:
                missing_link += 1
                failures.append(
                    (message_id, "ATTENDANCE_LINK_NOT_FOUND", subject)
                )
                continue

            unique_sheet_ids.add(spreadsheet_id)

            # Read each unique spreadsheet only once.
            if spreadsheet_id not in sheet_results:
                try:
                    sheet_results[spreadsheet_id] = read_attendance_sheet(
                        sheets,
                        spreadsheet_id,
                    )
                except Exception as exc:
                    sheet_results[spreadsheet_id] = exc

            result = sheet_results[spreadsheet_id]

            if isinstance(result, Exception):
                errors += 1
                failures.append(
                    (
                        message_id,
                        "SHEETS_READ_ERROR",
                        f"{subject} ({type(result).__name__})",
                    )
                )

        successful_sheets = 0
        attendee_rows_total = 0
        attendee_email_total = 0

        for result in sheet_results.values():
            if isinstance(result, Exception):
                continue

            row_count, email_count = result

            successful_sheets += 1
            attendee_rows_total += row_count
            attendee_email_total += email_count

        print()
        print("SUMMARY")
        print("-" * 64)
        print(f"Eligible report emails: {eligible}")
        print(f"Skipped before Amsterdam cutoff: {skipped_before_cutoff}")
        print(f"Unparseable meeting times: {unparseable_time}")
        print(f"Attendance links not found: {missing_link}")
        print(f"Unique spreadsheet IDs found: {len(unique_sheet_ids)}")
        print(f"Successfully read spreadsheets: {successful_sheets}")
        print(f"Non-empty attendee rows: {attendee_rows_total}")
        print(f"Rows containing an email address: {attendee_email_total}")
        print(f"Errors: {errors}")

        if failures:
            print()
            print("ITEMS REQUIRING REVIEW")
            print("-" * 64)

            for message_id, reason, detail in failures:
                print(
                    f"Gmail ID: {message_id} | "
                    f"{reason} | {detail}"
                )

        print()
        print(
            "Read-only inspection finished. "
            "No Supabase or Canvas data was changed."
        )

        return 1 if failures else 0

    except HttpError as exc:
        print(f"Google API error: {exc}", file=sys.stderr)
        print(
            "Check the Google APIs, refresh-token scopes, "
            "and Google account permissions.",
            file=sys.stderr,
        )
        return 2

    except Exception as exc:
        print(
            f"ERROR: {type(exc).__name__}: {exc}",
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
