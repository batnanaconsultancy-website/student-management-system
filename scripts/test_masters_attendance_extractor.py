
#!/usr/bin/env python3
"""
Test-only Masters attendance extractor.

Reads Google Meet attendance-report emails from Gmail, extracts the
"Meeting attendance" Google Sheet, and previews the Attendees worksheet.

IMPORTANT:
- Does not write to Supabase.
- Does not update Canvas attendance.
- Does not modify Gmail messages or spreadsheets.
"""

import base64
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from zoneinfo import ZoneInfo

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError


# ---------------------------------------------------------------------
# CONFIGURATION
# ---------------------------------------------------------------------

AMSTERDAM = ZoneInfo("Europe/Amsterdam")

# Include reports at or after 11 February 2026, 12:24 PM Amsterdam time.
START_DATETIME = datetime(
    2026, 2, 11, 12, 24, tzinfo=AMSTERDAM
)

GMAIL_QUERY = (
    'from:meetings-noreply@google.com '
    'subject:"Meeting records:" after:2026/02/09'
)

ATTENDANCE_RANGE = "Attendees!A1:F"

EXPECTED_HEADERS = [
    "First name",
    "Last name",
    "Email",
    "Duration",
    "Time joined",
    "Time exited",
]

# Delay between API calls to reduce the likelihood of rate limiting.
API_DELAY_SECONDS = 1.3

# Retry settings for temporary Google API rate limits.
MAX_RETRIES = 7

# Limit the number of sample rows printed to the terminal.
SAMPLE_ROWS = 3


# ---------------------------------------------------------------------
# TIMEZONE PARSING
# ---------------------------------------------------------------------

# Fixed offsets are intentional here: preserve the timezone explicitly
# stated in the email subject rather than silently replacing it with
# Amsterdam time.
TIMEZONE_OFFSETS = {
    "UTC": timedelta(hours=0),
    "GMT": timedelta(hours=0),
    "CET": timedelta(hours=1),
    "CEST": timedelta(hours=2),
    "EST": timedelta(hours=-5),
    "EDT": timedelta(hours=-4),
    "CST": timedelta(hours=-6),
    "CDT": timedelta(hours=-5),
    "MST": timedelta(hours=-7),
    "MDT": timedelta(hours=-6),
    "PST": timedelta(hours=-8),
    "PDT": timedelta(hours=-7),
}


def extract_meeting_datetime(subject):
    """
    Parse a subject such as:
      Meeting records: 7 Oct 2026 at 6:01 PM CEST
      Meeting records: 25 May 2026 at 2:36 PM GMT-03:00
      Meeting records: 31 Mar 2026 at 11:50 AM EST

    If no timezone is stated, Amsterdam local time is assumed.
    Returns a timezone-aware datetime, or None if parsing fails.
    """

    pattern = (
        r"Meeting records:\s*"
        r"(\d{1,2}\s+[A-Za-z]+\s+\d{4})"
        r"\s+at\s+"
        r"(\d{1,2}:\d{2}\s+[AP]M)"
        r"(?:\s+"
        r"(GMT[+-]\d{2}:\d{2}|[A-Z]{2,5})"
        r")?"
    )

    match = re.search(pattern, subject or "", re.IGNORECASE)

    if not match:
        return None

    date_text, time_text, zone_text = match.groups()

    # Python recognizes "Sep", but not all versions recognize "Sept".
    date_text = re.sub(
        r"\bSept\b", "Sep", date_text, flags=re.IGNORECASE
    )

    try:
        meeting_time = datetime.strptime(
            f"{date_text} {time_text}",
            "%d %b %Y %I:%M %p",
        )
    except ValueError:
        return None

    if not zone_text:
        return meeting_time.replace(tzinfo=AMSTERDAM)

    zone_text = zone_text.upper()

    # Parse explicit offsets such as GMT-03:00 and GMT+05:30.
    if zone_text.startswith("GMT") and zone_text != "GMT":
        offset_match = re.fullmatch(
            r"GMT([+-])(\d{2}):(\d{2})",
            zone_text,
        )

        if not offset_match:
            return None

        sign, hours_text, minutes_text = offset_match.groups()
        hours = int(hours_text)
        minutes = int(minutes_text)

        if hours > 23 or minutes > 59:
            return None

        offset = timedelta(hours=hours, minutes=minutes)

        if sign == "-":
            offset = -offset

    else:
        offset = TIMEZONE_OFFSETS.get(zone_text)

    if offset is None:
        return None

    return meeting_time.replace(tzinfo=timezone(offset))


