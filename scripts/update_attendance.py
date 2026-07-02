"""
Update Attendance Script
Syncs attendance data from Google Sheets form responses to Supabase

Google Sheet format:
- Column A: Email address (amsterdam.tech email)
- Column B: Session date (DD/MM/YYYY)
- Column C: Session type (Workshop, Mentoring, Standup)

Run with: python update_attendance.py
"""

import os
import gspread
from google.oauth2.service_account import Credentials
from collections import defaultdict
from utils import get_supabase_client, print_step

# Google Sheets configuration
SPREADSHEET_ID = '1LQum-XZSTaun1cJ7AHxjS63JLGzMPFpCWEAES6gNZTg'
SHEET_GID = 334409729

# Map form responses to database field names
SESSION_TYPE_MAP = {
    'workshop': 'workshops_attended',
    'workshops': 'workshops_attended',
    'mentoring': 'mentoring_attended',
    'standup': 'standup_attended',
    'stand-up': 'standup_attended',
    'stand up': 'standup_attended',
}

# Known typos/variants in Google Form email responses that don't match
# students.email exactly. Keys must be lowercase (matched after .lower()).
# Add new entries here as new typos surface in "emails not found" warnings
# instead of guessing corrections inline elsewhere.
EMAIL_CORRECTIONS = {
    'nikolay.kirilov@amsterdam.tec': 'nikolay.kirilov@elu.nl',
    'nikolay.kirilov@amsterdam.tech': 'nikolay.kirilov@elu.nl',
    'dovydas.montvilas@amsterdam.tech': 'dovydas.montvillas@amsterdam.tech',
    'hala.kheel@amsterdam.tech': 'hala.kaheel@amsterdam.tech',
    'anna.kashkina@amsterdam.tech': 'anna.kashkina@elu.nl',
    # jonathan.andabati@gmail.com / @amsterdam.tech intentionally NOT mapped:
    # no matching student found in the roster at all. Flagged in not_found
    # instead of guessed, until confirmed whether he's a real student.
}


def get_google_sheets_client():
    """Initialize Google Sheets client using service account credentials"""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.join(script_dir, '..')

    # Check for various credential file names
    possible_names = [
        'google-credentials.json',
        'credentials.json',
        'final-project-466907-a02e2f17bd8b.json',  # Your specific credentials file
    ]

    creds_path = None
    for name in possible_names:
        path = os.path.join(project_root, name)
        if os.path.exists(path):
            creds_path = path
            break

    # Try environment variable as fallback
    if not creds_path:
        creds_path = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')

    if not creds_path or not os.path.exists(creds_path):
        raise FileNotFoundError(
            "Google credentials file not found. Please place 'google-credentials.json' in the project root "
            "or set GOOGLE_APPLICATION_CREDENTIALS environment variable."
        )

    print(f"Using credentials file: {os.path.basename(creds_path)}")

    scopes = [
        'https://www.googleapis.com/auth/spreadsheets.readonly',
        'https://www.googleapis.com/auth/drive.readonly'
    ]

    credentials = Credentials.from_service_account_file(creds_path, scopes=scopes)
    return gspread.authorize(credentials)


def fetch_attendance_responses(gc):
    """Fetch all attendance form responses from Google Sheets"""
    print_step("FETCHING DATA", "Reading attendance form responses from Google Sheets")

    spreadsheet = gc.open_by_key(SPREADSHEET_ID)

    # Find the worksheet by GID
    worksheet = None
    for ws in spreadsheet.worksheets():
        if ws.id == SHEET_GID:
            worksheet = ws
            break

    if not worksheet:
        # Fall back to first worksheet
        worksheet = spreadsheet.sheet1
        print(f"Warning: Could not find worksheet with GID {SHEET_GID}, using first sheet")

    # Get all records (assumes first row is headers)
    records = worksheet.get_all_records()

    print(f"Found {len(records)} form responses")
    return records


