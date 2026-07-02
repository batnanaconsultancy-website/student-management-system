"""
Shared utilities for student data processing scripts
Contains common functions used across multiple scripts to avoid code duplication
"""

import os
import re
import json
from datetime import datetime, timedelta
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables once
load_dotenv()

class SupabaseClient:
    """Singleton-like class to manage Supabase connections"""
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialize()
        return cls._instance
    
    def _initialize(self):
        """Initialize Supabase client with environment variables"""
        self.url = os.getenv('SUPABASE_URL')
        self.key = os.getenv('SUPABASE_KEY')
        self.role_key = os.getenv('SUPABASE_ROLE_KEY')
        
        if not self.url or not self.key:
            raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set in the .env file")
        
        self.client = create_client(self.url, self.key)
        
        # Create service role client if available
        if self.role_key:
            self.service_client = create_client(self.url, self.role_key)
        else:
            self.service_client = self.client
    
    def get_client(self, service_role=False):
        """Get Supabase client (regular or service role)"""
        return self.service_client if service_role else self.client

def get_supabase_client(service_role=False):
    """Get configured Supabase client instance"""
    return SupabaseClient().get_client(service_role)

# def map_season_name_to_db(season_name):
#     """
#     Map scraped season names to database season names
#     Handles Season 03 Software Engineer variations with specific language mappings
#     """
#     if not season_name:
#         return season_name
    
#     season_name = season_name.strip()
    
#     # Handle Season 03 Software Engineer variations with specific language mappings
#     if re.match(r'Season 03 Software Engineer', season_name, re.IGNORECASE):
#         # Map specific language variants
#         if 'Cpp' in season_name:
#             return "Season 03 Software Engineer Cpp"
#         elif 'Rust' in season_name:
#             return "Season 03 Software Engineer Rust"
#         elif 'Golang' in season_name or 'Go' in season_name:
#             return "Season 03 Software Engineer Go"
#         else:
#             # If it's just "Season 03 Software Engineer" without specific language,
#             # we can't map it properly
#             print(f"Warning: Found '{season_name}' but no specific language variant.")
#             return season_name
    
#     # Handle other specific mappings based on what exists in the database
#     mappings = {
#         'Preseason Data': 'Preseason Data',
#         'Preseason Web': 'Preseason Web',
#         'Season 02 Data Science': 'Season 02 Data Science',
#         'Season 02 Software Engineer': 'Season 02 Software Engineer',
#         'Season 03 Data Science': 'Season 03 Data Science',
#         'Season 03 Machine Learning': 'Season 03 Machine Learning'
#     }
    
#     return mappings.get(season_name, season_name)




import re

def map_season_name_to_db(season_name):
    """
    Normalize a scraped Qwasar season name down to the generic base name
    used in the `seasons` table (program_id already disambiguates, so the
    program/specialization suffix scraped from the site is redundant).

    Returns None for stages that are intentionally not tracked as seasons
    (e.g. 'Onboarding', which happens before Preseason and isn't modeled).
    """
    if not season_name:
        return None

    name = season_name.strip()

    # Onboarding happens before Preseason and is not tracked as a season.
    if name.lower() == 'onboarding':
        return None

    # Preseason Data / Preseason Web -> Preseason
    if re.match(r'^Preseason\b', name, re.IGNORECASE):
        return 'Preseason'

    # Season 01 Arc 01 / Arc 02 -> kept as-is (Software Engineering only,
    # these already match the seasons table exactly)
    m = re.match(r'^(Season 01 Arc 0[12])\b', name, re.IGNORECASE)
    if m:
        return m.group(1)

    # Season 01 (no Arc) -> Season 01
    if re.match(r'^Season 01\b', name, re.IGNORECASE):
        return 'Season 01'

    # Season 02 Data Science / Software Engineer / Fullstack -> Season 02
    if re.match(r'^Season 02\b', name, re.IGNORECASE):
        return 'Season 02'

    # Season 03 Data Science / Machine Learning / Backend / Software
    # Engineer (Cpp/Rust/Go/Golang) -> Season 03
    if re.match(r'^Season 03\b', name, re.IGNORECASE):
        return 'Season 03'

    # Unrecognized label - log and pass through unchanged so it's visible
    # rather than silently dropped.
    print(f"Warning: Unrecognized season name '{name}' - no mapping rule matched.")
    return name



