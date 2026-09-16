import json
import os
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
from users import api
from users import face_engines
from users.auth import generate_admin_access_token, generate_alumni_access_token
from rest_framework.test import APIRequestFactory

from .api import (
	AdminLoginView,
	AlumniLoginView,
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

class AlumniAccountStatusAuthTests(TestCase):
	"""
	GET /api/auth/alumni/account/<id>/ returns _session_payload_from_alumni —
	the same object issued on login, carrying the graduate's name and their
	whole survey_data. It shipped unauthenticated, so anyone holding an alumni
	UUID could read that record without signing in, while the POST on the very
	same view was guarded. These tests keep the two halves in step.
	"""

	def setUp(self):
		self.client = APIClient()
		self.user = User.objects.create_user(
			email="status-owner@example.com", password="OwnerPass123!", role=User.Role.ALUMNI,
		)
		self.account = AlumniAccount.objects.create(
			user=self.user, account_status=AccountStatus.ACTIVE,
		)

	def _url(self):
		return f"/api/auth/alumni/account/{self.account.id}/"

	def test_anonymous_cannot_read_a_graduate_record(self):
		response = self.client.get(self._url())
		self.assertIn(response.status_code, (401, 403))

	def test_owner_can_read_their_own_record(self):
		response = self.client.get(
			self._url(),
			HTTP_AUTHORIZATION=f"Bearer {generate_alumni_access_token(self.user.id)}",
		)
		self.assertEqual(response.status_code, 200)

	def test_another_graduate_cannot_read_it(self):
		other = User.objects.create_user(
			email="status-other@example.com", password="OtherPass123!", role=User.Role.ALUMNI,
		)
		AlumniAccount.objects.create(user=other, account_status=AccountStatus.ACTIVE)
		response = self.client.get(
			self._url(),
			HTTP_AUTHORIZATION=f"Bearer {generate_alumni_access_token(other.id)}",
		)
		self.assertEqual(response.status_code, 403)


# region DEBUG-ONLY:CurrenChanDebug
class DebugFaceHarnessTests(TestCase):
	"""
	Covers the /admin/debug/face backend. Remove together with the endpoints.

	The point of the harness is that it reports the SAME distance production
	would, so the test asserts on real comparison behaviour rather than on the
	endpoint merely returning 200.
	"""

	def setUp(self):
		self.client = APIClient()
		self.admin_user = User.objects.create_user(
			email="debugface-admin@example.com", password="AdminPass123!",
			role=User.Role.ADMIN, is_staff=True,
		)

	def _auth(self):
		return {"HTTP_AUTHORIZATION": f"Bearer {generate_admin_access_token(self.admin_user.id)}"}

	def _create(self):
		return self.client.post("/api/admin/debug/face-account/", {}, format="json", **self._auth())

	def test_endpoints_require_admin(self):
		self.assertIn(self.client.post("/api/admin/debug/face-account/", {}, format="json").status_code, (401, 403))
		self.assertIn(self.client.delete("/api/admin/debug/face-account/").status_code, (401, 403))

	def test_create_enrol_and_verify_round_trip(self):
		created = self._create()
		self.assertEqual(created.status_code, 201)
		account_id = created.data["id"]
		self.assertTrue(created.data["email"].endswith("@debug.local"))

		# Verifying before enrolment must not silently "pass".
		descriptor = [0.01 * i for i in range(128)]
		early = self.client.post(
			f"/api/admin/debug/face-account/{account_id}/verify/",
			{"face_descriptor": descriptor}, format="json", **self._auth(),
		)
		self.assertEqual(early.status_code, 409)

		enrol = self.client.post(
			f"/api/admin/debug/face-account/{account_id}/enrol/",
			{"face_descriptor": descriptor, "face_descriptor_samples": [descriptor]},
			format="json", **self._auth(),
		)
		self.assertEqual(enrol.status_code, 200)
		self.assertEqual(enrol.data["dimensions"], 128)

		same = self.client.post(
			f"/api/admin/debug/face-account/{account_id}/verify/",
			{"face_descriptor": descriptor}, format="json", **self._auth(),
		)
		self.assertEqual(same.status_code, 200)
		self.assertTrue(same.data["isMatch"])
		self.assertAlmostEqual(same.data["distance"], 0.0, places=3)

		# A clearly different vector must fall outside the threshold.
		other = [1.0 - 0.01 * i for i in range(128)]
		diff = self.client.post(
			f"/api/admin/debug/face-account/{account_id}/verify/",
			{"face_descriptor": other}, format="json", **self._auth(),
		)
		self.assertEqual(diff.status_code, 200)
		self.assertFalse(diff.data["isMatch"])
		self.assertGreater(diff.data["distance"], diff.data["threshold"])

	def test_engines_endpoint_lists_all_three(self):
		response = self.client.get("/api/admin/debug/face-engines/", **self._auth())
		self.assertEqual(response.status_code, 200)
		names = [e["name"] for e in response.data["engines"]]
		self.assertEqual(sorted(names), ["compreface", "faceapi", "insightface"])
		# faceapi runs in the browser, so it is usable with nothing installed.
		faceapi = next(e for e in response.data["engines"] if e["name"] == "faceapi")
		self.assertTrue(faceapi["available"])
		self.assertTrue(faceapi["runsInBrowser"])
		self.assertEqual(faceapi["dimensions"], 128)
		self.assertEqual(faceapi["metric"], "euclidean")
		# The server-side ones report a reason when they cannot be used, so the
		# selector can say what is missing instead of failing on click.
		for name in ("insightface", "compreface"):
			row = next(e for e in response.data["engines"] if e["name"] == name)
			self.assertEqual(row["dimensions"], 512)
			self.assertEqual(row["metric"], "cosine")
			self.assertFalse(row["runsInBrowser"])
			if not row["available"]:
				self.assertTrue(row["reason"])

	def test_engines_endpoint_requires_admin(self):
		self.assertIn(self.client.get("/api/admin/debug/face-engines/").status_code, (401, 403))

	def test_unknown_engine_is_rejected(self):
		account_id = self._create().data["id"]
		response = self.client.post(
			f"/api/admin/debug/face-account/{account_id}/enrol/",
			{"engine": "not-real", "face_descriptor": json.dumps([0.0] * 128)},
			**self._auth(),
		)
		self.assertEqual(response.status_code, 400)

	def test_templates_are_isolated_per_engine(self):
		"""
		Enrolling under one engine must not make another engine look enrolled.

		This is what lets the same face be enrolled under all three and compared;
		it is also the guard against reading a 128-d template as if it were a
		512-d one.
		"""
		account_id = self._create().data["id"]
		descriptor = [0.02 * i for i in range(128)]
		enrol = self.client.post(
			f"/api/admin/debug/face-account/{account_id}/enrol/",
			{"engine": "faceapi", "face_descriptor": json.dumps(descriptor)},
			**self._auth(),
		)
		self.assertEqual(enrol.status_code, 200)
		self.assertEqual(enrol.data["engine"], "faceapi")
		self.assertEqual(enrol.data["enrolledEngines"], ["faceapi"])

		# The same account has nothing under insightface.
		other = self.client.post(
			f"/api/admin/debug/face-account/{account_id}/verify/",
			{"engine": "insightface", "face_descriptor": json.dumps(descriptor)},
			**self._auth(),
		)
		self.assertEqual(other.status_code, 409)

		# ...while faceapi still matches itself, and says which engine it used.
		same = self.client.post(
			f"/api/admin/debug/face-account/{account_id}/verify/",
			{"engine": "faceapi", "face_descriptor": json.dumps(descriptor)},
			**self._auth(),
		)
		self.assertEqual(same.status_code, 200)
		self.assertTrue(same.data["isMatch"])
		self.assertEqual(same.data["engine"], "faceapi")
		self.assertEqual(same.data["metric"], "euclidean")

	def test_server_side_engine_will_not_accept_a_browser_descriptor(self):
		"""
		A 128-d face-api vector must never be enrolled as a 512-d ArcFace one
		just because the client sent it. Without the image there is nothing to
		embed, so this has to fail rather than store the wrong thing.
		"""
		account_id = self._create().data["id"]
		response = self.client.post(
			f"/api/admin/debug/face-account/{account_id}/enrol/",
			{"engine": "insightface", "face_descriptor": json.dumps([0.5] * 128)},
			**self._auth(),
		)
		# 400 when the engine is importable but has no image; 503 when the
		# optional dependency is absent. Either way, nothing is stored.
		self.assertIn(response.status_code, (400, 503))
		verify = self.client.post(
			f"/api/admin/debug/face-account/{account_id}/verify/",
			{"engine": "insightface", "face_descriptor": json.dumps([0.5] * 128)},
			**self._auth(),
		)
		self.assertEqual(verify.status_code, 409)

	def test_verify_reads_the_same_image_field_the_client_sends(self):
		"""
		Regression: the client sends `face_images` (plural) since enrolment
		became multi-frame, but verify read only the old singular `face_image`
		and therefore received NO image at all.

		This was invisible from the face-api side, because that engine uses the
		client descriptor and never looks at the image -- so one engine kept
		working while every server-side engine reported "no usable embedding".
		The assertion is on framesSupplied rather than the message, because that
		counts what the view actually received.
		"""
		from users.face_engines.insight import InsightFaceEngine

		account_id = self._create().data["id"]
		vector = [0.0] * 511 + [1.0]
		frame = SimpleUploadedFile("face_0.jpg", b"not-a-real-jpeg", content_type="image/jpeg")

		# Enrol with the model stubbed out; the point here is the plumbing, and
		# a real embed would download a model pack mid-test.
		with patch.object(InsightFaceEngine, "embed", return_value=vector):
			enrol = self.client.post(
				f"/api/admin/debug/face-account/{account_id}/enrol/",
				{"engine": "insightface", "face_images": frame},
				format="multipart", **self._auth(),
			)
		self.assertEqual(enrol.status_code, 200)
		self.assertEqual(enrol.data["framesSupplied"], 1)
		self.assertEqual(enrol.data["framesUsed"], 1)

		# Now verify. With embed returning nothing we get the 400, but the count
		# proves the frame reached the view instead of being dropped by a
		# field-name mismatch.
		frame2 = SimpleUploadedFile("face_0.jpg", b"not-a-real-jpeg", content_type="image/jpeg")
		with patch.object(InsightFaceEngine, "embed", return_value=None):
			verify = self.client.post(
				f"/api/admin/debug/face-account/{account_id}/verify/",
				{"engine": "insightface", "face_images": frame2},
				format="multipart", **self._auth(),
			)
		self.assertEqual(verify.status_code, 400)
		self.assertEqual(verify.data["framesSupplied"], 1)
		self.assertNotIn("no frame was uploaded", verify.data["detail"])

	def test_enrol_keeps_every_usable_pose_from_a_sweep(self):
		"""Multi-angle enrolment must store one sample per usable frame."""
		from users.face_engines.insight import InsightFaceEngine

		account_id = self._create().data["id"]
		frames = [
			SimpleUploadedFile(f"face_{i}.jpg", b"x", content_type="image/jpeg")
			for i in range(5)
		]
		vector = [0.0] * 511 + [1.0]
		with patch.object(InsightFaceEngine, "embed", return_value=vector):
			enrol = self.client.post(
				f"/api/admin/debug/face-account/{account_id}/enrol/",
				{"engine": "insightface", "face_images": frames},
				format="multipart", **self._auth(),
			)
		self.assertEqual(enrol.status_code, 200)
		self.assertEqual(enrol.data["framesSupplied"], 5)
		self.assertEqual(enrol.data["framesUsed"], 5)
		self.assertEqual(enrol.data["samples"], 5)

	def test_enrol_refuses_a_non_debug_account(self):
		"""A debug tool must never be able to overwrite a real graduate's face."""
		victim_user = User.objects.create_user(
			email="real.graduate@example.com", password="RealPass123!", role=User.Role.ALUMNI,
		)
		victim = AlumniAccount.objects.create(user=victim_user, account_status=AccountStatus.ACTIVE)
		response = self.client.post(
			f"/api/admin/debug/face-account/{victim.id}/enrol/",
			{"face_descriptor": [0.0] * 128}, format="json", **self._auth(),
		)
		self.assertEqual(response.status_code, 403)

	def test_purge_only_removes_debug_accounts(self):
		self._create()
		keep_user = User.objects.create_user(
			email="keep.me@example.com", password="KeepPass123!", role=User.Role.ALUMNI,
		)
		AlumniAccount.objects.create(user=keep_user, account_status=AccountStatus.ACTIVE)

		response = self.client.delete("/api/admin/debug/face-account/", **self._auth())
		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.data["deleted"], 1)
		self.assertTrue(AlumniAccount.objects.filter(user__email="keep.me@example.com").exists())
		self.assertFalse(AlumniAccount.objects.filter(user__email__endswith="@debug.local").exists())