def parse_session_type(session_str):
    """Parse session type string to database field name"""
    if not session_str:
        return None

    session_lower = session_str.lower().strip()

    for key, field in SESSION_TYPE_MAP.items():
        if key in session_lower:
            return field

    print(f"Warning: Unknown session type '{session_str}'")
    return None


def normalize_email(email):
    """
    Lowercase/strip an email and apply known typo corrections so that
    variant spellings of the same student's email merge into a single
    record instead of being silently dropped or double-counted.
    """
    email = (email or '').strip().lower()
    if not email:
        return email
    return EMAIL_CORRECTIONS.get(email, email)


def aggregate_attendance(records):
    """
    Aggregate attendance counts per student email
    Returns: dict of {email: {field_name: count}}
    """
    print_step("PROCESSING", "Aggregating attendance counts per student")

    # Structure: {email: {workshops_attended: count, standup_attended: count, mentoring_attended: count}}
    attendance = defaultdict(lambda: defaultdict(int))

    skipped = 0
    processed = 0
    corrected = 0

    for record in records:
        # Handle different possible column names from Google Forms
        raw_email = (
            record.get('Please enter your Amsterdam Tech email address') or
            record.get('Email Address') or
            record.get('email') or
            record.get('Email') or
            ''
        ).strip().lower()

        email = normalize_email(raw_email)
        if email and email != raw_email:
            corrected += 1

        session_type_str = (
            record.get('Which session is this form for?') or
            record.get('Session Type') or
            record.get('session_type') or
            ''
        )

        if not email:
            skipped += 1
            continue

        field_name = parse_session_type(session_type_str)
        if not field_name:
            skipped += 1
            continue

        attendance[email][field_name] += 1
        processed += 1

    print(f"Processed {processed} valid responses, skipped {skipped}")
    if corrected:
        print(f"Applied known email corrections to {corrected} response(s)")
    print(f"Found attendance data for {len(attendance)} unique students")

    return attendance


def update_student_attendance(supabase, attendance_data):
    """Update student attendance fields in Supabase"""
    print_step("UPDATING DATABASE", "Syncing attendance counts to Supabase")

    # Fetch all students to map email -> id
    response = supabase.from_('students').select('id, email, workshops_attended, standup_attended, mentoring_attended').execute()
    students = {s['email'].lower(): s for s in response.data if s.get('email')}

    updated = 0
    not_found = []

    for email, counts in attendance_data.items():
        student = students.get(email)

        if not student:
            not_found.append(email)
            continue

        # Build update payload with new counts from the sheet
        # This REPLACES the current values with counts from the form
        update_data = {}

        if 'workshops_attended' in counts:
            update_data['workshops_attended'] = counts['workshops_attended']

        if 'standup_attended' in counts:
            update_data['standup_attended'] = counts['standup_attended']

        if 'mentoring_attended' in counts:
            update_data['mentoring_attended'] = counts['mentoring_attended']

        if update_data:
            try:
                supabase.from_('students').update(update_data).eq('id', student['id']).execute()
                updated += 1
                print(f"  Updated {email}: {update_data}")
            except Exception as e:
                print(f"  Error updating {email}: {e}")

    print(f"\nUpdated {updated} students")

    if not_found:
        print(f"\nWarning: {len(not_found)} emails not found in students table:")
        for email in not_found[:10]:  # Show first 10
            print(f"  - {email}")
        if len(not_found) > 10:
            print(f"  ... and {len(not_found) - 10} more")

    return updated


def main():
    """Main function to sync attendance from Google Sheets to Supabase"""
    print_step("ATTENDANCE SYNC", "Starting attendance synchronization from Google Sheets")

    try:
        # Initialize clients
        gc = get_google_sheets_client()
        supabase = get_supabase_client(service_role=True)

        # Fetch form responses
        records = fetch_attendance_responses(gc)

        if not records:
            print("No attendance records found in the spreadsheet")
            return

        # Aggregate by student
        attendance_data = aggregate_attendance(records)

        if not attendance_data:
            print("No valid attendance data to process")
            return

        # Update database
        updated = update_student_attendance(supabase, attendance_data)

        print_step("COMPLETE", f"Successfully updated attendance for {updated} students")

    except FileNotFoundError as e:
        print(f"\n❌ Configuration Error: {e}")
        print("\nTo set up Google Sheets access:")
        print("1. Create a service account in Google Cloud Console")
        print("2. Download the JSON credentials file")
        print("3. Save it as 'google-credentials.json' in the project root")
        print("4. Share the Google Sheet with the service account email")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        raise


