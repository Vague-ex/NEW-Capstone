from datetime import timedelta

from django.core import signing
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from users.auth import generate_admin_access_token
from users.models import AccountStatus, AlumniAccount, AlumniProfile, EmployerAccount, User

from .alignment import resolve_alignment, verified_titles_by_alumni
from .models import (
	EmploymentProfile, EmploymentRecord, JobTitle, Region,
	VerificationDecision, VerificationToken,
)


class RegionReferenceApiTests(TestCase):
	def setUp(self):
		self.client = APIClient()
		# Reference-data reads stay public (the registration form needs them
		# before anyone signs in) but writes are admin-only, so the CRUD
		# lifecycle below has to authenticate.
		self.admin_user = User.objects.create_user(
			email="region-admin@example.com",
			password="AdminPass123!",
			role=User.Role.ADMIN,
			is_staff=True,
		)
		self.admin_headers = {
			"HTTP_AUTHORIZATION": f"Bearer {generate_admin_access_token(self.admin_user.id)}"
		}

	def test_region_list_is_public(self):
		self.assertEqual(self.client.get("/api/reference/regions/").status_code, 200)

	def test_region_write_requires_admin(self):
		response = self.client.post(
			"/api/reference/regions/",
			{"code": "R6", "name": "Region VI"},
			format="json",
		)
		self.assertEqual(response.status_code, 401)

	def test_region_crud_lifecycle(self):
		create_response = self.client.post(
			"/api/reference/regions/",
			{"code": "R6", "name": "Region VI"},
			format="json",
			**self.admin_headers,
		)
		self.assertEqual(create_response.status_code, 201)

		region_id = create_response.data["region"]["id"]

		patch_response = self.client.patch(
			f"/api/reference/regions/{region_id}/",
			{"name": "Region VI - Western Visayas"},
			format="json",
			**self.admin_headers,
		)
		self.assertEqual(patch_response.status_code, 200)
		self.assertEqual(
			patch_response.data["region"]["name"], "Region VI - Western Visayas"
		)

		delete_response = self.client.delete(
			f"/api/reference/regions/{region_id}/", **self.admin_headers
		)
		self.assertEqual(delete_response.status_code, 204)

		region = Region.objects.get(id=region_id)
		self.assertFalse(region.is_active)