# endregion DEBUG-ONLY:CurrenChanDebug


class FaceReEnrolmentTests(TestCase):
	"""
	An account whose template is unusable must be able to recover by capturing a
	new face, not be locked out.

	Before this, an engine switch returned a 409 the graduate could do nothing
	about, and a cleared template fell through to the raw-pixel image fallback --
	the weakest check in the system.
	"""

	def setUp(self):
		self.client = APIClient()
		self.password = "GraduatePass123!"
		self.user = User.objects.create_user(
			email="reenrol@example.com", password=self.password, role=User.Role.ALUMNI,
		)
		self.account = AlumniAccount.objects.create(
			user=self.user, account_status=AccountStatus.ACTIVE,
		)

	def _login(self):
		"""Login sends multipart with a face scan; the payload shape matters."""
		return self.client.post(
			"/api/auth/alumni/login/",
			{
				"email": self.user.email,
				"password": self.password,
				"face_scan": SimpleUploadedFile("s.jpg", b"x", content_type="image/jpeg"),
			},
			format="multipart",
		)

	def _set_template(self, template):
		self.account.biometric_template = json.dumps(template)
		self.account.save(update_fields=["biometric_template"])

	def test_no_enrolment_asks_for_a_face_instead_of_refusing(self):
		self._set_template({})
		response = self._login()
		self.assertEqual(response.status_code, 409)
		self.assertTrue(response.data["faceEnrolmentRequired"])
		self.assertEqual(response.data["reason"], "not_enrolled")
		# A token is issued so the graduate can actually act on it -- a face
		# cannot authorise replacing itself.
		self.assertTrue(response.data["accessToken"])

	def test_engine_mismatch_asks_for_a_face_rather_than_dead_ending(self):
		self._set_template({
			"face_descriptor": [0.01 * i for i in range(128)],
			"engine": "insightface",
		})
		response = self._login()
		self.assertEqual(response.status_code, 409)
		self.assertTrue(response.data["faceEnrolmentRequired"])
		self.assertEqual(response.data["reason"], "engine_changed")
		self.assertEqual(response.data["storedEngine"], "insightface")
		self.assertEqual(response.data["activeEngine"], "faceapi")

	def test_cleared_template_never_reaches_the_pixel_fallback(self):
		"""
		The dangerous path: descriptors gone but scan URLs left behind used to
		route login into raw-pixel comparison, which cannot tell people apart.
		"""
		self._set_template({
			"registration_face_scans": {"face_front": "https://example.test/f.jpg"},
		})
		response = self._login()
		self.assertEqual(response.status_code, 409)
		self.assertTrue(response.data["faceEnrolmentRequired"])

	def test_enrol_requires_authentication(self):
		response = self.client.post(
			"/api/auth/alumni/face/enrol/",
			{"face_images": SimpleUploadedFile("f.jpg", b"x", content_type="image/jpeg")},
			format="multipart",
		)
		self.assertIn(response.status_code, (401, 403))

	def test_enrol_stores_a_template_and_unblocks_login(self):
		self._set_template({"profile": {"survey_data": {"keep": "me"}}})
		token = generate_alumni_access_token(self.user.id)
		descriptor = [0.02 * i for i in range(128)]

		with patch("users.api.upload_image_bytes", return_value="https://example.test/x.jpg"):
			response = self.client.post(
				"/api/auth/alumni/face/enrol/",
				{
					"face_images": SimpleUploadedFile("f.jpg", b"x", content_type="image/jpeg"),
					"face_descriptor": json.dumps(descriptor),
					"face_descriptor_samples": json.dumps([descriptor]),
				},
				format="multipart",
				HTTP_AUTHORIZATION=f"Bearer {token}",
			)
		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.data["engine"], "faceapi")

		self.account.refresh_from_db()
		stored = json.loads(self.account.biometric_template)
		self.assertEqual(stored["engine"], "faceapi")
		# Not bit-identical: engine.average round-trips through float32, which is
		# the same precision the browser produces descriptors at anyway. Assert
		# on what actually matters -- that the stored vector still matches the
		# face it was built from.
		self.assertEqual(len(stored["face_descriptor"]), 128)
		engine = face_engines.engine_for("faceapi")
		self.assertLess(engine.distance(stored["face_descriptor"], descriptor), 1e-3)
		# Survey data lives in the same blob and must survive enrolment.
		self.assertEqual(stored["profile"]["survey_data"]["keep"], "me")

	def test_reset_command_clears_faces_but_keeps_survey_data(self):
		from django.core.management import call_command

		self._set_template({
			"face_descriptor": [0.0] * 128,
			"face_descriptor_samples": [[0.0] * 128],
			"engine": "faceapi",
			"registration_face_scans": {"face_front": "https://example.test/f.jpg"},
			"profile": {"survey_data": {"keep": "me"}, "graduation_year": 2024},
		})
		self.account.face_photo_url = "https://example.test/f.jpg"
		self.account.save(update_fields=["face_photo_url"])

		# Dry run must change nothing.
		call_command("reset_face_enrolment", email=self.user.email)
		self.account.refresh_from_db()
		self.assertIn("face_descriptor", json.loads(self.account.biometric_template))

		call_command("reset_face_enrolment", email=self.user.email, confirm=True)
		self.account.refresh_from_db()
		stored = json.loads(self.account.biometric_template)
		for key in ("face_descriptor", "face_descriptor_samples", "engine", "registration_face_scans"):
			self.assertNotIn(key, stored)
		self.assertEqual(self.account.face_photo_url, "")
		# The half that is not biometric must be untouched.
		self.assertEqual(stored["profile"]["survey_data"]["keep"], "me")
		self.assertEqual(stored["profile"]["graduation_year"], 2024)