if __name__ == "__main__":
    main()




# """
# Update Attendance Script
# Syncs attendance data from Google Sheets form responses to Supabase

# Google Sheet format:
# - Column A: Email address (amsterdam.tech email)
# - Column B: Session date (DD/MM/YYYY)
# - Column C: Session type (Workshop, Mentoring, Standup)

# Run with: python update_attendance.py
# """

# import os
# import gspread
# from google.oauth2.service_account import Credentials
# from collections import defaultdict
# from utils import get_supabase_client, print_step

# # Google Sheets configuration
# SPREADSHEET_ID = '1LQum-XZSTaun1cJ7AHxjS63JLGzMPFpCWEAES6gNZTg'
# SHEET_GID = 334409729

# # Map form responses to database field names
# SESSION_TYPE_MAP = {
#     'workshop': 'workshops_attended',
#     'workshops': 'workshops_attended',
#     'mentoring': 'mentoring_attended',
#     'standup': 'standup_attended',
#     'stand-up': 'standup_attended',
#     'stand up': 'standup_attended',
# }


# def get_google_sheets_client():
#     """Initialize Google Sheets client using service account credentials"""
#     script_dir = os.path.dirname(os.path.abspath(__file__))
#     project_root = os.path.join(script_dir, '..')

#     # Check for various credential file names
#     possible_names = [
#         'google-credentials.json',
#         'credentials.json',
#         'final-project-466907-a02e2f17bd8b.json',  # Your specific credentials file
#     ]

#     creds_path = None
#     for name in possible_names:
#         path = os.path.join(project_root, name)
#         if os.path.exists(path):
#             creds_path = path
#             break

#     # Try environment variable as fallback
#     if not creds_path:
#         creds_path = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')

#     if not creds_path or not os.path.exists(creds_path):
#         raise FileNotFoundError(
#             "Google credentials file not found. Please place 'google-credentials.json' in the project root "
#             "or set GOOGLE_APPLICATION_CREDENTIALS environment variable."
#         )

#     print(f"Using credentials file: {os.path.basename(creds_path)}")

#     scopes = [
#         'https://www.googleapis.com/auth/spreadsheets.readonly',
#         'https://www.googleapis.com/auth/drive.readonly'
#     ]

#     credentials = Credentials.from_service_account_file(creds_path, scopes=scopes)
#     return gspread.authorize(credentials)


# def fetch_attendance_responses(gc):
#     """Fetch all attendance form responses from Google Sheets"""
#     print_step("FETCHING DATA", "Reading attendance form responses from Google Sheets")

#     spreadsheet = gc.open_by_key(SPREADSHEET_ID)

#     # Find the worksheet by GID
#     worksheet = None
#     for ws in spreadsheet.worksheets():
#         if ws.id == SHEET_GID:
#             worksheet = ws
#             break

#     if not worksheet:
#         # Fall back to first worksheet
#         worksheet = spreadsheet.sheet1
#         print(f"Warning: Could not find worksheet with GID {SHEET_GID}, using first sheet")

#     # Get all records (assumes first row is headers)
#     records = worksheet.get_all_records()

#     print(f"Found {len(records)} form responses")
#     return records


# def parse_session_type(session_str):
#     """Parse session type string to database field name"""
#     if not session_str:
#         return None

#     session_lower = session_str.lower().strip()

#     for key, field in SESSION_TYPE_MAP.items():
#         if key in session_lower:
#             return field

#     print(f"Warning: Unknown session type '{session_str}'")
#     return None


# def aggregate_attendance(records):
#     """
#     Aggregate attendance counts per student email
#     Returns: dict of {email: {field_name: count}}
#     """
#     print_step("PROCESSING", "Aggregating attendance counts per student")

