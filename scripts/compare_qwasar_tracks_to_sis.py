import json
import re
from collections import Counter
from pathlib import Path

QWASAR_FILE = Path("qwasar_programme_track_comparison.json")
CATALOGUE_FILE = Path("sis_project_catalogue_diagnostic.json")
OUTPUT_FILE = Path("qwasar_sis_project_comparison.json")

TRACK_TO_SEASON = {
    "preseason-data": "Preseason",
    "preseason-web": "Preseason",
    "season-01-arc-01": "Season 01 Arc 01",
    "season-01-arc-02": "Season 01 Arc 02",
    "season-02-data-science": "Season 02",
    "season-03": "Season 03",
}


def normalize(value):
    value = str(value or "").lower()
    value = re.sub(r"([0-9])([a-z])", r"\1 \2", value)
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return " ".join(value.split())


qwasar = json.loads(QWASAR_FILE.read_text(encoding="utf-8"))
catalogue = json.loads(CATALOGUE_FILE.read_text(encoding="utf-8"))

projects = catalogue["projects"]

# Use programme-specific Season names, not global Season IDs.
programme_seasons = {
    (p["program_id"], normalize(p["season_name"]))
    for p in projects
}

results = []
counts = Counter()

for student in qwasar["student_profiles"]:
    if student.get("profile_status") != "success":
        continue

    programme_id = student.get("program_id")

    for track, track_data in student.get("tracks", {}).items():
        expected_season = TRACK_TO_SEASON.get(track)

        for slug in track_data.get("project_slugs", []):
            normalized_slug = normalize(slug)

            name_matches = [
                p for p in projects
                if normalize(p["name"]) == normalized_slug
            ]

            programme_matches = [
                p for p in name_matches
                if p["program_id"] == programme_id
            ]

            programme_season_matches = [
                p for p in programme_matches
                if expected_season
                and normalize(p["season_name"]) == normalize(expected_season)
            ]

            if not expected_season:
                status = "UNMAPPED_TRACK"
                matched = name_matches

            elif len(programme_season_matches) == 1:
                status = "EXACT_PROGRAMME_SEASON_MATCH"
                matched = programme_season_matches

            elif len(programme_season_matches) > 1:
                status = "AMBIGUOUS_PROGRAMME_SEASON_MATCH"
                matched = programme_season_matches

            elif programme_matches:
                status = "PROGRAMME_MATCH_WRONG_SEASON"
                matched = programme_matches

            elif (programme_id, normalize(expected_season)) not in programme_seasons:
                status = "PROGRAMME_HAS_NO_EXPECTED_SEASON"
                matched = name_matches

            elif name_matches:
                status = "CROSS_PROGRAMME_ONLY"
                matched = name_matches

            else:
                status = "UNMATCHED"
                matched = []

            counts[status] += 1

            results.append({
                "student_username": student.get("username"),
                "student_programme": student.get("program_name"),
                "student_program_id": programme_id,
                "qwasar_track": track,
                "expected_sis_season": expected_season,
                "qwasar_slug": slug,
                "status": status,
                "candidates": [
                    {
                        "id": p["id"],
                        "name": p["name"],
                        "program_name": p["program_name"],
                        "program_id": p["program_id"],
                        "season_name": p["season_name"],
                        "season_id": p["season_id"],
                    }
                    for p in matched
                ],
            })

report = {
    "read_only": True,
    "matching_method": (
        "Normalized project name + programme ID + "
        "programme-specific Season name"
    ),
    "student_profiles_examined": qwasar["successful_profiles"],
    "total_project_observations": len(results),
    "status_counts": dict(counts),
    "results": results,
}

OUTPUT_FILE.write_text(
    json.dumps(report, indent=2, ensure_ascii=False),
    encoding="utf-8",
)

print("===== CORRECTED QWASAR / SIS COMPARISON =====")
print(f"Student profiles examined: {report['student_profiles_examined']}")
print(f"Project observations: {len(results)}")

for status, count in sorted(counts.items()):
    print(f"{status}: {count}")

print(f"\nReport saved: {OUTPUT_FILE}")
print("No SIS or Qwasar records were modified.")