class FaceEngineSeamTests(TestCase):
	"""
	The engine seam must be invisible until someone deliberately changes engine.

	Every account enrolled before the seam existed carries no engine marker and
	was produced by face-api, so those rows have to keep authenticating exactly
	as they did.
	"""

	def setUp(self):
		self.user = User.objects.create_user(
			email="engine-seam@example.com", password="SeamPass123!", role=User.Role.ALUMNI,
		)
		self.account = AlumniAccount.objects.create(
			user=self.user, account_status=AccountStatus.ACTIVE,
		)

	def _enrol(self, descriptor, engine=None):
		template = {"face_descriptor": descriptor, "face_descriptor_samples": [descriptor]}
		if engine is not None:
			template["engine"] = engine
		self.account.biometric_template = json.dumps(template)
		self.account.save(update_fields=["biometric_template"])

	def test_default_engine_is_faceapi(self):
		self.assertEqual(face_engines.get_engine().name, "faceapi")
		self.assertEqual(face_engines.get_engine().dimensions, 128)

	def test_unknown_engine_name_is_rejected(self):
		with self.assertRaises(ValueError):
			face_engines.engine_for("not-a-real-engine")

	def test_legacy_rows_without_an_engine_marker_still_resolve(self):
		"""The 128-d rows enrolled before the seam must keep working untouched."""
		descriptor = [0.01 * i for i in range(128)]
		self._enrol(descriptor)  # no engine key, exactly like existing rows
		self.assertEqual(api._stored_template_engine(self.account), "faceapi")
		self.assertEqual(len(api._resolve_reference_descriptors(self.account)), 1)

	def test_mismatched_engine_yields_no_references(self):
		"""
		Cross-engine comparison must fail closed rather than produce a number.

		A 128-d vector measured against a 512-d probe is not a wrong distance,
		it is a meaningless one, and the threshold would accept or reject it
		essentially at random.
		"""
		descriptor = [0.01 * i for i in range(128)]
		self._enrol(descriptor, engine="insightface")
		# Active engine is still faceapi, so the stored template is unusable.
		self.assertEqual(api._stored_template_engine(self.account), "insightface")
		self.assertEqual(api._resolve_reference_descriptors(self.account), [])

	def test_engine_switch_invalidates_legacy_templates(self):
		descriptor = [0.01 * i for i in range(128)]
		self._enrol(descriptor)  # faceapi
		with patch.dict(os.environ, {"FACE_ENGINE": "insightface"}):
			self.assertEqual(face_engines.get_engine().name, "insightface")
			self.assertEqual(api._resolve_reference_descriptors(self.account), [])
		# ...and comes back once the engine is restored.
		self.assertEqual(len(api._resolve_reference_descriptors(self.account)), 1)