#     # Structure: {email: {workshops_attended: count, standup_attended: count, mentoring_attended: count}}
#     attendance = defaultdict(lambda: defaultdict(int))

#     skipped = 0
#     processed = 0

#     for record in records:
#         # Handle different possible column names from Google Forms
#         email = (
#             record.get('Please enter your Amsterdam Tech email address') or
#             record.get('Email Address') or
#             record.get('email') or
#             record.get('Email') or
#             ''
#         ).strip().lower()

#         session_type_str = (
#             record.get('Which session is this form for?') or
#             record.get('Session Type') or
#             record.get('session_type') or
#             ''
#         )

#         if not email:
#             skipped += 1
#             continue

#         field_name = parse_session_type(session_type_str)
#         if not field_name:
#             skipped += 1
#             continue

#         attendance[email][field_name] += 1
#         processed += 1

#     print(f"Processed {processed} valid responses, skipped {skipped}")
#     print(f"Found attendance data for {len(attendance)} unique students")

#     return attendance


# def update_student_attendance(supabase, attendance_data):
#     """Update student attendance fields in Supabase"""
#     print_step("UPDATING DATABASE", "Syncing attendance counts to Supabase")

#     # Fetch all students to map email -> id
#     response = supabase.from_('students').select('id, email, workshops_attended, standup_attended, mentoring_attended').execute()
#     students = {s['email'].lower(): s for s in response.data if s.get('email')}

#     updated = 0
#     not_found = []

#     for email, counts in attendance_data.items():
#         student = students.get(email)

#         if not student:
#             not_found.append(email)
#             continue

#         # Build update payload with new counts from the sheet
#         # This REPLACES the current values with counts from the form
#         update_data = {}

#         if 'workshops_attended' in counts:
#             update_data['workshops_attended'] = counts['workshops_attended']

#         if 'standup_attended' in counts:
#             update_data['standup_attended'] = counts['standup_attended']

#         if 'mentoring_attended' in counts:
#             update_data['mentoring_attended'] = counts['mentoring_attended']

#         if update_data:
#             try:
#                 supabase.from_('students').update(update_data).eq('id', student['id']).execute()
#                 updated += 1
#                 print(f"  Updated {email}: {update_data}")
#             except Exception as e:
#                 print(f"  Error updating {email}: {e}")

#     print(f"\nUpdated {updated} students")

#     if not_found:
#         print(f"\nWarning: {len(not_found)} emails not found in students table:")
#         for email in not_found[:10]:  # Show first 10
#             print(f"  - {email}")
#         if len(not_found) > 10:
#             print(f"  ... and {len(not_found) - 10} more")

#     return updated


# def main():
#     """Main function to sync attendance from Google Sheets to Supabase"""
#     print_step("ATTENDANCE SYNC", "Starting attendance synchronization from Google Sheets")

#     try:
#         # Initialize clients
#         gc = get_google_sheets_client()
#         supabase = get_supabase_client(service_role=True)

#         # Fetch form responses
#         records = fetch_attendance_responses(gc)

#         if not records:
#             print("No attendance records found in the spreadsheet")
#             return

#         # Aggregate by student
#         attendance_data = aggregate_attendance(records)

#         if not attendance_data:
#             print("No valid attendance data to process")
#             return

#         # Update database
#         updated = update_student_attendance(supabase, attendance_data)

#         print_step("COMPLETE", f"Successfully updated attendance for {updated} students")

#     except FileNotFoundError as e:
#         print(f"\n❌ Configuration Error: {e}")
#         print("\nTo set up Google Sheets access:")
#         print("1. Create a service account in Google Cloud Console")
#         print("2. Download the JSON credentials file")
#         print("3. Save it as 'google-credentials.json' in the project root")
#         print("4. Share the Google Sheet with the service account email")

#     except Exception as e:
#         print(f"\n❌ Error: {e}")
#         raise


# if __name__ == "__main__":
#     main()
