import json
from types import SimpleNamespace
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.core import signing
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import OperationalError
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework.test import APIRequestFactory

from .api import (
	AdminLoginView,
	AlumniLoginView,
	EmployerLoginView,
	PendingAlumniListView,
)
from .models import AccountStatus, AlumniAccount, FaceScan, EmployerAccount, LoginAudit, User
from .names import derive_last_name
from tracer.models import EmploymentRecord, VerificationDecision, VerificationToken


class AuthDatabaseErrorHandlingTests(TestCase):
	"""
	Was a SimpleTestCase, which forbids database access. That held when the
	tests were written, but login now consults LoginAttemptThrottle before
	authenticating, so every case died on DatabaseOperationForbidden before it
	could assert anything. TestCase gives the throttle a real database while
	the mocks still drive the failure being tested.
	"""

	def setUp(self):
		self.factory = APIRequestFactory()

	@patch("users.api._authenticate_by_email_specific", side_effect=OperationalError("dns lookup failed"))
	def test_admin_login_returns_503_when_database_unavailable(self, _mock_authenticate):
		request = self.factory.post(
			"/api/auth/admin/login/",
			{"email": "admin@example.com", "password": "Password123!"},
			format="json",
		)

		response = AdminLoginView.as_view()(request)

		self.assertEqual(response.status_code, 503)
		self.assertEqual(response.data.get("retryable"), True)

	@patch("users.api._authenticate_by_email", side_effect=OperationalError("dns lookup failed"))
	def test_employer_login_returns_503_when_database_unavailable(self, _mock_authenticate):
		request = self.factory.post(
			"/api/auth/employer/login/",
			{"email": "employer@example.com", "password": "Password123!"},
			format="json",
		)

		response = EmployerLoginView.as_view()(request)

		self.assertEqual(response.status_code, 503)
		self.assertEqual(response.data.get("retryable"), True)

	@patch("users.api._authenticate_by_email_specific", side_effect=OperationalError("dns lookup failed"))
	def test_alumni_login_returns_503_when_database_unavailable(self, _mock_authenticate):
		request = self.factory.post(
			"/api/auth/alumni/login/",
			{
				"email": "alumni@example.com",
				"password": "Password123!",
				"face_scan": SimpleUploadedFile("face.jpg", b"bytes", content_type="image/jpeg"),
			},
			format="multipart",
		)

		response = AlumniLoginView.as_view()(request)

		self.assertEqual(response.status_code, 503)
		self.assertEqual(response.data.get("retryable"), True)

	@patch("users.api._authenticate_by_email_specific")
	def test_admin_login_success_still_returns_200(self, mock_authenticate):
		# _authenticate_by_email_specific returns (user, error), so the mock has
		# to as well — it previously returned a bare object, which the view
		# could not unpack.
		mock_authenticate.return_value = (
			SimpleNamespace(
				id=uuid4(),
				email="admin@example.com",
				role=User.Role.ADMIN,
				is_staff=True,
			),
			None,
		)

		request = self.factory.post(
			"/api/auth/admin/login/",
			{"email": "admin@example.com", "password": "Password123!"},
			format="json",
		)

		response = AdminLoginView.as_view()(request)

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.data["user"]["email"], "admin@example.com")
		self.assertIn("accessToken", response.data)

	def test_pending_alumni_requires_admin_token(self):
		request = self.factory.get("/api/admin/alumni/pending/")

		response = PendingAlumniListView.as_view()(request)

		self.assertEqual(response.status_code, 401)
		self.assertIn("detail", response.data)


