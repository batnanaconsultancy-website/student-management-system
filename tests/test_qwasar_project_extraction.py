import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from data_processor import QwasarScraper


class TestQwasarProjectExtraction(unittest.TestCase):

    def setUp(self):
        self.scraper = QwasarScraper.__new__(QwasarScraper)

    def test_extracts_completed_project_identity(self):
        html = """
        <div class="col-span-full">
            <h2>Projects Completed</h2>
            <div class="border-b border-slate-800">
                <li class="flex gap-3 px-3 py-2 text-sm">
                    <a href="/tracks/season-02-data-science/track_users/1352-student-123/projects/my_convex_optimization">
                        My Convex Optimization
                    </a>
                </li>
            </div>
        </div>
        """

        observations = self.scraper.extract_qwasar_project_observations(
            html,
            "student123",
        )

        self.assertEqual(len(observations), 1)

        project = observations[0]

        self.assertEqual(project["username"], "student123")
        self.assertEqual(project["track_slug"], "season-02-data-science")
        self.assertEqual(project["track_user_id"], "1352-student-123")
        self.assertEqual(project["project_slug"], "my_convex_optimization")
        self.assertEqual(project["project_name"], "My Convex Optimization")
        self.assertEqual(project["completion_status"], "COMPLETED")
        self.assertTrue(
            project["project_url"].endswith(
                "/tracks/season-02-data-science/track_users/1352-student-123/projects/my_convex_optimization"
            )
        )

    def test_extracts_in_progress_project(self):
        html = """
        <div class="col-span-full">
            <h2>Projects In Progress</h2>
            <div class="border-b border-slate-800">
                <li class="flex gap-3 px-3 py-2 text-sm">
                    <a href="/tracks/season-03-machine-learning/track_users/1380-student-456/projects/my_paypal">
                        My PayPal
                    </a>
                </li>
            </div>
        </div>
        """

        observations = self.scraper.extract_qwasar_project_observations(
            html,
            "student456",
        )

        self.assertEqual(len(observations), 1)
        self.assertEqual(observations[0]["completion_status"], "IN_PROGRESS")
        self.assertEqual(observations[0]["track_user_id"], "1380-student-456")

    def test_extracts_completed_and_in_progress_projects(self):
        html = """
        <div class="col-span-full">
            <h2>Projects Completed</h2>
            <div class="border-b border-slate-800">
                <li class="flex gap-3 px-3 py-2 text-sm">
                    <a href="/tracks/season-01-arc-01/track_users/1203-student-789/projects/my_square">
                        My Square
                    </a>
                </li>
            </div>
        </div>

        <div class="col-span-full">
            <h2>Projects In Progress</h2>
            <div class="border-b border-slate-800">
                <li class="flex gap-3 px-3 py-2 text-sm">
                    <a href="/tracks/season-02-data-science/track_users/1352-student-789/projects/my_m_and_a">
                        My M&A
                    </a>
                </li>
            </div>
        </div>
        """

        observations = self.scraper.extract_qwasar_project_observations(
            html,
            "student789",
        )

        self.assertEqual(len(observations), 2)

        statuses = {
            item["project_slug"]: item["completion_status"]
            for item in observations
        }

        self.assertEqual(statuses["my_square"], "COMPLETED")
        self.assertEqual(statuses["my_m_and_a"], "IN_PROGRESS")

    def test_ignores_links_without_qwasar_project_identity(self):
        html = """
        <div class="col-span-full">
            <h2>Projects Completed</h2>
            <div class="border-b border-slate-800">
                <li class="flex gap-3 px-3 py-2 text-sm">
                    <a href="/users/student123">Profile link</a>
                </li>
            </div>
        </div>
        """

        observations = self.scraper.extract_qwasar_project_observations(
            html,
            "student123",
        )

        self.assertEqual(observations, [])

    def test_removes_duplicate_project_observations(self):
        project = """
        <div class="border-b border-slate-800">
            <li class="flex gap-3 px-3 py-2 text-sm">
                <a href="/tracks/season-01-arc-01/track_users/1203-student-111/projects/my_square">
                    My Square
                </a>
            </li>
        </div>
        """

        html = f"""
        <div class="col-span-full">
            <h2>Projects Completed</h2>
            {project}
            {project}
        </div>
        """

        observations = self.scraper.extract_qwasar_project_observations(
            html,
            "student111",
        )

        self.assertEqual(len(observations), 1)


    def test_extract_student_data_includes_structured_observations(self):
        html = """
        <div class="col-span-full">
            <h2>Projects Completed</h2>
            <div>
                <a href="/tracks/season-02-data-science/track_users/1352-student-222/projects/my_convex_optimization">
                    My Convex Optimization
                </a>
            </div>
        </div>
        """

        legacy_data = {
            "img": "https://example.com/student.png",
            "last_log_in": "October 20, 2026",
            "ongoing_projects": ["My PayPal"],
            "completed_projects": ["My Square"],
            "exercises_completed": "25",
            "points": "150",
            "seasons": {"Season 02": "80%"},
        }

        self.scraper.scrape_data_original = lambda text, student_id: legacy_data

        result = self.scraper.extract_student_data(html, "student222")

        self.assertEqual(len(result["qwasar_project_observations"]), 1)

        observation = result["qwasar_project_observations"][0]
        self.assertEqual(observation["username"], "student222")
        self.assertEqual(observation["project_slug"], "my_convex_optimization")
        self.assertEqual(observation["completion_status"], "COMPLETED")

    def test_extract_student_data_preserves_legacy_fields(self):
        html = """
        <div class="col-span-full">
            <h2>Projects Completed</h2>
            <a href="/tracks/season-02-data-science/track_users/1352-student-333/projects/my_square">
                My Square
            </a>
        </div>
        """

        legacy_data = {
            "img": "https://example.com/student.png",
            "last_log_in": "October 20, 2026",
            "ongoing_projects": ["My PayPal"],
            "completed_projects": ["My Square", "My Convex Optimization"],
            "exercises_completed": "25",
            "points": "150",
            "seasons": {"Season 02": "80%"},
        }

        self.scraper.scrape_data_original = lambda text, student_id: legacy_data

        result = self.scraper.extract_student_data(html, "student333")

        self.assertEqual(result["ongoing_projects"], ["My PayPal"])
        self.assertEqual(
            result["completed_projects"],
            ["My Square", "My Convex Optimization"],
        )
        self.assertEqual(result["season_progress"], {"Season 02": "80%"})
        self.assertEqual(result["exercises_completed"], "25")
        self.assertEqual(result["points"], "150")
        self.assertEqual(result["img_url"], "https://example.com/student.png")
        self.assertEqual(result["last_login"], "October 20, 2026")

        self.assertIn("qwasar_project_observations", result)
        self.assertEqual(
            result["qwasar_project_observations"][0]["project_slug"],
            "my_square",
        )


if __name__ == "__main__":
    unittest.main()