# ---------------------------------------------------------------------
# GOOGLE API RETRIES
# ---------------------------------------------------------------------

def execute_with_retry(request, description="Google API request"):
    """
    Execute a Google API request with retries for rate-limit and
    temporary server errors.
    """

    for attempt in range(MAX_RETRIES):
        try:
            result = request.execute()

            # Small pause after successful requests as well.
            time.sleep(API_DELAY_SECONDS)
            return result

        except HttpError as exc:
            status = getattr(exc.resp, "status", None)
            content = str(exc).lower()

            retryable = (
                status in (429, 500, 502, 503, 504)
                or "ratelimitexceeded" in content
                or "userratelimitexceeded" in content
                or "rate limit" in content
                or "quota exceeded" in content
            )

            if not retryable or attempt == MAX_RETRIES - 1:
                raise

            delay = min(2 ** (attempt + 1), 60)

            print(
                f"  API limit/temporary error during {description}. "
                f"Retry {attempt + 1}/{MAX_RETRIES - 1} "
                f"in {delay} seconds."
            )

            time.sleep(delay)

    raise RuntimeError(f"Retries exhausted: {description}")


# ---------------------------------------------------------------------
# GOOGLE AUTHENTICATION
# ---------------------------------------------------------------------

def create_google_services():
    """
    Authenticate using OAuth credentials stored in environment variables.

    Required environment variables:
      MASTERS_ATTENDANCE_GOOGLE_CLIENT_ID
      MASTERS_ATTENDANCE_GOOGLE_CLIENT_SECRET
      MASTERS_ATTENDANCE_REFRESH_TOKEN

    These values must never be printed or committed to Git.
    """

    client_id = os.environ.get("MASTERS_ATTENDANCE_GOOGLE_CLIENT_ID")
    client_secret = os.environ.get("MASTERS_ATTENDANCE_GOOGLE_CLIENT_SECRET")
    refresh_token = os.environ.get("MASTERS_ATTENDANCE_REFRESH_TOKEN")

    missing = [
        name
        for name, value in [
            ("MASTERS_ATTENDANCE_GOOGLE_CLIENT_ID", client_id),
            ("MASTERS_ATTENDANCE_GOOGLE_CLIENT_SECRET", client_secret),
            ("MASTERS_ATTENDANCE_REFRESH_TOKEN", refresh_token),
        ]
        if not value
    ]

    if missing:
        raise RuntimeError(
            "Missing required environment variable(s): "
            + ", ".join(missing)
            + ". Set them in your terminal before running the script."
        )

    credentials = Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=client_id,
        client_secret=client_secret,
        scopes=[
            "https://www.googleapis.com/auth/gmail.readonly",
            "https://www.googleapis.com/auth/spreadsheets.readonly",
        ],
    )

    credentials.refresh(Request())

    gmail_service = build(
        "gmail",
        "v1",
        credentials=credentials,
        cache_discovery=False,
    )

    sheets_service = build(
        "sheets",
        "v4",
        credentials=credentials,
        cache_discovery=False,
    )

    return gmail_service, sheets_service


# ---------------------------------------------------------------------
# GMAIL MESSAGE DECODING
# ---------------------------------------------------------------------

def decode_message_data(data):
    """Decode Gmail's URL-safe Base64 message content."""

    if not data:
        return ""

    try:
        decoded = base64.urlsafe_b64decode(
            data + "=" * (-len(data) % 4)
        )
        return decoded.decode("utf-8", errors="replace")
    except Exception:
        return ""


def get_message_bodies(payload):
    """
    Recursively extract text/plain and text/html bodies from a Gmail
    message payload.
    """

    bodies = {"text/plain": [], "text/html": []}

    def walk(part):
        mime_type = part.get("mimeType", "")
        body_data = part.get("body", {}).get("data")

        if mime_type in bodies and body_data:
            bodies[mime_type].append(
                decode_message_data(body_data)
            )

        for child in part.get("parts", []):
            walk(child)

    walk(payload or {})
    return bodies


