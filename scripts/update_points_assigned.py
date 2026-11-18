"""
Points Assignment Management.

Bachelor students:
    points_assigned = sum of points_awarded from eligible,
    programme-matched bachelor_attendance_records.

Non-Bachelor students:
    Retain the legacy attendance-counter calculation.

Run:
    python scripts/update_points_assigned.py
    python scripts/update_points_assigned.py --dry-run
"""

import argparse
from collections import defaultdict


def safe_print(message):
    """Print safely without requiring the Supabase utilities module."""
    try:
        print(message)
    except UnicodeEncodeError:
        print(str(message).encode("ascii", errors="replace").decode("ascii"))


BACHELOR_PROGRAM_IDS = {
    "bd715dd5-dc5a-414a-98f9-660274fd60e0",  # AI/ML
    "c266131f-8e5e-4f39-9711-54523d65ea24",  # Data Science
    "07bc935a-c743-4cab-b10c-a1d231eaf3e2",  # Software Engineering
}

PAGE_SIZE = 1000


def fetch_all(query, page_size=PAGE_SIZE):
    """Fetch every row from a paginated Supabase query."""
    rows = []
    start = 0

    while True:
        response = query.range(start, start + page_size - 1).execute()
        page = response.data or []
        rows.extend(page)

        if len(page) < page_size:
            break

        start += page_size

    return rows


def calculate_student_points(student, ledger_totals, bachelor_program_ids=None):
    """Calculate points using the correct source for the student's programme."""
    bachelor_program_ids = bachelor_program_ids or BACHELOR_PROGRAM_IDS

    if student.get("program_id") in bachelor_program_ids:
        # Missing ledger entries deliberately produce zero, never a legacy fallback.
        return ledger_totals.get(student["id"], 0)

    workshops = student.get("workshops_attended") or 0
    mentoring = student.get("mentoring_attended") or 0
    standups = student.get("standup_attended") or 0

    return workshops * 3 + mentoring * 3 + standups


