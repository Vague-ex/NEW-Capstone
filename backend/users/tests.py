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
from .models import AccountStatus, AlumniAccount, FaceScan, EmployerAccount, User
from tracer.models import EmploymentRecord, VerificationDecision, VerificationToken


class AuthDatabaseErrorHandlingTests(SimpleTestCase):
	def setUp(self):
		self.factory = APIRequestFactory()

	@patch("users.api._authenticate_by_email", side_effect=OperationalError("dns lookup failed"))
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

	@patch("users.api._authenticate_by_email", side_effect=OperationalError("dns lookup failed"))
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

	@patch("users.api._authenticate_by_email")
	def test_admin_login_success_still_returns_200(self, mock_authenticate):
		mock_authenticate.return_value = SimpleNamespace(
			id=uuid4(),
			email="admin@example.com",
			role=User.Role.ADMIN,
			is_staff=True,
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
