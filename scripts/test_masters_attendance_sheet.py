import os

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build


SPREADSHEET_ID = "1UPQRiE8S2egMo6r_5ghDmP7hsmVVSVemIhJEzQmMKyQ"
SHEET_NAME = "Attendees"

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
]


credentials = Credentials(
    token=None,
    refresh_token=os.environ["MASTERS_ATTENDANCE_REFRESH_TOKEN"],
    token_uri="https://oauth2.googleapis.com/token",
    client_id=os.environ["MASTERS_ATTENDANCE_GOOGLE_CLIENT_ID"],
    client_secret=os.environ["MASTERS_ATTENDANCE_GOOGLE_CLIENT_SECRET"],
    scopes=SCOPES,
)

sheets = build("sheets", "v4", credentials=credentials)


print("Testing Google Sheets access...")
print()

metadata = (
    sheets.spreadsheets()
    .get(
        spreadsheetId=SPREADSHEET_ID,
        fields="properties.title,sheets.properties",
    )
    .execute()
)

print("Spreadsheet title:")
print(metadata["properties"]["title"])
print()

print("Worksheets:")
for sheet in metadata["sheets"]:
    print("-", sheet["properties"]["title"])
print()

result = (
    sheets.spreadsheets()
    .values()
    .get(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{SHEET_NAME}!A1:F10",
    )
    .execute()
)

rows = result.get("values", [])

print("Attendance data:")
print()

for row in rows:
    print(row)

print()
print("SUCCESS: Google Sheets access is working.")