class VerificationTokenFlowTests(TestCase):
	def setUp(self):
		self.client = APIClient()

		self.employer_user = User.objects.create_user(
			email="hr@example.com",
			password="TestPass123!",
			role=User.Role.EMPLOYER,
		)
		self.employer_account = EmployerAccount.objects.create(
			user=self.employer_user,
			company_email="hr@example.com",
			company_name="Acme Corp",
			account_status=AccountStatus.ACTIVE,
		)

		self.alumni_user = User.objects.create_user(
			email="alumni@example.com",
			password="TestPass123!",
			role=User.Role.ALUMNI,
		)
		self.alumni_account = AlumniAccount.objects.create(
			user=self.alumni_user,
			account_status=AccountStatus.ACTIVE,
		)

		self.job_title = JobTitle.objects.create(name="Systems Analyst")
		self.region = Region.objects.create(code="R6", name="Region VI")
		self.employment_record = EmploymentRecord.objects.create(
			alumni=self.alumni_account,
			employer_name_input="Sample Employer",
			job_title_input="Systems Analyst",
			job_title=self.job_title,
			employment_status=EmploymentRecord.EmploymentStatus.EMPLOYED,
			region=self.region,
			is_current=True,
		)

		self.employer_token = signing.dumps(
			{"uid": str(self.employer_user.id), "role": User.Role.EMPLOYER},
			salt="users.employer.access",
		)

		self.pending_employer_user = User.objects.create_user(
			email="pending-hr@example.com",
			password="TestPass123!",
			role=User.Role.EMPLOYER,
		)
		self.pending_employer_account = EmployerAccount.objects.create(
			user=self.pending_employer_user,
			company_email="pending-hr@example.com",
			company_name="Pending Corp",
			account_status=AccountStatus.PENDING,
		)
		self.pending_employer_token = signing.dumps(
			{"uid": str(self.pending_employer_user.id), "role": User.Role.EMPLOYER},
			salt="users.employer.access",
		)

	def _auth_headers(self) -> dict:
		return {"HTTP_AUTHORIZATION": f"Bearer {self.employer_token}"}

	def _pending_auth_headers(self) -> dict:
		return {"HTTP_AUTHORIZATION": f"Bearer {self.pending_employer_token}"}

	def test_issue_and_confirm_verification_token(self):
		issue_response = self.client.post(
			"/api/verification/tokens/issue/",
			{"employment_record_id": str(self.employment_record.id)},
			format="json",
			**self._auth_headers(),
		)
		self.assertEqual(issue_response.status_code, 201)

		token_id = issue_response.data["token"]["id"]
		token = VerificationToken.objects.get(token_id=token_id)
		self.assertEqual(token.status, VerificationToken.Status.PENDING)

		# No auth header: holding the token IS the authorisation. The verifier
		# identifies themselves instead, since the token proves which graduate
		# is being verified but not who is vouching for them.
		decision_response = self.client.post(
			f"/api/verification/tokens/{token_id}/decision/",
			{
				"decision": "confirm",
				"verified_employer_name": "Acme Corp",
				"verified_job_title_id": str(self.job_title.id),
				"comment": "Confirmed by HR",
				"verifier_name": "Maria Reyes",
				"verifier_email": "maria@acme.com",
				"verifier_position": "HR Manager",
			},
			format="json",
		)
		self.assertEqual(decision_response.status_code, 200)

		token.refresh_from_db()
		self.assertEqual(token.status, VerificationToken.Status.USED)

		self.employment_record.refresh_from_db()
		self.assertEqual(
			self.employment_record.verification_status,
			EmploymentRecord.VerificationStatus.VERIFIED,
		)

		decision = VerificationDecision.objects.get()
		# The whole point of the design: no employer account, yet the decision
		# still resolves to the right graduate through the token's FK.
		self.assertIsNone(decision.employer_account_id)
		self.assertEqual(decision.verifier_email, "maria@acme.com")
		self.assertEqual(decision.token.alumni_id, self.alumni_account.id)

	def test_graduate_cannot_verify_themselves(self):
		issue_response = self.client.post(
			"/api/verification/tokens/issue/",
			{"employment_record_id": str(self.employment_record.id)},
			format="json",
			**self._auth_headers(),
		)
		token_id = issue_response.data["token"]["id"]

		response = self.client.post(
			f"/api/verification/tokens/{token_id}/decision/",
			{
				"decision": "confirm",
				"verifier_name": "Alumni Themselves",
				"verifier_email": self.alumni_user.email,
			},
			format="json",
		)
		self.assertEqual(response.status_code, 400)
		self.assertEqual(VerificationDecision.objects.count(), 0)

	def test_verifier_identity_is_required(self):
		issue_response = self.client.post(
			"/api/verification/tokens/issue/",
			{"employment_record_id": str(self.employment_record.id)},
			format="json",
			**self._auth_headers(),
		)
		token_id = issue_response.data["token"]["id"]

		response = self.client.post(
			f"/api/verification/tokens/{token_id}/decision/",
			{"decision": "confirm"},
			format="json",
		)
		self.assertEqual(response.status_code, 400)

	def test_multiple_live_links_can_each_be_answered(self):
		"""
		A graduate may invite more than one verifier (HR and a direct
		supervisor). Minting a second link must not revoke the first, and
		answering one must not kill the other — that was the old behaviour and
		it silently broke the second employer's link.
		"""
		alumni_id = str(self.alumni_account.id)
		first = self.client.post(f"/api/verification/alumni/{alumni_id}/invite/", {}, format="json")
		second = self.client.post(f"/api/verification/alumni/{alumni_id}/invite/", {}, format="json")
		self.assertEqual(first.status_code, 201)
		self.assertEqual(second.status_code, 201)

		first_id = first.data["token"]["id"]
		second_id = second.data["token"]["id"]
		self.assertNotEqual(first_id, second_id)

		# Both remain usable after the second is minted.
		for token_id in (first_id, second_id):
			self.assertEqual(
				VerificationToken.objects.get(token_id=token_id).status,
				VerificationToken.Status.PENDING,
			)

		answered = self.client.post(
			f"/api/verification/tokens/{first_id}/decision/",
			{"decision": "confirm", "verifier_name": "HR", "verifier_email": "hr@acme.com"},
			format="json",
		)
		self.assertEqual(answered.status_code, 200)

		# The sibling link survives and can still be answered independently.
		self.assertEqual(
			VerificationToken.objects.get(token_id=second_id).status,
			VerificationToken.Status.PENDING,
		)
		second_answer = self.client.post(
			f"/api/verification/tokens/{second_id}/decision/",
			{"decision": "confirm", "verifier_name": "Supervisor", "verifier_email": "boss@acme.com"},
			format="json",
		)
		self.assertEqual(second_answer.status_code, 200)
		self.assertEqual(VerificationDecision.objects.count(), 2)

	def test_used_link_cannot_be_reused(self):
		alumni_id = str(self.alumni_account.id)
		token_id = self.client.post(
			f"/api/verification/alumni/{alumni_id}/invite/", {}, format="json",
		).data["token"]["id"]

		payload = {"decision": "confirm", "verifier_name": "HR", "verifier_email": "hr@acme.com"}
		self.assertEqual(
			self.client.post(f"/api/verification/tokens/{token_id}/decision/", payload, format="json").status_code,
			200,
		)
		self.assertEqual(
			self.client.post(f"/api/verification/tokens/{token_id}/decision/", payload, format="json").status_code,
			400,
		)

	def test_issue_requires_employer_token(self):
		response = self.client.post(
			"/api/verification/tokens/issue/",
			{"employment_record_id": str(self.employment_record.id)},
			format="json",
		)
		self.assertEqual(response.status_code, 401)