# ---------------------------------------------------------------------
# ATTENDANCE LINK EXTRACTION
# ---------------------------------------------------------------------

class AnchorParser(HTMLParser):
    """Collect HTML links and their visible anchor text."""

    def __init__(self):
        super().__init__()
        self.links = []
        self.current_href = None
        self.current_text = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "a":
            attrs_dict = dict(attrs)
            self.current_href = attrs_dict.get("href")
            self.current_text = []

    def handle_data(self, data):
        if self.current_href is not None:
            self.current_text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self.current_href is not None:
            self.links.append(
                (
                    " ".join(self.current_text).strip(),
                    self.current_href.strip(),
                )
            )
            self.current_href = None
            self.current_text = []


def extract_spreadsheet_id(url):
    """Extract a Google Sheets file ID from a standard Sheets URL."""

    if not url:
        return None

    match = re.search(
        r"docs\.google\.com/spreadsheets/d/([A-Za-z0-9_-]+)",
        url,
    )

    return match.group(1) if match else None


def find_attendance_sheet_id(bodies):
    """
    Prefer the URL attached to an anchor labelled 'Meeting attendance'.
    Do not select a transcript or recording link just because it appears
    in the same email.
    """

    html_text = "\n".join(bodies.get("text/html", []))
    plain_text = "\n".join(bodies.get("text/plain", []))

    if html_text:
        parser = AnchorParser()

        try:
            parser.feed(html_text)
        except Exception:
            pass

        # First pass: exact/near-exact attendance link label.
        for label, href in parser.links:
            normalized_label = re.sub(
                r"\s+", " ", label.lower()
            ).strip()

            if (
                "meeting attendance" in normalized_label
                or normalized_label == "attendance"
            ):
                sheet_id = extract_spreadsheet_id(href)
                if sheet_id:
                    return sheet_id

        # Second pass: spreadsheet links whose labels mention attendance.
        for label, href in parser.links:
            if "attendance" in label.lower():
                sheet_id = extract_spreadsheet_id(href)
                if sheet_id:
                    return sheet_id

    # Fallback for plain-text emails: only accept a spreadsheet URL
    # when the surrounding text mentions attendance.
    for match in re.finditer(
        r"https?://docs\.google\.com/spreadsheets/d/"
        r"[A-Za-z0-9_-]+[^\s<>\"']*",
        plain_text,
        re.IGNORECASE,
    ):
        url = match.group(0).rstrip(").,;")

        start = max(0, match.start() - 250)
        end = min(len(plain_text), match.end() + 250)
        surrounding_text = plain_text[start:end].lower()

        if "attendance" in surrounding_text:
            sheet_id = extract_spreadsheet_id(url)
            if sheet_id:
                return sheet_id

    # Do not guess a sheet if we cannot identify the attendance link.
    return None


# ---------------------------------------------------------------------
# GMAIL SEARCH WITH PAGINATION
# ---------------------------------------------------------------------

def list_all_matching_messages(gmail_service):
    """Retrieve every message ID matching the Gmail query."""

    message_ids = []
    page_token = None

    print("\nSearching Gmail for attendance-report emails...")
    print(f"Gmail query: {GMAIL_QUERY}")

    while True:
        request = gmail_service.users().messages().list(
            userId="me",
            q=GMAIL_QUERY,
            maxResults=100,
            pageToken=page_token,
        )

        response = execute_with_retry(
            request,
            description="listing Gmail messages",
        )

        for message in response.get("messages", []):
            message_ids.append(message["id"])

        page_token = response.get("nextPageToken")

        if not page_token:
            break

    # A Gmail message should only be processed once.
    message_ids = list(dict.fromkeys(message_ids))

    print(f"Matching Gmail messages found: {len(message_ids)}")

    return message_ids


def get_message(gmail_service, message_id):
    """Fetch one Gmail message, retrying if quota is temporarily exceeded."""

    request = gmail_service.users().messages().get(
        userId="me",
        id=message_id,
        format="full",
    )

    return execute_with_retry(
        request,
        description=f"fetching Gmail message {message_id}",
    )


# ---------------------------------------------------------------------
# SPREADSHEET READING
# ---------------------------------------------------------------------