def parse_relative_time_to_timestamp(relative_time_str):
    """
    Convert time strings to timestamps. Handles both:
    - Relative times: '3 days ago', 'a month ago', '30 days ago'
    - Absolute dates: 'february 19, 2025  9:17pm', 'October 24, 2025 11:15am'
    """
    if not relative_time_str or relative_time_str.strip() == "":
        return None

    relative_time_str = relative_time_str.strip()
    now = datetime.now()

    try:
        # First, try to parse as absolute date/time
        # Common formats from Qwasar: "february 19, 2025  9:17pm", "October 24, 2025 11:15am"
        absolute_formats = [
            "%B %d, %Y %I:%M%p",      # February 19, 2025 9:17pm
            "%B  %d, %Y  %I:%M%p",    # February  19, 2025  9:17pm (extra spaces)
            "%B %d, %Y  %I:%M%p",     # February 19, 2025  9:17pm (space before time)
            "%B  %d, %Y %I:%M%p",     # February  19, 2025 9:17pm (space before day)
            "%b %d, %Y %I:%M%p",      # Feb 19, 2025 9:17pm (abbreviated month)
            "%B %d, %Y %H:%M",        # February 19, 2025 21:17 (24-hour format)
            "%Y-%m-%d %H:%M:%S",      # 2025-02-19 21:17:00
            "%Y-%m-%d",               # 2025-02-19
        ]

        for fmt in absolute_formats:
            try:
                timestamp = datetime.strptime(relative_time_str, fmt)
                return timestamp.isoformat()
            except ValueError:
                continue

        # If absolute parsing fails, try relative time parsing
        relative_time_lower = relative_time_str.lower()

        # Handle "X days ago"
        if "days ago" in relative_time_lower:
            days_match = re.search(r'(\d+)\s*days?\s*ago', relative_time_lower)
            if days_match:
                days = int(days_match.group(1))
                timestamp = now - timedelta(days=days)
                return timestamp.isoformat()

        # Handle "a day ago"
        if "a day ago" in relative_time_lower or "1 day ago" in relative_time_lower:
            timestamp = now - timedelta(days=1)
            return timestamp.isoformat()

        # Handle "X months ago"
        if "months ago" in relative_time_lower:
            months_match = re.search(r'(\d+)\s*months?\s*ago', relative_time_lower)
            if months_match:
                months = int(months_match.group(1))
                # Approximate: 1 month = 30 days
                timestamp = now - timedelta(days=months * 30)
                return timestamp.isoformat()

        # Handle "a month ago"
        if "a month ago" in relative_time_lower or "1 month ago" in relative_time_lower:
            timestamp = now - timedelta(days=30)
            return timestamp.isoformat()

        # Handle "X years ago"
        if "years ago" in relative_time_lower:
            years_match = re.search(r'(\d+)\s*years?\s*ago', relative_time_lower)
            if years_match:
                years = int(years_match.group(1))
                # Approximate: 1 year = 365 days
                timestamp = now - timedelta(days=years * 365)
                return timestamp.isoformat()

        # Handle "a year ago"
        if "a year ago" in relative_time_lower or "1 year ago" in relative_time_lower:
            timestamp = now - timedelta(days=365)
            return timestamp.isoformat()

        # Handle "X hours ago"
        if "hours ago" in relative_time_lower:
            hours_match = re.search(r'(\d+)\s*hours?\s*ago', relative_time_lower)
            if hours_match:
                hours = int(hours_match.group(1))
                timestamp = now - timedelta(hours=hours)
                return timestamp.isoformat()

        # Handle "an hour ago"
        if "an hour ago" in relative_time_lower or "1 hour ago" in relative_time_lower:
            timestamp = now - timedelta(hours=1)
            return timestamp.isoformat()

        # Handle "X minutes ago"
        if "minutes ago" in relative_time_lower:
            minutes_match = re.search(r'(\d+)\s*minutes?\s*ago', relative_time_lower)
            if minutes_match:
                minutes = int(minutes_match.group(1))
                timestamp = now - timedelta(minutes=minutes)
                return timestamp.isoformat()

        # If none of the patterns match, return None or current time
        print(f"Warning: Could not parse time string '{relative_time_str}'. Using current time.")
        return now.isoformat()

    except Exception as e:
        print(f"Error parsing time string '{relative_time_str}': {e}")
        return None