class EmployerRegisterContractTests(TestCase):
	def setUp(self):
		self.client = APIClient()

	def test_register_returns_employer_access_token_and_pending_status(self):
		payload = {
			"company_name": "Token Corp",
			"credential_email": "token-corp@example.com",
			"password": "StrongPass123!",
			"confirm_password": "StrongPass123!",
			# industry and contact_name became required after this test was
			# written; the real form (register-employer.tsx) sends both.
			"industry": "IT and BPO",
			"contact_name": "Reggie Cruz",
		}

		response = self.client.post(
			"/api/auth/employer/register/",
			payload,
			format="json",
		)

		self.assertEqual(response.status_code, 201)
		self.assertIn("accessToken", response.data)
		self.assertEqual(response.data.get("tokenType"), "Bearer")
		self.assertIsInstance(response.data.get("expiresIn"), int)
		self.assertGreater(response.data.get("expiresIn"), 0)

		token_payload = signing.loads(
			response.data["accessToken"],
			salt="users.employer.access",
		)
		self.assertEqual(token_payload.get("role"), User.Role.EMPLOYER)

		employer_payload = response.data.get("employer", {})
		self.assertEqual(str(employer_payload.get("status", "")).lower(), "pending")

		employer = EmployerAccount.objects.get(company_email="token-corp@example.com")
		self.assertEqual(employer.account_status, AccountStatus.PENDING)


class EmployerApprovalHoldActivationTests(TestCase):
	def setUp(self):
		self.client = APIClient()

		self.admin_user = User.objects.create_user(
			email="admin@example.com",
			password="AdminPass123!",
			role=User.Role.ADMIN,
			is_staff=True,
		)
		self.admin_token = signing.dumps(
			{"uid": str(self.admin_user.id), "role": User.Role.ADMIN},
			salt="users.admin.access",
		)

		self.pending_employer_user = User.objects.create_user(
			email="pending@example.com",
			password="PendingPass123!",
			role=User.Role.EMPLOYER,
		)
		self.pending_employer = EmployerAccount.objects.create(
			user=self.pending_employer_user,
			company_email="pending@example.com",
			company_name="Pending Corp",
			account_status=AccountStatus.PENDING,
		)

		self.alumni_user = User.objects.create_user(
			email="alumni@example.com",
			password="AlumniPass123!",
			role=User.Role.ALUMNI,
		)
		self.alumni_account = AlumniAccount.objects.create(
			user=self.alumni_user,
			account_status=AccountStatus.ACTIVE,
		)
		self.employment_record = EmploymentRecord.objects.create(
			alumni=self.alumni_account,
			employer_name_input="Pending Corp",
			job_title_input="Systems Analyst",
			employment_status=EmploymentRecord.EmploymentStatus.EMPLOYED,
			verification_status=EmploymentRecord.VerificationStatus.PENDING,
			is_current=True,
		)

		self.token = VerificationToken.objects.create(
			alumni=self.alumni_account,
			employment_record=self.employment_record,
			expires_at=timezone.now() + timedelta(days=7),
			status=VerificationToken.Status.USED,
		)
		self.held_decision = VerificationDecision.objects.create(
			employer_account=self.pending_employer,
			token=self.token,
			verified_employer_name="Pending Corp",
			decision=VerificationDecision.Decision.CONFIRM,
			comment="Queued while pending",
			is_held=True,
		)

	def _admin_headers(self) -> dict:
		return {"HTTP_AUTHORIZATION": f"Bearer {self.admin_token}"}

	def test_approving_employer_activates_held_decision(self):
		response = self.client.post(
			f"/api/admin/employers/requests/{self.pending_employer.id}/approve/",
			format="json",
			**self._admin_headers(),
		)
		self.assertEqual(response.status_code, 200)

		self.held_decision.refresh_from_db()
		self.assertFalse(self.held_decision.is_held)
		self.assertIsNotNone(self.held_decision.held_activated_at)

		self.employment_record.refresh_from_db()
		self.assertEqual(
			self.employment_record.verification_status,
			EmploymentRecord.VerificationStatus.VERIFIED,
		)
		self.assertEqual(self.employment_record.employer_account_id, self.pending_employer.id)

	def test_verified_alumni_payload_includes_face_gps_coordinates(self):
		FaceScan.objects.create(
			alumni=self.alumni_account,
			scan_type="face_front",
			url="https://example.com/front.jpg",
			gps_lat="10.720200",
			gps_lng="122.562100",
		)

		response = self.client.get(
			"/api/admin/alumni/verified/",
			**self._admin_headers(),
		)
		self.assertEqual(response.status_code, 200)

		results = response.data.get("results", [])
		self.assertEqual(len(results), 1)
		self.assertAlmostEqual(results[0].get("lat"), 10.7202, places=4)
		self.assertAlmostEqual(results[0].get("lng"), 122.5621, places=4)