def read_attendance_sheet(sheets_service, spreadsheet_id):
    """
    Read the Attendees worksheet.

    The metadata request retrieves the spreadsheet title, and the values
    request retrieves the six expected attendance columns.
    """

    metadata = execute_with_retry(
        sheets_service.spreadsheets().get(
            spreadsheetId=spreadsheet_id,
            fields="properties(title)",
        ),
        description=f"reading spreadsheet metadata {spreadsheet_id}",
    )

    title = metadata.get("properties", {}).get(
        "title", "(title unavailable)"
    )

    result = execute_with_retry(
        sheets_service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=ATTENDANCE_RANGE,
        ),
        description=f"reading attendance sheet {spreadsheet_id}",
    )

    values = result.get("values", [])

    if not values:
        return title, [], [], "EMPTY"

    headers = [
        str(value).strip()
        for value in values[0]
    ]

    rows = values[1:]

    normalized_headers = [
        header.casefold() for header in headers
    ]

    expected_normalized = [
        header.casefold() for header in EXPECTED_HEADERS
    ]

    if normalized_headers[:6] != expected_normalized:
        return title, headers, rows, "UNEXPECTED_HEADERS"

    return title, headers, rows, "OK"


# ---------------------------------------------------------------------
# MAIN EXTRACTION
# ---------------------------------------------------------------------

