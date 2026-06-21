"""
Points Assignment Management
Calculates and updates points_assigned for students based on attendance
Run with: python update_points_assigned.py
"""

from utils import get_supabase_client, print_step, safe_print

class PointsAssignmentManager:
    """Handles calculation and updating of points_assigned based on attendance"""

    # Points per attendance type
    WORKSHOP_POINTS = 3
    MENTORING_POINTS = 3
    STANDUP_POINTS = 1

    def __init__(self, supabase_client):
        self.supabase = supabase_client

    def calculate_points(self, workshops=0, mentoring=0, standups=0):
        """Calculate total points based on attendance counts"""
        return (workshops * self.WORKSHOP_POINTS +
                mentoring * self.MENTORING_POINTS +
                standups * self.STANDUP_POINTS)

    def update_all_student_points(self):
        """Update points_assigned for all students based on their attendance"""
        print_step("POINTS ASSIGNMENT", "Calculating and updating points_assigned for all students")

        try:
            # Fetch all students with attendance data
            print("Fetching students with attendance data...")
            students_response = self.supabase.from_('students').select(
                'id, username, workshops_attended, mentoring_attended, standup_attended'
            ).execute()

            students = students_response.data
            print(f"Found {len(students)} students to process")

            if not students:
                print("No students found to process — nothing to do, this is not an error.")
                return True

            updated_count = 0
            failed_count = 0

            # Process each student
            for student in students:
                student_id = student['id']
                username = student.get('username', 'unknown')

                # Get attendance values (default to 0 if None)
                workshops = student.get('workshops_attended') or 0
                mentoring = student.get('mentoring_attended') or 0
                standups = student.get('standup_attended') or 0

                # Calculate points
                points_assigned = self.calculate_points(workshops, mentoring, standups)

                try:
                    # Update the student's points_assigned
                    update_response = self.supabase.from_('students') \
                        .update({'points_assigned': points_assigned}) \
                        .eq('id', student_id).execute()

                    safe_print(f"[OK] {username}: Workshops({workshops}x{self.WORKSHOP_POINTS}) + "
                          f"Mentoring({mentoring}x{self.MENTORING_POINTS}) + "
                          f"Standups({standups}x{self.STANDUP_POINTS}) = {points_assigned} points")
                    updated_count += 1

                except Exception as e:
                    safe_print(f"[X] Error updating student {username} ({student_id}): {e}")
                    failed_count += 1
                    continue

            # Print summary
            print("\n" + "="*70)
            print("UPDATE SUMMARY")
            print("="*70)
            print(f"Successfully updated: {updated_count} students")
            if failed_count > 0:
                print(f"Failed to update: {failed_count} students")
            print("="*70)

            # Show top students by points
            self.show_top_students_by_points()

            return True

        except Exception as e:
            print(f"Error fetching students: {e}")
            return False

    def show_top_students_by_points(self, limit=10):
        """Display top students by points_assigned"""
        print("\n" + "="*70)
        print(f"TOP {limit} STUDENTS BY ATTENDANCE POINTS")
        print("="*70)

        try:
            # Fetch top students
            top_students_response = self.supabase.from_('students').select(
                'username, first_name, last_name, workshops_attended, mentoring_attended, standup_attended, points_assigned'
            ).order('points_assigned', desc=True).limit(limit).execute()

            top_students = top_students_response.data

            if not top_students:
                print("No student data available")
                return

            # Print header
            print(f"{'Rank':<6} {'Name':<25} {'Workshops':<12} {'Mentoring':<12} {'Standups':<10} {'Points':<8}")
            print("-" * 70)

            # Print each student
            for idx, student in enumerate(top_students, 1):
                name = f"{student.get('first_name', '')} {student.get('last_name', '')}".strip() or student.get('username', 'N/A')
                workshops = student.get('workshops_attended') or 0
                mentoring = student.get('mentoring_attended') or 0
                standups = student.get('standup_attended') or 0
                points = student.get('points_assigned') or 0

                print(f"{idx:<6} {name:<25} {workshops:<12} {mentoring:<12} {standups:<10} {points:<8}")

            print("="*70)

        except Exception as e:
            print(f"Error fetching top students: {e}")

    def show_points_statistics(self):
        """Display statistics about points distribution"""
        print("\n" + "="*70)
        print("POINTS DISTRIBUTION STATISTICS")
        print("="*70)

        try:
            # Fetch all students with points
            students_response = self.supabase.from_('students').select(
                'points_assigned, workshops_attended, mentoring_attended, standup_attended'
            ).execute()

            students = students_response.data

            if not students:
                print("No student data available")
                return

            # Calculate statistics
            total_students = len(students)
            total_points = sum(s.get('points_assigned', 0) for s in students)
            avg_points = total_points / total_students if total_students > 0 else 0

            total_workshops = sum(s.get('workshops_attended', 0) for s in students)
            total_mentoring = sum(s.get('mentoring_attended', 0) for s in students)
            total_standups = sum(s.get('standup_attended', 0) for s in students)

            avg_workshops = total_workshops / total_students if total_students > 0 else 0
            avg_mentoring = total_mentoring / total_students if total_students > 0 else 0
            avg_standups = total_standups / total_students if total_students > 0 else 0

            print(f"Total Students: {total_students}")
            print(f"Total Points Assigned: {total_points}")
            print(f"Average Points per Student: {avg_points:.2f}")
            print()
            print("Average Attendance:")
            print(f"  Workshops: {avg_workshops:.2f}")
            print(f"  Mentoring: {avg_mentoring:.2f}")
            print(f"  Stand-ups: {avg_standups:.2f}")
            print("="*70)

        except Exception as e:
            print(f"Error calculating statistics: {e}")

def main():
    """Main function to run points assignment update"""
    try:
        # Create Supabase client with service role for admin operations
        supabase_client = get_supabase_client(service_role=True)

        # Create points manager
        manager = PointsAssignmentManager(supabase_client)

        # Update all student points
        success = manager.update_all_student_points()

        # Show statistics
        if success:
            manager.show_points_statistics()
            safe_print("\n[SUCCESS] Points assignment update completed successfully!")
        else:
            safe_print("\n[WARN] Points assignment update failed. Check the logs above.")
            return 1

        return 0

    except Exception as e:
        safe_print(f"\n[ERROR] Error: {e}")
        return 1

if __name__ == "__main__":
    exit(main())