class EmployerStatusAndLoginMetadataTests(TestCase):
	def setUp(self):
		self.client = APIClient()

		self.admin_user = User.objects.create_user(
			email="admin-meta@example.com",
			password="AdminPass123!",
			role=User.Role.ADMIN,
			is_staff=True,
		)

		self.employer_user = User.objects.create_user(
			email="employer-meta@example.com",
			password="EmployerPass123!",
			role=User.Role.EMPLOYER,
		)
		self.employer_account = EmployerAccount.objects.create(
			user=self.employer_user,
			company_email="employer-meta@example.com",
			company_name="Status Sync Corp",
			account_status=AccountStatus.PENDING,
		)

		self.alumni_user = User.objects.create_user(
			email="alumni-meta@example.com",
			password="AlumniPass123!",
			role=User.Role.ALUMNI,
		)
		self.alumni_account = AlumniAccount.objects.create(
			user=self.alumni_user,
			account_status=AccountStatus.ACTIVE,
		)

	def test_admin_login_updates_last_login(self):
		self.assertIsNone(self.admin_user.last_login)

		response = self.client.post(
			"/api/auth/admin/login/",
			{"email": "admin-meta@example.com", "password": "AdminPass123!"},
			format="json",
		)

		self.assertEqual(response.status_code, 200)
		self.admin_user.refresh_from_db()
		self.assertIsNotNone(self.admin_user.last_login)

	def test_employer_login_updates_last_login(self):
		self.assertIsNone(self.employer_user.last_login)

		response = self.client.post(
			"/api/auth/employer/login/",
			{"email": "employer-meta@example.com", "password": "EmployerPass123!"},
			format="json",
		)

		self.assertEqual(response.status_code, 200)
		self.employer_user.refresh_from_db()
		self.assertIsNotNone(self.employer_user.last_login)

	@patch("users.api.upload_image_bytes", return_value="https://example.com/login-scan.jpg")
	def test_alumni_login_updates_last_login_and_creates_audit(self, _mock_upload):
		self.assertIsNone(self.alumni_user.last_login)

		# Graduate login is gated on an enrolled face reference, so the account
		# needs one — without it the view correctly refuses with 403 and the
		# audit path under test is never reached. The descriptor is compared
		# against the one the client submits, so enrolling and presenting the
		# same vector exercises the match without needing face-api in tests.
		descriptor = [0.01 * (i % 7) for i in range(128)]
		self.alumni_account.biometric_template = json.dumps({
			"face_descriptor": descriptor,
			"registration_face_scans": {"face_front": "https://example.com/front.jpg"},
		})
		self.alumni_account.save(update_fields=["biometric_template"])

		response = self.client.post(
			"/api/auth/alumni/login/",
			{
				"email": "alumni-meta@example.com",
				"password": "AlumniPass123!",
				"face_descriptor": json.dumps(descriptor),
				"face_scan": SimpleUploadedFile(
					"face.jpg",
					b"image-bytes",
					content_type="image/jpeg",
				),
			},
			format="multipart",
		)

		self.assertEqual(response.status_code, 200)
		self.alumni_user.refresh_from_db()
		self.assertIsNotNone(self.alumni_user.last_login)
		self.assertEqual(LoginAudit.objects.filter(alumni=self.alumni_account).count(), 1)

	def test_employer_account_status_endpoint_reflects_admin_approval(self):
		token = signing.dumps(
			{"uid": str(self.employer_user.id), "role": User.Role.EMPLOYER},
			salt="users.employer.access",
		)
		headers = {"HTTP_AUTHORIZATION": f"Bearer {token}"}

		pending_response = self.client.get(
			f"/api/auth/employer/account/{self.employer_account.id}/",
			**headers,
		)
		self.assertEqual(pending_response.status_code, 200)
		self.assertEqual(
			str(pending_response.data.get("employer", {}).get("status", "")).lower(),
			"pending",
		)

		self.employer_account.account_status = AccountStatus.ACTIVE
		self.employer_account.save(update_fields=["account_status", "updated_at"])

		approved_response = self.client.get(
			f"/api/auth/employer/account/{self.employer_account.id}/",
			**headers,
		)
		self.assertEqual(approved_response.status_code, 200)
		self.assertEqual(
			str(approved_response.data.get("employer", {}).get("status", "")).lower(),
			"approved",
		)