class FaceEngineMetricTests(SimpleTestCase):
	"""Per-engine maths. No database, no models on disk."""

	def test_faceapi_uses_euclidean_distance(self):
		engine = face_engines.engine_for("faceapi")
		a = [0.0] * 128
		b = [0.0] * 128
		b[0] = 3.0
		b[1] = 4.0
		self.assertAlmostEqual(engine.distance(a, b), 5.0, places=5)
		self.assertTrue(engine.is_match(0.0))
		self.assertFalse(engine.is_match(0.9))

	def test_cosine_engines_are_orientation_only(self):
		"""Scaling a vector must not change a cosine distance."""
		engine = face_engines.engine_for("insightface")
		a = [1.0] + [0.0] * 511
		self.assertAlmostEqual(engine.distance(a, a), 0.0, places=6)
		scaled = [v * 7.5 for v in a]
		self.assertAlmostEqual(engine.distance(a, scaled), 0.0, places=6)
		orthogonal = [0.0, 1.0] + [0.0] * 510
		self.assertAlmostEqual(engine.distance(a, orthogonal), 1.0, places=6)

	def test_cosine_engine_renormalises_averages(self):
		"""The mean of unit vectors is not a unit vector; cosine assumes one."""
		engine = face_engines.engine_for("insightface")
		a = [1.0] + [0.0] * 511
		b = [0.0, 1.0] + [0.0] * 510
		mean = engine.average([a, b])
		self.assertIsNotNone(mean)
		norm = sum(v * v for v in mean) ** 0.5
		self.assertAlmostEqual(norm, 1.0, places=5)

	def test_wrong_dimensionality_is_uncomparable_not_close(self):
		engine = face_engines.engine_for("faceapi")
		self.assertEqual(
			engine.distance([0.0] * 64, [0.0] * 64), face_engines.UNCOMPARABLE_DISTANCE
		)
		self.assertFalse(engine.is_match(face_engines.UNCOMPARABLE_DISTANCE))

	def test_server_side_engines_ignore_a_client_descriptor(self):
		"""
		A browser-produced face-api vector must never be enrolled under a
		512-d engine just because the client sent one.
		"""
		client_vector = [0.5] * 128
		for name in ("insightface", "compreface"):
			engine = face_engines.engine_for(name)
			self.assertIsNone(engine.embed(client_descriptor=client_vector))
			self.assertFalse(engine.requires_client_descriptor)

	def test_faceapi_engine_requires_the_client_descriptor(self):
		engine = face_engines.engine_for("faceapi")
		self.assertTrue(engine.requires_client_descriptor)
		self.assertIsNone(engine.embed(image_bytes=b"ignored"))
		good = [0.1] * 128
		self.assertEqual(engine.embed(client_descriptor=good), good)


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