class EmployerVerifiableGraduateListTests(TestCase):
	def setUp(self):
		self.client = APIClient()

		self.employer_user = User.objects.create_user(
			email="talent@example.com",
			password="TestPass123!",
			role=User.Role.EMPLOYER,
		)
		self.employer_account = EmployerAccount.objects.create(
			user=self.employer_user,
			company_email="talent@example.com",
			company_name="Accenture Philippines",
			account_status=AccountStatus.ACTIVE,
		)
		self.employer_token = signing.dumps(
			{"uid": str(self.employer_user.id), "role": User.Role.EMPLOYER},
			salt="users.employer.access",
		)

		self.pending_employer_user = User.objects.create_user(
			email="pending-talent@example.com",
			password="TestPass123!",
			role=User.Role.EMPLOYER,
		)
		self.pending_employer_account = EmployerAccount.objects.create(
			user=self.pending_employer_user,
			company_email="pending-talent@example.com",
			company_name="Accenture Philippines",
			account_status=AccountStatus.PENDING,
		)
		self.pending_employer_token = signing.dumps(
			{"uid": str(self.pending_employer_user.id), "role": User.Role.EMPLOYER},
			salt="users.employer.access",
		)

		self.match_alumni_user = User.objects.create_user(
			email="maria@example.com",
			password="TestPass123!",
			role=User.Role.ALUMNI,
		)
		self.match_alumni = AlumniAccount.objects.create(
			user=self.match_alumni_user,
			account_status=AccountStatus.ACTIVE,
		)
		AlumniProfile.objects.create(
			alumni=self.match_alumni,
			first_name="Maria",
			last_name="Santos",
			graduation_year=2022,
		)
		EmploymentRecord.objects.create(
			alumni=self.match_alumni,
			employer_name_input="Accenture Technology Services PH",
			job_title_input="Systems Analyst",
			employment_status=EmploymentRecord.EmploymentStatus.EMPLOYED,
			verification_status=EmploymentRecord.VerificationStatus.PENDING,
			is_current=True,
		)

		self.partial_match_user = User.objects.create_user(
			email="john@example.com",
			password="TestPass123!",
			role=User.Role.ALUMNI,
		)
		self.partial_match_alumni = AlumniAccount.objects.create(
			user=self.partial_match_user,
			account_status=AccountStatus.ACTIVE,
		)
		AlumniProfile.objects.create(
			alumni=self.partial_match_alumni,
			first_name="John",
			last_name="Reyes",
			graduation_year=2021,
		)
		EmploymentRecord.objects.create(
			alumni=self.partial_match_alumni,
			employer_name_input="Accenture",
			job_title_input="QA Specialist",
			employment_status=EmploymentRecord.EmploymentStatus.EMPLOYED,
			verification_status=EmploymentRecord.VerificationStatus.PENDING,
			is_current=True,
		)

		self.non_match_user = User.objects.create_user(
			email="other@example.com",
			password="TestPass123!",
			role=User.Role.ALUMNI,
		)
		self.non_match_alumni = AlumniAccount.objects.create(
			user=self.non_match_user,
			account_status=AccountStatus.ACTIVE,
		)
		AlumniProfile.objects.create(
			alumni=self.non_match_alumni,
			first_name="Paolo",
			last_name="Dela Cruz",
			graduation_year=2022,
		)
		EmploymentRecord.objects.create(
			alumni=self.non_match_alumni,
			employer_name_input="Different Company Inc",
			job_title_input="Support Engineer",
			employment_status=EmploymentRecord.EmploymentStatus.EMPLOYED,
			verification_status=EmploymentRecord.VerificationStatus.PENDING,
			is_current=True,
		)

	def _auth_headers(self) -> dict:
		return {"HTTP_AUTHORIZATION": f"Bearer {self.employer_token}"}

	def _pending_auth_headers(self) -> dict:
		return {"HTTP_AUTHORIZATION": f"Bearer {self.pending_employer_token}"}

	def test_lists_current_graduates_with_same_or_similar_company_name(self):
		response = self.client.get(
			"/api/verification/employer/graduates/",
			**self._auth_headers(),
		)
		self.assertEqual(response.status_code, 200)

		results = response.data.get("results", [])
		result_ids = {entry.get("id") for entry in results}
		self.assertIn(str(self.match_alumni.id), result_ids)
		self.assertIn(str(self.partial_match_alumni.id), result_ids)
		self.assertNotIn(str(self.non_match_alumni.id), result_ids)

	def test_supports_name_and_year_filters(self):
		response = self.client.get(
			"/api/verification/employer/graduates/?q=maria&year=2022",
			**self._auth_headers(),
		)
		self.assertEqual(response.status_code, 200)

		results = response.data.get("results", [])
		self.assertEqual(len(results), 1)
		self.assertEqual(results[0].get("name"), "Maria Santos")

	def test_pending_employer_can_access_verifiable_graduate_list(self):
		response = self.client.get(
			"/api/verification/employer/graduates/",
			**self._pending_auth_headers(),
		)
		self.assertEqual(response.status_code, 200)


