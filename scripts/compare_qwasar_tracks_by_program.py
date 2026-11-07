"""
Read-only comparison of SIS programmes against Qwasar profile tracks.

- Samples two students per SIS programme.
- Reads students from Supabase.
- Fetches Qwasar profile pages only.
- Does not inspect individual project pages.
- Does not write to SIS or Qwasar.
- Saves a separate JSON diagnostic report.
"""

import json
import os
import re
import shlex
import subprocess
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"

sys.path.insert(0, str(SCRIPTS))

load_dotenv(ROOT / ".env")

from data_processor import QwasarScraper


SAMPLE_SIZE_PER_PROGRAMME = 2
REQUEST_TIMEOUT = 30
REQUEST_DELAY_SECONDS = 1

OUTPUT_PATH = ROOT / "qwasar_programme_track_comparison.json"

PROFILE_BASE_URL = "https://upskill.us.qwasar.io/users"


def load_programme_names():
    """Derive programme IDs and names from the existing SIS catalogue report."""

    catalogue_path = ROOT / "sis_project_catalogue_diagnostic.json"

    if not catalogue_path.exists():
        raise FileNotFoundError(
            f"Missing existing catalogue diagnostic: {catalogue_path}"
        )

    data = json.loads(catalogue_path.read_text(encoding="utf-8"))

    projects = data.get("projects", data if isinstance(data, list) else [])

    programme_names = {}

    for project in projects:
        program_id = project.get("program_id")
        program_name = project.get("program_name")

        if program_id and program_name:
            existing = programme_names.get(program_id)

            if existing and existing != program_name:
                raise ValueError(
                    f"Conflicting programme names for ID {program_id}"
                )

            programme_names[program_id] = program_name

    if not programme_names:
        raise RuntimeError(
            "Could not derive programme IDs from the SIS catalogue report."
        )

    return programme_names


def extract_profile_tracks(html):
    """Extract unique Qwasar track slugs and project counts from a profile."""

    soup = BeautifulSoup(html, "html.parser")

    track_projects = defaultdict(set)

    pattern = re.compile(
        r"/tracks/([^/]+)/track_users/[^/]+/projects/([^/?#]+)"
    )

    for link in soup.find_all("a", href=True):
        match = pattern.search(link["href"])

        if not match:
            continue

        track = match.group(1)
        project_slug = match.group(2)

        track_projects[track].add(project_slug)

    return {
        track: {
            "project_count": len(projects),
            "project_slugs": sorted(projects),
        }
        for track, projects in sorted(track_projects.items())
    }



def fetch_students_read_only():
    """Fetch student identities through a read-only request executed on the VPS."""
    remote_python = """
import json
from pathlib import Path
from urllib.parse import urlparse
import requests

values = {}
for line in Path("/opt/supabase/docker/.env").read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    values[key.strip()] = value.strip().strip('"').strip("'")

parsed = urlparse(values["API_EXTERNAL_URL"].rstrip("/"))
base_url = f"{parsed.scheme}://{parsed.netloc}"
service_key = values["SERVICE_ROLE_KEY"]

response = requests.get(
    f"{base_url}/rest/v1/students",
    headers={
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Accept": "application/json",
        "Range-Unit": "items",
    },
    params={
        "select": "id,username,program_id,cohort_id",
        "order": "username.asc",
    },
    timeout=30,
)
response.raise_for_status()
records = response.json()
if not isinstance(records, list):
    raise RuntimeError("Supabase returned an unexpected response")
print(json.dumps(records))
"""

    remote_command = "python3 -c " + shlex.quote(remote_python)

    result = subprocess.run(
        ["ssh", "root@31.97.34.52", remote_command],
        check=False,
        capture_output=True,
        text=True,
        timeout=120,
    )

    if result.returncode != 0:
        raise RuntimeError(
            "Could not retrieve SIS students through SSH. "
            f"SSH exit code: {result.returncode}. "
            f"Error: {result.stderr.strip()[:1000]}"
        )

    try:
        students = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            "The VPS returned output that was not valid student JSON. "
            f"Output preview: {result.stdout[:500]!r}; "
            f"stderr: {result.stderr[:500]!r}"
        ) from exc

    if not isinstance(students, list):
        raise RuntimeError("The VPS student response was not a JSON list.")

    return students