def load_scraped_data(file_path=None):
    """Load scraped data from JSON file"""
    if file_path is None:
        # Default path relative to the scripts directory
        script_dir = os.path.dirname(os.path.abspath(__file__))
        file_path = os.path.join(script_dir, '..', 'public', 'student_grades.json')
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # Filter out metadata entries
            if isinstance(data, list):
                return [item for item in data if 'name' in item or 'last_modified' not in item]
            return data
    except FileNotFoundError:
        print(f"Error: '{file_path}' not found. Please ensure the file exists.")
        return []
    except json.JSONDecodeError:
        print(f"Error: Could not decode '{file_path}'. Check for valid JSON format.")
        return []

def get_student_id_map(supabase_client):
    """Get mapping of student usernames to IDs"""
    try:
        response = supabase_client.from_('students').select('id, username').execute()
        return {row['username']: row['id'] for row in response.data}
    except Exception as e:
        print(f"Error fetching students: {e}")
        return {}

def get_project_id_map(supabase_client):
    """Get mapping of project names to list of IDs (same project can exist in multiple seasons)"""
    try:
        response = supabase_client.from_('projects').select('id, name').execute()
        project_map = {}
        for row in response.data:
            name = row['name']
            if name not in project_map:
                project_map[name] = []
            project_map[name].append(row['id'])
        return project_map
    except Exception as e:
        print(f"Error fetching projects: {e}")
        return {}

def get_season_id_map(supabase_client):
    """Get mapping of season names to IDs"""
    try:
        response = supabase_client.from_('seasons').select('id, name').execute()
        return {row['name']: row['id'] for row in response.data}
    except Exception as e:
        print(f"Error fetching seasons: {e}")
        return {}

def safe_upsert(supabase_client, table_name, records, on_conflict=None):
    """Safely perform upsert operation with error handling"""
    if not records:
        print(f"No records to upsert to {table_name}")
        return False

    try:
        if on_conflict:
            response = supabase_client.from_(table_name).upsert(records, on_conflict=on_conflict).execute()
        else:
            response = supabase_client.from_(table_name).upsert(records).execute()

        print(f"Successfully upserted {len(records)} records to {table_name}")
        return True
    except Exception as e:
        print(f"Error upserting to {table_name}: {e}")
        return False

def safe_update(supabase_client, table_name, records, id_field='id'):
    """Safely perform update operation on existing records with error handling"""
    if not records:
        print(f"No records to update in {table_name}")
        return False

    try:
        updated_count = 0
        failed_count = 0

        for record in records:
            if id_field not in record:
                print(f"Warning: Record missing {id_field} field, skipping")
                failed_count += 1
                continue

            record_id = record[id_field]
            # Create update data without the ID field
            update_data = {k: v for k, v in record.items() if k != id_field}

            if not update_data:
                continue

            try:
                response = supabase_client.from_(table_name).update(update_data).eq(id_field, record_id).execute()
                updated_count += 1
            except Exception as e:
                print(f"Error updating record {record_id}: {e}")
                failed_count += 1

        print(f"Successfully updated {updated_count} records in {table_name}")
        if failed_count > 0:
            print(f"Failed to update {failed_count} records")

        return updated_count > 0
    except Exception as e:
        print(f"Error during update operation on {table_name}: {e}")
        return False

def safe_print(message):
    """Print message with fallback for Windows console encoding issues"""
    try:
        print(message)
    except UnicodeEncodeError:
        # Replace common Unicode characters with ASCII equivalents
        replacements = {
            '✓': '[OK]',
            '✗': '[X]',
            '✘': '[X]',
            '❌': '[ERROR]',
            '✅': '[OK]',
            '⚠️': '[WARN]',
            '⚠': '[WARN]',
            '📋': '[INFO]',
            '📊': '[STATS]',
            '📚': '[INFO]',
            '👥': '[INFO]',
            '🔄': '[RETRY]',
            '🎉': '[SUCCESS]',
            '🔍': '[SEARCH]',
            '📧': '[EMAIL]',
            'ℹ️': '[INFO]',
            '→': '->',
        }
        safe_message = message
        for unicode_char, ascii_char in replacements.items():
            safe_message = safe_message.replace(unicode_char, ascii_char)
        # Final fallback: encode with errors='replace'
        print(safe_message.encode('ascii', errors='replace').decode('ascii'))

def print_step(step_name, description=""):
    """Print formatted step information"""
    safe_print(f"\n{'='*60}")
    safe_print(f"STEP: {step_name}")
    if description:
        safe_print(f"Description: {description}")
    safe_print('='*60)