class CurriculumAlignmentReportTests(TestCase):
	"""
	End-to-end cover for the Phase 3 alignment work: an employer-verified job
	title must override the graduate's self-report, and graduates whose
	alignment cannot be determined must be counted as unknown rather than
	quietly folded into "not aligned".
	"""

	def setUp(self):
		self.client = APIClient()
		self.admin = User.objects.create_user(
			email="reports-admin@example.com",
			password="AdminPass123!",
			role=User.Role.ADMIN,
			is_staff=True,
		)
		self.headers = {
			"HTTP_AUTHORIZATION": f"Bearer {generate_admin_access_token(self.admin.id)}"
		}

		self.dev_title = JobTitle.objects.create(
			name="Web Developer", is_field=JobTitle.ISField.SOFTWARE_DEV
		)
		self.non_is_title = JobTitle.objects.create(
			name="Cashier", is_field=JobTitle.ISField.NON_IS
		)

	def _make_alumni(self, email, year, self_reported=None):
		user = User.objects.create_user(
			email=email, password="TestPass123!", role=User.Role.ALUMNI
		)
		account = AlumniAccount.objects.create(
			user=user, account_status=AccountStatus.ACTIVE
		)
		AlumniProfile.objects.create(
			alumni=account, first_name="A", last_name="B", graduation_year=year
		)
		if self_reported is not None:
			EmploymentProfile.objects.create(
				alumni=account, current_job_related_to_bsis=self_reported
			)
		return account

	def _verify(self, account, job_title):
		# VerificationDecision.employer_account is still NOT NULL today, so a
		# verified decision cannot exist without an employer account. Phase 2
		# (employer de-accounting) makes this column nullable; until then the
		# fixture has to supply one.
		employer_user = User.objects.create_user(
			email=f"hr-{account.id}@example.com",
			password="TestPass123!",
			role=User.Role.EMPLOYER,
		)
		employer = EmployerAccount.objects.create(
			user=employer_user,
			company_email=employer_user.email,
			company_name="Verifier Corp",
			account_status=AccountStatus.ACTIVE,
		)
		token = VerificationToken.objects.create(
			alumni=account, expires_at=timezone.now() + timedelta(days=7)
		)
		VerificationDecision.objects.create(
			token=token,
			employer_account=employer,
			decision=VerificationDecision.Decision.CONFIRM,
			verified_job_title=job_title,
		)

	def test_model_derives_alignment_from_is_field(self):
		self.assertTrue(self.dev_title.is_bsis_aligned)
		self.assertFalse(self.non_is_title.is_bsis_aligned)
		unclassified = JobTitle.objects.create(name="Mystery Role")
		self.assertIsNone(unclassified.is_bsis_aligned)

	def test_verified_title_overrides_self_report(self):
		# Graduate claims aligned; employer-verified title says otherwise.
		account = self._make_alumni("overridden@example.com", 2022, self_reported=True)
		self._verify(account, self.non_is_title)

		resolved = resolve_alignment(
			verified_job_title=verified_titles_by_alumni([account.id]).get(account.id),
			self_reported=True,
		)
		self.assertFalse(resolved.is_aligned)
		self.assertTrue(resolved.is_verified)

	def test_report_splits_verified_from_self_reported(self):
		verified = self._make_alumni("v@example.com", 2022, self_reported=False)
		self._verify(verified, self.dev_title)
		self._make_alumni("s@example.com", 2022, self_reported=True)
		self._make_alumni("u@example.com", 2022)  # no data at all -> unknown

		response = self.client.get(
			"/api/admin/reports/batch-summary/"
			"?batch_start=2020&batch_end=2025&include_unverified=false",
			**self.headers,
		)
		self.assertEqual(response.status_code, 200)

		sections = {s["title"]: s for s in response.data["sections"]}
		self.assertIn("Curriculum Alignment (BSIS)", sections)
		row = sections["Curriculum Alignment (BSIS)"]["rows"][0]
		# [batch, N, verified%, verified_n, self%, self_n, overall%, unknown]
		self.assertEqual(row[1], 3)
		self.assertEqual(row[2], "100.0%")   # verified: the dev title, aligned
		self.assertEqual(row[3], 1)
		self.assertEqual(row[4], "100.0%")   # self-reported: the one True
		self.assertEqual(row[5], 1)
		self.assertEqual(row[7], 1)          # the third stays unknown

		fields = sections["IS Field Distribution (employer-verified titles)"]
		self.assertIn(["Software Development", 1], [list(r) for r in fields["rows"]])


