from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import OperationalError
from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory

from .api import AdminLoginView, AlumniLoginView, EmployerLoginView
from .models import User


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