class MasterlistRowValidationTests(SimpleTestCase):
	"""
	An analytics report CSV uploaded through Batch Upload once saved rows such
	as "Avg Time-to-Hire (mo)" / batch 2, "2021" / batch 6 and "Total" / batch
	33. These are the shapes the bulk-create endpoint must now refuse.
	"""

	def test_report_labels_are_not_full_names(self):
		for junk in ["2021", "Total", "Metric", "(mo)", "12 34"]:
			self.assertFalse(api._looks_like_full_name(junk), junk)

	def test_real_names_pass(self):
		for name in ["Juan Dela Cruz", "Aira Sofia Marie Caguioa Guacena", "Ma. Ñiña Reyes"]:
			self.assertTrue(api._looks_like_full_name(name), name)

	def test_year_window(self):
		self.assertEqual(api.MASTERLIST_MIN_YEAR, 2000)
		self.assertEqual(api._masterlist_max_year(), timezone.now().year + 1)


class MasterlistBulkCreateValidationTests(TestCase):
	"""The endpoint itself refuses report rows, even if a client skips its own checks."""

	def setUp(self):
		self.client = APIClient()
		self.admin_user = User.objects.create_user(
			email="masterlist-admin@example.com", password="AdminPass123!",
			role=User.Role.ADMIN, is_staff=True,
		)

	def _post(self, entries):
		return self.client.post(
			"/api/admin/masterlist/bulk-create/",
			{"entries": entries},
			format="json",
			HTTP_AUTHORIZATION=f"Bearer {generate_admin_access_token(self.admin_user.id)}",
		)

	def test_one_bad_row_refuses_the_whole_upload(self):
		from .models import GraduateMasterRecord

		year = timezone.now().year
		response = self._post([
			{"name": "Avg Time-to-Hire (mo)", "graduation_year": 2},
			{"name": "2021", "graduation_year": 6},
			{"name": "Total", "graduation_year": 33},
			{"name": "Metric", "graduation_year": 2021},
			{"name": "Pedro Santos", "graduation_year": year + 5},
			{"name": "Juan Dela Cruz", "graduation_year": 2024},
		])
		self.assertEqual(response.status_code, 400)
		self.assertEqual(response.data["invalid"], 5)
		self.assertIn("nothing was saved", response.data["detail"])
		self.assertFalse(GraduateMasterRecord.objects.exists())

	def test_duplicate_rows_in_one_upload_are_refused(self):
		from .models import GraduateMasterRecord

		response = self._post([
			{"name": "Juan Dela Cruz", "graduation_year": 2024},
			{"name": "juan  dela cruz", "graduation_year": 2024},
		])
		self.assertEqual(response.status_code, 400)
		self.assertFalse(GraduateMasterRecord.objects.exists())

	def test_clean_upload_is_saved(self):
		from .models import GraduateMasterRecord

		response = self._post([
			{"name": "Juan Dela Cruz", "graduation_year": 2024},
			{"name": "Maria Santos Reyes", "graduation_year": 2025},
		])
		self.assertEqual(response.status_code, 201)
		self.assertEqual(response.data["created"], 2)
		self.assertEqual(GraduateMasterRecord.objects.count(), 2)


