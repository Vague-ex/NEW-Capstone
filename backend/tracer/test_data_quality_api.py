from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from tracer.models import JobTitle
from tracer.validators import validate_registration_payload
from users.auth import generate_admin_access_token
from users.models import User


class RegistrationGateTests(SimpleTestCase):
    """Registration refuses values that are present but impossible."""

    def test_bad_names_titles_company_and_mobile_block_registration(self):
        result = validate_registration_payload(
            {"employment_status": "employed_full_time", "first_job_title": "Gago", "current_job_company": "123"},
            {"first_name": "Juan2", "middle_name": "Santos", "last_name": "Dela Cruz", "mobile": "12345"},
        )
        self.assertFalse(result["is_valid"])
        for field in ("first_job_title", "current_job_company", "first_name", "mobile"):
            self.assertIn(field, result["field_errors"])
        self.assertNotIn("middle_name", result["field_errors"])

    def test_blank_mobile_and_real_titles_do_not_block(self):
        result = validate_registration_payload(
            {"employment_status": "employed_full_time", "first_job_title": "Security Guard"},
            {"first_name": "Juan", "middle_name": "Ma. Santos", "last_name": "Dela Cruz"},
        )
        for field in ("mobile", "first_job_title", "middle_name"):
            self.assertNotIn(field, result["field_errors"])


class JobTitleAdminApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        admin = User.objects.create_user(
            email="jobtitle-admin@example.com", password="AdminPass123!",
            role=User.Role.ADMIN, is_staff=True,
        )
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {generate_admin_access_token(admin.id)}"}

    def test_vulgar_or_nonsense_titles_are_refused(self):
        before = JobTitle.objects.count()
        for name in ["Gago", "123", "p u t a n g i n a"]:
            response = self.client.post("/api/reference/job-titles/", {"name": name}, format="json", **self.auth)
            self.assertEqual(response.status_code, 400, name)
        self.assertEqual(JobTitle.objects.count(), before)

    def test_new_title_is_classified_on_create(self):
        response = self.client.post(
            "/api/reference/job-titles/", {"name": "Night Security Guard"}, format="json", **self.auth,
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(JobTitle.objects.get(name="Night Security Guard").is_field, JobTitle.ISField.NON_IS)

    def test_unlisted_titles_are_admin_only(self):
        self.assertIn(self.client.get("/api/reference/job-titles/unlisted/").status_code, (401, 403))
        response = self.client.get("/api/reference/job-titles/unlisted/", **self.auth)
        self.assertEqual(response.status_code, 200)
        self.assertIn("unlisted", response.data)

    def test_resolve_rewrites_typed_title_to_listed_one(self):
        from tracer.models import EmploymentProfile, EmploymentRecord
        from users.models import AlumniAccount

        artist = JobTitle.objects.create(name="Artist Resolve Test")
        alumni = AlumniAccount.objects.create(
            user=User.objects.create_user(email="artits@example.com", password="GradPass123!", role=User.Role.ALUMNI),
        )
        EmploymentProfile.objects.create(alumni=alumni, first_job_title="Artits", current_job_title=" artits ")
        record = EmploymentRecord.objects.create(
            alumni=alumni, employer_name_input="Studio", job_title_input="Artits", employment_status="employed",
        )

        payload = {"fixes": [{"title": "Artits", "job_title_id": str(artist.id)}]}
        self.assertIn(
            self.client.post("/api/reference/job-titles/unlisted/resolve/", payload, format="json").status_code, (401, 403),
        )
        response = self.client.post("/api/reference/job-titles/unlisted/resolve/", payload, format="json", **self.auth)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {"graduates": 1, "profiles": 1, "records": 1})

        profile = EmploymentProfile.objects.get(alumni=alumni)
        self.assertEqual((profile.first_job_title, profile.current_job_title), (artist.name, artist.name))
        record.refresh_from_db()
        self.assertEqual((record.job_title_input, record.job_title_id), (artist.name, artist.id))
        titles = [i["title"] for i in self.client.get("/api/reference/job-titles/unlisted/", **self.auth).data["unlisted"]]
        self.assertNotIn("Artits", titles)