class MasterlistNameParsingTests(SimpleTestCase):
	"""
	Registration rejects a graduate whose submitted family name does not equal
	GraduateMasterRecord.last_name, so a mis-parsed surname locks a real person
	out of the system entirely. These cases are the shapes that actually occur
	in the registrar's exports.
	"""

	def test_generational_suffix_does_not_become_the_surname(self):
		self.assertEqual(derive_last_name("Rolly Lerit Samson Jr."), "Samson")
		self.assertEqual(derive_last_name("Jose Rizal Jr"), "Rizal")
		self.assertEqual(derive_last_name("Pedro Penduko Sr."), "Penduko")

	def test_compound_surname_particles_are_kept(self):
		self.assertEqual(derive_last_name("Jose Dela Cruz"), "Dela Cruz")
		self.assertEqual(derive_last_name("Regie Calago De La Torre"), "De La Torre")
		self.assertEqual(derive_last_name("Sarah Joy De Los Santos"), "De Los Santos")
		self.assertEqual(derive_last_name("Luis Del Rosario"), "Del Rosario")

	def test_suffix_and_particle_together(self):
		self.assertEqual(derive_last_name("Juan Dela Cruz III"), "Dela Cruz")

	def test_comma_format_is_read_surname_first(self):
		self.assertEqual(derive_last_name("Samson, Rolly Lerit"), "Samson")
		self.assertEqual(derive_last_name("Dela Cruz, Juan"), "Dela Cruz")

	def test_ordinary_and_degenerate_names(self):
		self.assertEqual(derive_last_name("Maria Santos"), "Santos")
		self.assertEqual(derive_last_name("  Ana   Marie   Reyes  "), "Reyes")
		self.assertEqual(derive_last_name("Madonna"), "Madonna")
		self.assertEqual(derive_last_name(""), "")
		# Never consume the only given name.
		self.assertEqual(derive_last_name("Dela Cruz"), "Cruz")


class RegistrationCleanDataGateTests(TestCase):
	"""
	The clean-data gate on AlumniRegisterView.

	It runs before the Supabase upload and before any row is written, so a
	rejection leaves no orphaned image and no half-built account — and the
	response carries enough for the client to return the graduate to the form
	that owns the bad answer instead of restarting registration.
	"""

	def setUp(self):
		self.client = APIClient()

	def _payload(self, **survey_overrides):
		survey = {
			"employment_status": "employed_full_time",
			"academic_honors": 1,
			"time_to_hire_months": 3,
			"first_job_sector": "private",
		}
		survey.update(survey_overrides)
		return {
			"email": "gate-test@example.com",
			"password": "StrongPass123!",
			"confirm_password": "StrongPass123!",
			"first_name": "Ana",
			"family_name": "Reyes",
			"gender": "Female",
			"birth_date": "2000-05",
			"mobile": "+639171234567",
			"city": "Talisay",
			"province": "Negros Occidental",
			"graduation_date": "2022-06",
			"survey_data": json.dumps(survey),
			"face_front": SimpleUploadedFile("face.jpg", b"image-bytes", content_type="image/jpeg"),
		}

	def test_impossible_answer_is_rejected_with_field_and_step(self):
		response = self.client.post(
			"/api/auth/alumni/register/",
			self._payload(time_to_hire_months=-5),
			format="multipart",
		)

		self.assertEqual(response.status_code, 400)
		self.assertIn("time_to_hire_months", response.data["field_errors"])
		# The client needs to know WHICH form owns the problem.
		self.assertEqual(response.data["step"], "employment")

	def test_rejection_creates_no_account(self):
		self.client.post(
			"/api/auth/alumni/register/",
			self._payload(employment_status="banana"),
			format="multipart",
		)
		# Nothing may survive a refused registration — not the user, not the
		# account. The gate runs before any write for exactly this reason.
		self.assertFalse(User.objects.filter(email="gate-test@example.com").exists())
		self.assertEqual(AlumniAccount.objects.count(), 0)