def main():
    print("=" * 72)
    print("MASTERS ATTENDANCE EXTRACTOR — TEST / PREVIEW ONLY")
    print("=" * 72)

    print(
        "Eligibility cutoff (Amsterdam): "
        f"{START_DATETIME.isoformat()}"
    )
    print(
        "Eligibility cutoff (UTC): "
        f"{START_DATETIME.astimezone(timezone.utc).isoformat()}"
    )

    gmail_service, sheets_service = create_google_services()

    message_ids = list_all_matching_messages(gmail_service)

    eligible_count = 0
    skipped_count = 0
    unparseable_count = 0
    missing_link_count = 0
    sheet_error_count = 0
    successful_sheet_count = 0

    seen_sheet_ids = set()
    eligible_reports = []
    failures = []

    print("\nProcessing meeting-record emails...\n")

    for index, message_id in enumerate(message_ids, start=1):
        print("-" * 72)
        print(f"Email {index}/{len(message_ids)} | Gmail ID: {message_id}")

        try:
            message = get_message(gmail_service, message_id)
        except Exception as exc:
            sheet_error_count += 1
            failures.append(
                (message_id, "GMAIL_READ_ERROR", str(exc))
            )
            print(f"ERROR: Could not read Gmail message: {exc}")
            continue

        payload = message.get("payload", {})
        headers = payload.get("headers", [])

        header_map = {
            item.get("name", "").lower(): item.get("value", "")
            for item in headers
        }

        subject = header_map.get("subject", "(no subject)")
        date_header = header_map.get("date", "")

        print(f"Subject: {subject}")

        meeting_datetime = extract_meeting_datetime(subject)

        if meeting_datetime is None:
            unparseable_count += 1
            failures.append(
                (
                    message_id,
                    "UNPARSEABLE_SUBJECT_TIME",
                    subject,
                )
            )
            print("Status: REVIEW — could not parse meeting date/time.")
            continue

        amsterdam_time = meeting_datetime.astimezone(AMSTERDAM)

        print(f"Meeting time as stated: {meeting_datetime.isoformat()}")
        print(f"Meeting time in Amsterdam: {amsterdam_time.isoformat()}")

        if meeting_datetime < START_DATETIME:
            skipped_count += 1
            print("Status: SKIPPED — before the Amsterdam cutoff.")
            continue

        bodies = get_message_bodies(payload)
        spreadsheet_id = find_attendance_sheet_id(bodies)

        if not spreadsheet_id:
            missing_link_count += 1
            failures.append(
                (message_id, "ATTENDANCE_LINK_NOT_FOUND", subject)
            )
            print(
                "Status: REVIEW — could not confidently identify "
                "the Meeting attendance spreadsheet link."
            )
            continue

        print(f"Attendance Sheet ID: {spreadsheet_id}")

        report = {
            "gmail_message_id": message_id,
            "subject": subject,
            "email_date": date_header,
            "meeting_datetime": meeting_datetime.isoformat(),
            "meeting_datetime_amsterdam": amsterdam_time.isoformat(),
            "spreadsheet_id": spreadsheet_id,
        }

        # Record eligibility even when multiple emails point to the
        # same sheet, but read each spreadsheet only once.
        eligible_count += 1
        eligible_reports.append(report)

        if spreadsheet_id in seen_sheet_ids:
            print("Status: ELIGIBLE — spreadsheet already inspected.")
            continue

        seen_sheet_ids.add(spreadsheet_id)

        try:
            title, sheet_headers, rows, sheet_status = (
                read_attendance_sheet(
                    sheets_service,
                    spreadsheet_id,
                )
            )

            print(f"Spreadsheet title: {title}")
            print(f"Worksheet range: {ATTENDANCE_RANGE}")
            print(f"Status: {sheet_status}")

            if sheet_status == "OK":
                successful_sheet_count += 1
                print(f"Attendance rows (excluding header): {len(rows)}")
                print(f"Headers: {sheet_headers}")

                if rows:
                    print(
                        f"Sample rows (maximum {SAMPLE_ROWS}; "
                        "review only, not imported):"
                    )

                    for row in rows[:SAMPLE_ROWS]:
                        # Pad rows to six columns for easier inspection.
                        padded_row = list(row[:6])
                        padded_row.extend(
                            [""] * (6 - len(padded_row))
                        )
                        print("  " + repr(padded_row))

            else:
                sheet_error_count += 1
                failures.append(
                    (
                        spreadsheet_id,
                        sheet_status,
                        f"Title: {title}; headers: {sheet_headers}",
                    )
                )

                if sheet_status == "UNEXPECTED_HEADERS":
                    print(
                        "WARNING: The worksheet headers do not match "
                        "the expected six columns."
                    )
                elif sheet_status == "EMPTY":
                    print("WARNING: The worksheet returned no values.")

        except Exception as exc:
            sheet_error_count += 1
            failures.append(
                (spreadsheet_id, "SHEETS_READ_ERROR", str(exc))
            )
            print(f"ERROR: Could not read spreadsheet: {exc}")

    # -----------------------------------------------------------------
    # FINAL SUMMARY
    # -----------------------------------------------------------------

    print("\n")
    print("=" * 72)
    print("EXTRACTION SUMMARY")
    print("=" * 72)
    print(f"Gmail messages found: {len(message_ids)}")
    print(f"Eligible report emails: {eligible_count}")
    print(f"Unique eligible spreadsheet IDs: {len(seen_sheet_ids)}")
    print(f"Successfully read attendance sheets: {successful_sheet_count}")
    print(f"Skipped before cutoff: {skipped_count}")
    print(f"Unparseable meeting times: {unparseable_count}")
    print(f"Attendance links not found: {missing_link_count}")
    print(f"Spreadsheet/Gmail errors or invalid sheets: {sheet_error_count}")

    target_id = "18CexfJyYtfc2CrIo4TPTd1ga8wjKHsUMlk3PCPXMHZY"
    target_found = target_id in seen_sheet_ids

    print("\nHistorical cutoff report check:")
    print(f"Required report sheet ID: {target_id}")
    print(f"Found and inspected: {'YES' if target_found else 'NO'}")

    if not target_found:
        matching_subjects = [
            report["subject"]
            for report in eligible_reports
            if "11 Feb 2026" in report["subject"]
        ]

        if matching_subjects:
            print("Eligible 11 Feb 2026 subjects found:")
            for subject in matching_subjects:
                print(f"  - {subject}")
        else:
            print(
                "No eligible 11 Feb 2026 report was identified. "
                "Check the Gmail search, subject format, and attendance link."
            )

    if failures:
        print("\nItems requiring review:")
        for item_id, reason, detail in failures:
            print(f"- ID: {item_id} | {reason} | {detail}")

    print("\nPREVIEW ONLY: No Supabase or Canvas data was changed.")
    print("=" * 72)

    # Exit non-zero if some reports could not be processed so the
    # result cannot be mistaken for a fully clean run.
    if failures:
        return 1

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nStopped by user. No data was imported.")
        sys.exit(130)
    except Exception as exc:
        print(f"\nFATAL ERROR: {exc}")
        sys.exit(1)