class _InlineThread:
	"""threading.Thread stand-in that runs its target on start(), so a
	fire-and-forget send can be asserted on without racing the thread."""

	def __init__(self, target=None, daemon=None, **kwargs):
		self._target = target

	def start(self):
		if self._target:
			self._target()


class GraduateApprovalEmailTests(TestCase):
	"""
	Approving a graduate emails them.

	Registration no longer hands the graduate a session or a "go to dashboard"
	button -- it tells them to wait for this email. So the email is the only way
	they learn they can sign in, and it has to carry a working link.
	"""

	def setUp(self):
		self.admin_user = User.objects.create_user(
			email="approver@example.com", password="AdminPass123!",
			role=User.Role.ADMIN, is_staff=True,
		)
		self.graduate = User.objects.create_user(
			email="approved-grad@example.com", password="GradPass123!", role=User.Role.ALUMNI,
		)
		self.account = AlumniAccount.objects.create(
			user=self.graduate, account_status=AccountStatus.PENDING,
		)

	def _approve(self):
		request = APIRequestFactory().post(
			f"/api/admin/alumni/{self.account.id}/approve/", {}, format="json",
			HTTP_AUTHORIZATION=f"Bearer {generate_admin_access_token(self.admin_user.id)}",
		)
		with self.settings(
			RESEND_API_KEY="",
			EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
			GRADUATE_LOGIN_URL="https://gradtracer.tech/",
		), patch("threading.Thread", _InlineThread):
			return api.AlumniRequestApproveView.as_view()(request, alumni_id=str(self.account.id))

	def test_approval_activates_the_account_and_emails_the_graduate(self):
		from django.core import mail

		response = self._approve()

		self.assertEqual(response.status_code, 200)
		self.account.refresh_from_db()
		self.assertEqual(self.account.account_status, AccountStatus.ACTIVE)

		self.assertEqual(len(mail.outbox), 1)
		message = mail.outbox[0]
		self.assertEqual(message.to, ["approved-grad@example.com"])
		self.assertEqual(message.subject, "Your graduate account has been verified")
		self.assertIn("view your profile", message.body)
		self.assertIn("https://gradtracer.tech/", message.body)
		html = message.alternatives[0][0]
		self.assertIn('href="https://gradtracer.tech/"', html)

	def test_a_failed_send_does_not_undo_the_approval(self):
		"""The send is best-effort: a mail outage must never block the admin."""
		with patch("users.email_send.send_branded_email", side_effect=RuntimeError("smtp down")):
			response = self._approve()
		self.assertEqual(response.status_code, 200)
		self.account.refresh_from_db()
		self.assertEqual(self.account.account_status, AccountStatus.ACTIVE)

	def test_default_login_link_is_the_live_domain(self):
		"""With no env override the link must not point at the retired Vercel site."""
		from django.conf import settings as dj_settings
		if os.environ.get("GRADUATE_LOGIN_URL"):
			self.skipTest("GRADUATE_LOGIN_URL is overridden in this environment")
		self.assertNotIn("vercel.app", dj_settings.GRADUATE_LOGIN_URL)


class _FakeServerEngine:
	"""
	Stands in for InsightFace: embeds the image bytes itself, compares by a toy
	distance. Records what it was asked to embed so tests can assert on it.
	"""

	name = "insightface"
	dimensions = 4
	distance_threshold = 0.4
	requires_client_descriptor = False

	# Image bytes -> embedding. Anything not listed has no detectable face.
	VECTORS = {
		b"front": [1.0, 0.0, 0.0, 0.0],
		b"same-left": [0.9, 0.1, 0.0, 0.0],
		b"same-right": [0.9, 0.0, 0.1, 0.0],
		b"stranger": [0.0, 0.0, 0.0, 1.0],
	}

	def __init__(self):
		self.embedded = []

	def embed(self, *, image_bytes=None, client_descriptor=None):
		self.embedded.append(image_bytes)
		vector = self.VECTORS.get(image_bytes)
		return list(vector) if vector else None

	def distance(self, a, b):
		return sum(abs(x - y) for x, y in zip(a, b))

	def is_match(self, distance):
		return distance <= self.distance_threshold

	def average(self, descriptors):
		return [sum(column) / len(descriptors) for column in zip(*descriptors)]