def main():
    print("QWASAR TRACK / SIS PROGRAMME COMPARISON")
    print("=" * 65)
    print("Mode: READ ONLY")
    print(f"Sample size per programme: {SAMPLE_SIZE_PER_PROGRAMME}")
    print()

    # Derive programme names from the existing catalogue diagnostic.
    programme_names = load_programme_names()

    print("Fetching SIS student identities through read-only VPS SSH...")

    students = fetch_students_read_only()

    print(f"SIS student records retrieved: {len(students)}")

    # Group students by programme.
    students_by_programme = defaultdict(list)

    for student in students:
        username = (student.get("username") or "").strip()
        program_id = student.get("program_id")

        if not username or not program_id:
            continue

        if program_id not in programme_names:
            continue

        students_by_programme[program_id].append(student)

    # Select a deterministic sample from each programme.
    selected = []

    for program_id, programme_name in sorted(
        programme_names.items(),
        key=lambda item: item[1].casefold(),
    ):
        candidates = students_by_programme.get(program_id, [])

        sample = candidates[:SAMPLE_SIZE_PER_PROGRAMME]

        print(
            f"{programme_name}: "
            f"{len(candidates)} eligible students; "
            f"{len(sample)} selected"
        )

        for student in sample:
            selected.append({
                "student_id": student["id"],
                "username": student["username"],
                "program_id": program_id,
                "program_name": programme_name,
                "cohort_id": student.get("cohort_id"),
            })

    if not selected:
        raise RuntimeError(
            "No students could be selected. Check programme IDs "
            "in the catalogue diagnostic."
        )

    # Reuse the existing Qwasar authentication implementation.
    scraper = QwasarScraper.__new__(QwasarScraper)
    scraper.username = os.getenv("SCRAPER_USERNAME")
    scraper.password = os.getenv("SCRAPER_PASSWORD")
    scraper.session = requests.Session()
    scraper.session_cookies = {}

    if not scraper.username or not scraper.password:
        raise RuntimeError(
            "SCRAPER_USERNAME or SCRAPER_PASSWORD is missing."
        )

    print()
    print("Authenticating with Qwasar...")

    cookies = scraper.get_tokens()

    if (
        not cookies
        or not cookies.get("user.id")
        or not cookies.get("_session_id")
    ):
        raise RuntimeError(
            "Qwasar authentication did not return expected session cookies."
        )

    print("Qwasar authentication succeeded.")

    # Fetch profile pages only.
    results = []
    failures = []

    for index, student in enumerate(selected, start=1):
        username = student["username"]
        profile_url = f"{PROFILE_BASE_URL}/{username}"

        print(
            f"\n[{index}/{len(selected)}] "
            f"{student['program_name']} | {username}"
        )

        try:
            profile_response = requests.get(
                profile_url,
                cookies=cookies,
                timeout=REQUEST_TIMEOUT,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 "
                        "(Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 "
                        "(KHTML, like Gecko) "
                        "Chrome/120.0 Safari/537.36"
                    )
                },
            )

            profile_response.raise_for_status()

            tracks = extract_profile_tracks(profile_response.text)

            result = {
                **student,
                "profile_status": "success",
                "track_count": len(tracks),
                "tracks": tracks,
            }

            results.append(result)

            if tracks:
                for track, details in tracks.items():
                    print(
                        f"  {track}: "
                        f"{details['project_count']} projects"
                    )
            else:
                print("  No track/project links found.")

        except requests.RequestException as exc:
            failure = {
                **student,
                "profile_status": "failed",
                "error": str(exc),
            }

            failures.append(failure)

            print(f"  Profile fetch failed: {type(exc).__name__}")

        except Exception as exc:
            failures.append({
                **student,
                "profile_status": "failed",
                "error": str(exc),
            })

            print(f"  Profile processing failed: {type(exc).__name__}")

        time.sleep(REQUEST_DELAY_SECONDS)

    # Summarise track usage by SIS programme.
    summary = {}

    for program_id, programme_name in programme_names.items():
        programme_results = [
            row for row in results
            if row["program_id"] == program_id
        ]

        track_counts = Counter()

        for row in programme_results:
            for track in row["tracks"]:
                track_counts[track] += 1

        summary[programme_name] = {
            "selected_students": min(
                SAMPLE_SIZE_PER_PROGRAMME,
                len(students_by_programme.get(program_id, [])),
            ),
            "successful_profiles": len(programme_results),
            "failed_profiles": sum(
                1 for row in failures
                if row["program_id"] == program_id
            ),
            "track_student_counts": dict(sorted(track_counts.items())),
        }

    report = {
        "diagnostic": "Qwasar tracks by SIS programme",
        "read_only": True,
        "sample_size_per_programme": SAMPLE_SIZE_PER_PROGRAMME,
        "sis_student_records_retrieved": len(students),
        "selected_students": len(selected),
        "successful_profiles": len(results),
        "failed_profiles": len(failures),
        "programme_summary": summary,
        "student_profiles": results,
        "failures": failures,
    }

    OUTPUT_PATH.write_text(
        json.dumps(report, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    print()
    print("=" * 65)
    print("COMPARISON SUMMARY")
    print("=" * 65)

    for programme, details in summary.items():
        print(f"\n{programme}")
        print(
            f"  Successful profiles: "
            f"{details['successful_profiles']}"
        )
        print(
            f"  Failed profiles: "
            f"{details['failed_profiles']}"
        )

        for track, count in details["track_student_counts"].items():
            print(f"  {track}: {count} student(s)")

    print()
    print(f"Successful profiles: {len(results)}")
    print(f"Failed profiles: {len(failures)}")
    print(f"Report saved to: {OUTPUT_PATH}")
    print()
    print("No SIS or Qwasar records were modified.")


if __name__ == "__main__":
    main()