# import os
# import re
# import base64
# import time
# from datetime import datetime
# from email.utils import parsedate_to_datetime
# from zoneinfo import ZoneInfo

# from google.oauth2.credentials import Credentials
# from googleapiclient.discovery import build


# SCOPES = [
#     "https://www.googleapis.com/auth/gmail.readonly",
#     "https://www.googleapis.com/auth/spreadsheets.readonly",
# ]

# START_DATETIME = datetime(
#     2026, 2, 11, 12, 24,
#     tzinfo=ZoneInfo("Europe/Amsterdam"),
# )

# GMAIL_QUERY = (
#     'from:meetings-noreply@google.com '
#     'subject:"Meeting records:" '
#     'after:2026/02/10'
# )


# def get_credentials():
#     return Credentials(
#         token=None,
#         refresh_token=os.environ["MASTERS_ATTENDANCE_REFRESH_TOKEN"],
#         token_uri="https://oauth2.googleapis.com/token",
#         client_id=os.environ["MASTERS_ATTENDANCE_GOOGLE_CLIENT_ID"],
#         client_secret=os.environ["MASTERS_ATTENDANCE_GOOGLE_CLIENT_SECRET"],
#         scopes=SCOPES,
#     )


# def decode_body(data):
#     if not data:
#         return ""

#     try:
#         return base64.urlsafe_b64decode(
#             data + "=" * (-len(data) % 4)
#         ).decode("utf-8", errors="replace")
#     except Exception:
#         return ""


# def collect_message_text(payload):
#     """
#     Recursively collect text/plain and text/html content
#     from a Gmail MIME message.
#     """
#     parts = []

#     mime_type = payload.get("mimeType", "")
#     body = payload.get("body", {})
#     data = body.get("data")

#     if data and mime_type in ("text/plain", "text/html"):
#         parts.append(decode_body(data))

#     for part in payload.get("parts", []):
#         parts.extend(collect_message_text(part))

#     return parts


# def extract_meeting_attendance_url(text):
#     """
#     Find the Google Sheets URL associated with
#     the 'Meeting attendance' artifact.
#     """

#     urls = re.findall(
#         r'https?://docs\.google\.com/spreadsheets/d/[^"\'<>\s]+',
#         text,
#         flags=re.IGNORECASE,
#     )

#     if not urls:
#         return None

#     # First try to find the URL close to "Meeting attendance".
#     for match in re.finditer(
#         r"Meeting\s+attendance",
#         text,
#         flags=re.IGNORECASE,
#     ):
#         start = max(0, match.start() - 1000)
#         end = min(len(text), match.end() + 5000)

#         nearby = text[start:end]

#         nearby_urls = re.findall(
#             r'https?://docs\.google\.com/spreadsheets/d/[^"\'<>\s]+',
#             nearby,
#             flags=re.IGNORECASE,
#         )

#         if nearby_urls:
#             return nearby_urls[0]

#     return None


# def extract_spreadsheet_id(url):
#     match = re.search(
#         r"/spreadsheets/d/([a-zA-Z0-9_-]+)",
#         url,
#     )

#     if not match:
#         return None

#     return match.group(1)


# def extract_meeting_datetime(subject):
#     """
#     Example:
#     Meeting records: 7 Oct 2026 at 6:01 PM CEST
#     """

#     match = re.search(
#         r"Meeting records:\s*"
#         r"(\d{1,2}\s+\w+\s+\d{4})"
#         r"\s+at\s+"
#         r"(\d{1,2}:\d{2}\s+[AP]M)",
#         subject,
#         flags=re.IGNORECASE,
#     )

#     if not match:
#         return None

#     date_part = match.group(1)
#     time_part = match.group(2)

#     date_part = re.sub(
#         r"\bSept\b",
#         "Sep",
#         date_part,
#         flags=re.IGNORECASE,
#     )

#     naive = datetime.strptime(
#         f"{date_part} {time_part}",
#         "%d %b %Y %I:%M %p",
#     )

#     return naive.replace(
#         tzinfo=ZoneInfo("Europe/Amsterdam")
#     )