class RegistrationSweepTests(TestCase):
	"""
	The enrolment sweep on AlumniRegisterView.

	Registration sends a frontal photo plus several head-angle frames. A
	server-side engine should build its template from all of them -- but only
	from frames that are the same person as the frontal photo, since that is
	the image an admin verifies.
	"""

	EMAIL = "sweep-test@example.com"

	def setUp(self):
		self.client = APIClient()
		self.engine = _FakeServerEngine()

	def _payload(self, front=b"front", poses=(), **extra):
		payload = {
			"email": self.EMAIL,
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
			"survey_data": json.dumps({
				"employment_status": "employed_full_time",
				"academic_honors": 1,
				"time_to_hire_months": 3,
				"first_job_sector": "private",
			}),
			"face_front": SimpleUploadedFile("face.jpg", front, content_type="image/jpeg"),
		}
		if poses:
			payload["face_images"] = [
				SimpleUploadedFile(f"pose_{i}.jpg", data, content_type="image/jpeg")
				for i, data in enumerate(poses)
			]
		payload.update(extra)
		return payload

	def _register(self, payload, engine=None):
		uploads = patch(
			"users.api.upload_image_bytes",
			side_effect=lambda **kw: f"https://storage.test/{kw['object_path']}",
		)
		if engine is None:
			with uploads:
				response = self.client.post("/api/auth/alumni/register/", payload, format="multipart")
		else:
			with uploads, patch("users.api.get_engine", return_value=engine):
				response = self.client.post("/api/auth/alumni/register/", payload, format="multipart")
		self.assertEqual(response.status_code, 201, getattr(response, "data", response))
		account = AlumniAccount.objects.get(user__email=self.EMAIL)
		return json.loads(account.biometric_template), account

	def test_server_engine_embeds_the_front_and_every_pose(self):
		template, account = self._register(
			self._payload(poses=[b"same-left", b"same-right"]), self.engine,
		)

		self.assertEqual(self.engine.embedded, [b"front", b"same-left", b"same-right"])
		self.assertEqual(len(template["face_descriptor_samples"]), 3)
		self.assertEqual(template["capture_meta"]["frames"], 3)
		self.assertEqual(template["capture_meta"]["samples"], 3)
		self.assertEqual(len(template["registration_pose_scans"]), 2)
		self.assertEqual(template["engine"], "insightface")

	def test_pose_frames_never_become_the_reviewed_photo(self):
		"""Admin review shows the newest face_front row; a turned frame must not be it."""
		_, account = self._register(
			self._payload(poses=[b"same-left", b"same-right"]), self.engine,
		)
		self.assertEqual(account.face_scans.count(), 1)
		self.assertEqual(account.face_scans.get().scan_type, "face_front")
		self.assertIn("face_front", account.face_photo_url)

	def test_a_pose_of_someone_else_is_not_enrolled(self):
		"""Leaning into frame mid-sweep must not add a second face to the account."""
		template, _ = self._register(
			self._payload(poses=[b"same-left", b"stranger"]), self.engine,
		)

		samples = template["face_descriptor_samples"]
		self.assertEqual(len(samples), 2)
		self.assertNotIn(_FakeServerEngine.VECTORS[b"stranger"], samples)
		# The frame is still uploaded: it is evidence, just not a reference.
		self.assertEqual(len(template["registration_pose_scans"]), 2)

	def test_unreadable_front_enrols_nothing_even_with_good_poses(self):
		"""With no frontal embedding there is nothing to check poses against."""
		template, _ = self._register(
			self._payload(front=b"blurry", poses=[b"same-left", b"same-right"]), self.engine,
		)
		self.assertIsNone(template["face_descriptor"])
		self.assertEqual(template["face_descriptor_samples"], [])

	def test_pose_frames_are_capped(self):
		template, _ = self._register(
			self._payload(poses=[b"same-left"] * 12), self.engine,
		)
		self.assertEqual(len(template["registration_pose_scans"]), api._MAX_REGISTRATION_POSE_FRAMES)
		self.assertEqual(len(self.engine.embedded), 1 + api._MAX_REGISTRATION_POSE_FRAMES)

	def test_registration_without_a_sweep_still_works(self):
		"""A client that predates the sweep sends face_front alone."""
		template, _ = self._register(self._payload(), self.engine)
		self.assertEqual(len(template["face_descriptor_samples"]), 1)
		self.assertEqual(template["registration_pose_scans"], {})

	def test_admin_payload_lists_the_sweep_with_its_angles(self):
		"""Pending verification needs every pose, and the angle each was taken at."""
		_, account = self._register(
			self._payload(
				poses=[b"same-left", b"same-right"],
				face_images_meta=json.dumps([{"target": 24, "yaw": 22.5}, {"target": -24, "yaw": -21.0}]),
			),
			self.engine,
		)
		payload = api._admin_alumni_payload(account)

		poses = payload["registrationPoseScans"]
		self.assertEqual([p["target"] for p in poses], [24.0, -24.0])
		self.assertEqual(poses[1]["yaw"], -21.0)
		self.assertTrue(all("face_pose_" in p["url"] for p in poses))
		self.assertEqual(payload["captureSummary"], {"engine": "insightface", "frames": 3, "samples": 3})
		# The reviewed photo is still the front one, never a pose.
		self.assertIn("face_front", payload["facePhotoUrl"])

	def test_home_address_and_pin_are_stored(self):
		"""Region, barangay and country were sent by registration but never saved."""
		_, account = self._register(
			self._payload(
				region="Negros Island Region (NIR)",
				barangay="San Jose",
				home_country="Philippines",
				home_is_abroad="false",
				home_latitude="10.743278",
				home_longitude="122.970029",
				home_location_accuracy_m="15.2",
			),
			self.engine,
		)
		profile = account.profile
		self.assertEqual(profile.home_region, "Negros Island Region (NIR)")
		self.assertEqual(profile.home_barangay, "San Jose")
		self.assertEqual(profile.home_country, "Philippines")
		self.assertFalse(profile.home_is_abroad)
		self.assertEqual(str(profile.home_latitude), "10.743278")
		self.assertEqual(str(profile.home_longitude), "122.970029")
		self.assertAlmostEqual(profile.home_location_accuracy_m, 15.2)

	def test_out_of_range_home_pin_is_dropped(self):
		_, account = self._register(
			self._payload(home_latitude="123", home_longitude="999"), self.engine,
		)
		self.assertIsNone(account.profile.home_latitude)
		self.assertIsNone(account.profile.home_longitude)

	def test_geomap_prefers_the_home_pin_over_the_face_scan_gps(self):
		_, account = self._register(
			self._payload(
				gps_lat="10.100000", gps_lng="122.100000",
				home_latitude="10.743278", home_longitude="122.970029",
			),
			self.engine,
		)
		payload = api._admin_alumni_payload(account)
		self.assertEqual(payload["locationSource"], "home")
		self.assertAlmostEqual(float(payload["lat"]), 10.743278)
		self.assertAlmostEqual(float(payload["lng"]), 122.970029)

	def test_geomap_falls_back_to_the_face_scan_gps(self):
		_, account = self._register(
			self._payload(gps_lat="10.100000", gps_lng="122.100000"), self.engine,
		)
		payload = api._admin_alumni_payload(account)
		self.assertEqual(payload["locationSource"], "registration_gps")
		self.assertIsNone(payload["homeLat"])

	def test_faceapi_uses_client_descriptors_and_does_not_embed_poses(self):
		"""The browser engine already chose its frontal frames; the server must not second-guess it."""
		first = [0.01 * i for i in range(128)]
		second = [0.02 * i for i in range(128)]
		template, _ = self._register(
			self._payload(
				poses=[b"same-left"],
				face_descriptor=json.dumps(first),
				face_descriptor_samples=json.dumps([first, second]),
			),
		)
		self.assertEqual(template["engine"], "faceapi")
		self.assertEqual(template["face_descriptor_samples"], [first, second])
		self.assertEqual(len(template["registration_pose_scans"]), 1)


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