class PointsAssignmentManager:
    """Calculate and update points_assigned for all students."""

    WORKSHOP_POINTS = 3
    MENTORING_POINTS = 3
    STANDUP_POINTS = 1

    def __init__(self, supabase_client):
        self.supabase = supabase_client

    def calculate_points(self, workshops=0, mentoring=0, standups=0):
        """Legacy formula retained for non-Bachelor students."""
        return (
            workshops * self.WORKSHOP_POINTS
            + mentoring * self.MENTORING_POINTS
            + standups * self.STANDUP_POINTS
        )

    def fetch_students(self):
        query = self.supabase.from_("students").select(
            "id, username, program_id, workshops_attended, "
            "mentoring_attended, standup_attended"
        )
        return fetch_all(query)

    def fetch_eligible_ledger_totals(self, bachelor_student_ids):
        """Aggregate eligible attendance points, validating programme ownership."""
        if not bachelor_student_ids:
            return {}, 0, 0

        query = (
            self.supabase.from_("bachelor_attendance_records")
            .select("student_id, program_id, points_awarded")
            .eq("eligibility_status", "eligible")
        )
        records = fetch_all(query)

        # Only records belonging to a known Bachelor student and matching
        # that student's current programme are allowed into the calculation.
        student_programs = getattr(self, "_student_programs", {})
        totals = defaultdict(int)
        counts = defaultdict(int)
        mismatches = 0

        for record in records:
            student_id = record.get("student_id")

            if student_id not in bachelor_student_ids:
                continue

            if record.get("program_id") != student_programs.get(student_id):
                mismatches += 1
                continue

            totals[student_id] += int(record.get("points_awarded") or 0)
            counts[student_id] += 1

        self._ledger_record_counts = counts
        return dict(totals), sum(counts.values()), mismatches

    def update_all_student_points(self, dry_run=False):
        """Calculate all student totals and optionally write them to Supabase."""
        mode = "DRY RUN — NO DATABASE UPDATES" if dry_run else "LIVE UPDATE"
        print("\n" + "=" * 70)
        print(f"POINTS ASSIGNMENT — {mode}")
        print("=" * 70)

        try:
            print("Fetching all students...")
            students = self.fetch_students()
            print(f"Found {len(students)} students")

            if not students:
                print("No students found — nothing to do.")
                return True

            bachelor_students = [
                student for student in students
                if student.get("program_id") in BACHELOR_PROGRAM_IDS
            ]
            bachelor_student_ids = {
                student["id"] for student in bachelor_students
            }
            self._student_programs = {
                student["id"]: student.get("program_id")
                for student in bachelor_students
            }

            print(
                f"Bachelor students: {len(bachelor_students)}; "
                f"non-Bachelor students: {len(students) - len(bachelor_students)}"
            )

            print("Fetching eligible Bachelor attendance ledger records...")
            ledger_totals, matched_records, mismatches = (
                self.fetch_eligible_ledger_totals(bachelor_student_ids)
            )
            print(f"Programme-matched eligible ledger records: {matched_records}")
            print(f"Programme-mismatched records ignored: {mismatches}")

            updated_count = 0
            failed_count = 0
            bachelor_total = 0
            non_bachelor_total = 0

            print("\n===== STUDENT POINTS PREVIEW =====")

            for student in students:
                student_id = student["id"]
                username = student.get("username") or "unknown"
                program_id = student.get("program_id")

                points_assigned = calculate_student_points(
                    student, ledger_totals
                )

                if program_id in BACHELOR_PROGRAM_IDS:
                    record_count = self._ledger_record_counts.get(student_id, 0)
                    bachelor_total += points_assigned
                    source = (
                        f"Bachelor ledger: {record_count} eligible records"
                    )
                else:
                    workshops = student.get("workshops_attended") or 0
                    mentoring = student.get("mentoring_attended") or 0
                    standups = student.get("standup_attended") or 0
                    non_bachelor_total += points_assigned
                    source = (
                        f"Legacy counters: workshops={workshops}, "
                        f"mentoring={mentoring}, standups={standups}"
                    )

                if dry_run:
                    safe_print(
                        f"[DRY RUN] {username}: {source} = "
                        f"{points_assigned} points"
                    )
                    updated_count += 1
                    continue

                try:
                    (
                        self.supabase.from_("students")
                        .update({"points_assigned": points_assigned})
                        .eq("id", student_id)
                        .execute()
                    )
                    safe_print(
                        f"[OK] {username}: {source} = "
                        f"{points_assigned} points"
                    )
                    updated_count += 1

                except Exception as error:
                    safe_print(
                        f"[X] Error updating {username} "
                        f"({student_id}): {error}"
                    )
                    failed_count += 1

            print("\n" + "=" * 70)
            print("POINTS ASSIGNMENT SUMMARY")
            print("=" * 70)
            print(f"Mode: {mode}")
            print(f"Students processed successfully: {updated_count}")
            print(f"Students failed: {failed_count}")
            print(f"Bachelor ledger points (calculated): {bachelor_total}")
            print(f"Non-Bachelor legacy points (calculated): {non_bachelor_total}")
            print("=" * 70)

            if dry_run:
                print("DRY RUN COMPLETE: no student records were changed.")
            else:
                self.show_top_students_by_points()

            return failed_count == 0

        except Exception as error:
            print(f"Points assignment failed: {error}")
            return False

    def show_top_students_by_points(self, limit=10):
        """Display top students by their stored attendance points."""
        print("\n" + "=" * 70)
        print(f"TOP {limit} STUDENTS BY ATTENDANCE POINTS")
        print("=" * 70)

        try:
            response = (
                self.supabase.from_("students")
                .select(
                    "username, first_name, last_name, "
                    "workshops_attended, mentoring_attended, "
                    "standup_attended, points_assigned"
                )
                .order("points_assigned", desc=True)
                .limit(limit)
                .execute()
            )

            top_students = response.data or []

            if not top_students:
                print("No student data available")
                return

            print(
                f"{'Rank':<6} {'Name':<25} {'Workshops':<12} "
                f"{'Mentoring':<12} {'Standups':<10} {'Points':<8}"
            )
            print("-" * 70)

            for index, student in enumerate(top_students, 1):
                name = (
                    f"{student.get('first_name') or ''} "
                    f"{student.get('last_name') or ''}"
                ).strip() or student.get("username", "N/A")

                print(
                    f"{index:<6} {name:<25} "
                    f"{(student.get('workshops_attended') or 0):<12} "
                    f"{(student.get('mentoring_attended') or 0):<12} "
                    f"{(student.get('standup_attended') or 0):<10} "
                    f"{(student.get('points_assigned') or 0):<8}"
                )

            print("=" * 70)

        except Exception as error:
            print(f"Error fetching top students: {error}")

    def show_points_statistics(self):
        """Display statistics for stored points_assigned values."""
        print("\n" + "=" * 70)
        print("POINTS DISTRIBUTION STATISTICS")
        print("=" * 70)

        try:
            students = fetch_all(
                self.supabase.from_("students").select(
                    "points_assigned, workshops_attended, "
                    "mentoring_attended, standup_attended"
                )
            )

            if not students:
                print("No student data available")
                return

            total_students = len(students)
            total_points = sum(
                student.get("points_assigned") or 0
                for student in students
            )

            print(f"Total Students: {total_students}")
            print(f"Total Points Assigned: {total_points}")
            print(f"Average Points per Student: {total_points / total_students:.2f}")
            print(
                "Note: attendance counters are legacy fields and do not "
                "represent the Bachelor ledger breakdown."
            )
            print("=" * 70)

        except Exception as error:
            print(f"Error calculating statistics: {error}")


def main():
    parser = argparse.ArgumentParser(
        description="Assign attendance points using the correct source per programme."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Calculate and preview points without updating student records.",
    )
    args = parser.parse_args()

    try:
        from utils import get_supabase_client

        supabase_client = get_supabase_client(service_role=True)
        manager = PointsAssignmentManager(supabase_client)

        success = manager.update_all_student_points(dry_run=args.dry_run)

        if not success:
            safe_print("\n[WARN] Points assignment failed. Check the logs above.")
            return 1

        if not args.dry_run:
            manager.show_points_statistics()
            safe_print("\n[SUCCESS] Points assignment update completed successfully!")
        else:
            safe_print("\n[SAFE] Dry run completed. No database updates were performed.")

        return 0

    except Exception as error:
        safe_print(f"\n[ERROR] Error: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