class PublicVerificationLandingTests(TestCase):
	"""
	The landing page behind a verification link is fully public — anyone the
	link reaches, or is forwarded to, can read it. These pin the two properties
	that follow from that, which VerificationTokenFlowTests does not cover:
	what the page may disclose, and who may be invited in the first place.
	"""

	def setUp(self):
		self.client = APIClient()
		self.user = User.objects.create_user(
			email="grad-link@example.com", password="TestPass123!", role=User.Role.ALUMNI
		)
		self.alumni = AlumniAccount.objects.create(
			user=self.user, account_status=AccountStatus.ACTIVE
		)
		AlumniProfile.objects.create(
			alumni=self.alumni, first_name="Ana", last_name="Reyes", graduation_year=2022
		)
		EmploymentRecord.objects.create(
			alumni=self.alumni,
			employer_name_input="Acme Corp",
			job_title_input="Backend Developer",
			employment_status=EmploymentRecord.EmploymentStatus.EMPLOYED,
			verification_status=EmploymentRecord.VerificationStatus.PENDING,
			is_current=True,
		)

	def _invite(self, employer_email=None):
		body = {"employer_email": employer_email} if employer_email else {}
		return self.client.post(
			f"/api/verification/alumni/{self.alumni.id}/invite/", body, format="json"
		)

	def test_landing_identifies_the_graduate_without_leaking_their_email(self):
		token_id = self._invite().data["token"]["id"]

		# No credentials at all — holding the link is the whole authorisation.
		response = self.client.get(f"/api/verification/tokens/{token_id}/")
		self.assertEqual(response.status_code, 200)

		alumni = response.data["alumni"]
		self.assertEqual(alumni["name"], "Ana Reyes")
		self.assertEqual(alumni["batchYear"], 2022)
		# An employer needs to know WHO they are vouching for, not how to
		# contact them. A forwarded link must not disclose the address.
		self.assertNotIn("email", alumni)
		self.assertNotIn("grad-link@example.com", str(response.data))
		self.assertEqual(response["Cache-Control"], "no-store")
		self.assertIn("noindex", response["X-Robots-Tag"])

	def test_graduate_cannot_invite_their_own_address(self):
		# The decision endpoint already refuses self-verification; this closes
		# the same hole one step earlier, at invite time.
		response = self._invite("grad-link@example.com")
		self.assertEqual(response.status_code, 400)