class RegistrationFeedbackFixTests(TestCase):
	"""Tester feedback, 2026-09: employer invite on first login, graduates who
	lost a job, and skill edits that never stuck."""

	def setUp(self):
		user = User.objects.create_user(email="feedback@example.com", password="Pass12345!", role=User.Role.ALUMNI)
		self.account = AlumniAccount.objects.create(user=user, account_status=AccountStatus.ACTIVE)

	def test_registration_creates_current_record_so_invite_prompt_shows(self):
		api._create_registration_employment_record(self.account, {
			"employment_status": "employed_full_time",
			"current_job_company": "Acme Corp",
			"current_job_title": "Systems Analyst",
			"location_type": True,
			"city_municipality": "City of Talisay",
		})
		record = EmploymentRecord.objects.get(alumni=self.account, is_current=True)
		self.assertEqual(record.verification_status, EmploymentRecord.VerificationStatus.PENDING)
		self.assertTrue(api._needs_employer_invite(self.account))

	def test_no_record_for_graduate_without_a_current_job(self):
		for status_value in ("seeking", "not_seeking", "never_employed"):
			api._create_registration_employment_record(self.account, {
				"employment_status": status_value,
				"current_job_company": "Acme Corp",
				"current_job_title": "Systems Analyst",
			})
		self.assertFalse(EmploymentRecord.objects.filter(alumni=self.account).exists())
		self.assertFalse(api._needs_employer_invite(self.account))

	def test_seeking_graduate_with_a_past_job_passes_validation(self):
		from tracer.validators import validate_registration_payload

		result = validate_registration_payload({
			"employment_status": "seeking", "academic_honors": 1,
			"time_to_hire_months": 3, "first_job_title": "Software Developer",
			"first_job_sector": "private", "first_job_status": "regular",
		})
		self.assertEqual(result["errors"], [])

	def test_never_employed_with_time_to_hire_is_still_an_error(self):
		from tracer.validators import validate_registration_payload

		result = validate_registration_payload({
			"employment_status": "never_employed", "academic_honors": 1, "time_to_hire_months": 3,
		})
		self.assertTrue(any(e.get("consistency") for e in result["errors"]))

	def test_skill_edits_replace_the_saved_rows(self):
		from tracer.models import AlumniSkill
		from users.survey_translator import apply_survey_data_to_normalized_tables

		apply_survey_data_to_normalized_tables(self.account, {
			"technical_skills": ["Web Development", "Database Management"],
			"soft_skills": ["Leadership", "Customer Service Orientation"],
		})
		apply_survey_data_to_normalized_tables(self.account, {
			"technical_skills": ["Web Development"],
			"soft_skills": ["Leadership"],
		})
		rows = AlumniSkill.objects.filter(alumni=self.account).select_related("skill__category")
		by_category = {(r.skill.category.name, r.skill.name) for r in rows}
		self.assertEqual(by_category, {("Technical", "Web Development"), ("Soft", "Leadership")})

		# A soft skill never comes back under technical.
		view = api._normalized_view_from_tables(self.account)
		self.assertEqual(view["technical_skills"], ["Web Development"])
		self.assertEqual(view["soft_skills"], ["Leadership"])

	def test_clear_first_job_wipes_first_job_columns(self):
		from tracer.models import EmploymentProfile
		from users.survey_translator import apply_survey_data_to_normalized_tables

		apply_survey_data_to_normalized_tables(self.account, {
			"employment_status": "seeking", "timeToHire": "1 - 3 months",
			"firstJobTitle": "QA Tester", "firstJobCompany": "Acme Corp",
		})
		profile = EmploymentProfile.objects.get(alumni=self.account)
		self.assertEqual(profile.first_job_company, "Acme Corp")

		apply_survey_data_to_normalized_tables(self.account, {
			"employment_status": "seeking", "timeToHire": "", "firstJobTitle": "", "clear_first_job": True,
		})
		profile.refresh_from_db()
		self.assertIsNone(profile.first_job_title)
		self.assertIsNone(profile.first_job_company)
		self.assertIsNone(profile.time_to_hire_months)