# def get_header(headers, name):
#     for header in headers:
#         if header.get("name", "").lower() == name.lower():
#             return header.get("value", "")

#     return ""


# def main():
#     credentials = get_credentials()

#     gmail = build(
#         "gmail",
#         "v1",
#         credentials=credentials,
#     )

#     sheets = build(
#         "sheets",
#         "v4",
#         credentials=credentials,
#     )

#     print("Searching Gmail...")
#     print()
#     print("Query:")
#     print(GMAIL_QUERY)
#     print()

#     response = (
#         gmail.users()
#         .messages()
#         .list(
#             userId="me",
#             q=GMAIL_QUERY,
#             maxResults=500,
#         )
#         .execute()
#     )

#     messages = response.get("messages", [])

#     print(f"Meeting record emails found: {len(messages)}")
#     print()

#     eligible = []

#     for item in messages:
#         message = (
#             gmail.users()
#             .messages()
#             .get(
#                 userId="me",
#                 id=item["id"],
#                 format="full",
#             )
#             .execute()
#         )

#         # Avoid exceeding Gmail API per-minute quota.
#         time.sleep(1.2)
#         payload = message.get("payload", {})
#         headers = payload.get("headers", [])

#         subject = get_header(headers, "Subject")
#         date_header = get_header(headers, "Date")

#         meeting_datetime = extract_meeting_datetime(subject)

#         if not meeting_datetime:
#             print(f"SKIP - could not parse subject:")
#             print(f"  {subject}")
#             print()
#             continue

#         print(f"Found: {subject}")
#         print(f"Meeting time: {meeting_datetime.isoformat()}")

#         if meeting_datetime < START_DATETIME:
#             print("Status: BEFORE START DATE - ignored")
#             print()
#             continue

#         body_parts = collect_message_text(payload)
#         combined_text = "\n".join(body_parts)

#         url = extract_meeting_attendance_url(combined_text)

#         if not url:
#             print("Status: NO MEETING ATTENDANCE SHEET FOUND")
#             print()
#             continue

#         spreadsheet_id = extract_spreadsheet_id(url)

#         if not spreadsheet_id:
#             print("Status: COULD NOT EXTRACT SPREADSHEET ID")
#             print()
#             continue

#         print(f"Attendance Sheet ID: {spreadsheet_id}")

#         eligible.append(
#             {
#                 "message_id": item["id"],
#                 "subject": subject,
#                 "date_header": date_header,
#                 "meeting_datetime": meeting_datetime,
#                 "spreadsheet_id": spreadsheet_id,
#                 "url": url,
#             }
#         )

#         print("Status: ELIGIBLE")
#         print()

#     print("=" * 70)
#     print(f"Eligible attendance reports: {len(eligible)}")
#     print("=" * 70)
#     print()

#     for report in eligible:
#         print(report["subject"])
#         print(f"Meeting: {report['meeting_datetime']}")
#         print(f"Sheet ID: {report['spreadsheet_id']}")
#         print()

#         spreadsheet = (
#             sheets.spreadsheets()
#             .get(
#                 spreadsheetId=report["spreadsheet_id"],
#                 fields="properties.title,sheets.properties",
#             )
#             .execute()
#         )

#         title = spreadsheet["properties"]["title"]

#         print(f"Spreadsheet title: {title}")

#         attendees_sheet = None

#         for sheet in spreadsheet.get("sheets", []):
#             sheet_title = sheet["properties"]["title"]

#             if sheet_title.lower() == "attendees":
#                 attendees_sheet = sheet_title
#                 break

#         if not attendees_sheet:
#             print("ERROR: Attendees worksheet not found.")
#             print()
#             continue

#         result = (
#             sheets.spreadsheets()
#             .values()
#             .get(
#                 spreadsheetId=report["spreadsheet_id"],
#                 range=f"{attendees_sheet}!A1:F",
#             )
#             .execute()
#         )

#         rows = result.get("values", [])

#         print(f"Rows returned: {len(rows)}")

#         if rows:
#             print("Headers:")
#             print(rows[0])

#             print()
#             print("First 5 attendance rows:")

#             for row in rows[1:6]:
#                 print(row)

#         print()
#         print("-" * 70)
#         print()


# if __name__ == "__main__":
#     main()
