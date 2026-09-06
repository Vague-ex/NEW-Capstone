from datetime import timedelta

from django.core import signing
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from users.auth import generate_admin_access_token
from users.models import AccountStatus, AlumniAccount, AlumniProfile, EmployerAccount, User

from .alignment import resolve_alignment, verified_titles_by_alumni
from .validators import (
	SurveyDataValidator, flat_to_sections, validate_registration_payload,
)
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

	def _invite(self):
		"""
		Mint a token the way the system actually does now: the GRADUATE
		requests verification. The old employer-token issue endpoint was
		removed with the employer accounts.
		"""
		return self.client.post(
			f"/api/verification/alumni/{self.alumni_account.id}/invite/",
			{}, format="json",
		)

	def _auth_headers(self) -> dict:
		return {"HTTP_AUTHORIZATION": f"Bearer {self.employer_token}"}

	def _pending_auth_headers(self) -> dict:
		return {"HTTP_AUTHORIZATION": f"Bearer {self.pending_employer_token}"}

	def test_issue_and_confirm_verification_token(self):
		issue_response = self._invite()
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
		issue_response = self._invite()
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
		issue_response = self._invite()
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


class RegistrationValidationGateTests(SimpleTestCase):
	"""
	The clean-data gate on the registration intake.

	SurveyDataValidator was written for the alumni portal's eight-section
	payload. Registration posts a flat one. These tests pin the adapter that
	bridges them, and the rule corrections needed to stop the validator
	rejecting legitimate graduates.
	"""

	CLEAN_SURVEY = {
		'employment_status': 'employed_full_time',
		'academic_honors': 1,
		'ojt_relevance': 3,
		'time_to_hire_months': 3,
		'first_job_sector': 'private',
		'first_job_status': 'regular',
		'first_job_applications_count': 2,
		'first_job_source': 'personal_network',
		'current_job_sector': 'private',
		'location_type': True,
		'city_municipality': 'Talisay',
		'province': 'Negros Occidental',
		'region': 'Region VI',
		'technical_skill_count': 5,
		'soft_skill_count': 4,
	}
	CLEAN_PERSONAL = {
		'first_name': 'Ana', 'last_name': 'Reyes', 'gender': 'Female',
		'birth_date': '2000-05', 'mobile': '+639171234567',
		'city': 'Talisay', 'province': 'Negros Occidental',
		'graduation_date': '2022-06', 'graduation_year': 2022,
	}

	def test_flat_payload_cannot_be_validated_without_the_adapter(self):
		"""
		The regression that motivates the adapter. 'employment_status' is both a
		section name and a field name, so the raw flat dict makes the validator
		call .get() on a string. Whether it crashed or passed vacuously, wiring
		it in directly would not have validated anything.
		"""
		with self.assertRaises(AttributeError):
			SurveyDataValidator().validate_comprehensive_survey(self.CLEAN_SURVEY)

	def test_adapter_populates_every_section(self):
		sections = flat_to_sections(self.CLEAN_SURVEY, self.CLEAN_PERSONAL)
		self.assertEqual(len(sections), 8)
		self.assertIn('first_job_details', sections)
		# Absent stays absent — the adapter must not invent empty values.
		sparse = flat_to_sections({'employment_status': 'seeking'}, {})
		self.assertNotIn('competency_assessment', sparse)

	def test_clean_payload_is_accepted(self):
		result = validate_registration_payload(self.CLEAN_SURVEY, self.CLEAN_PERSONAL)
		self.assertTrue(result['is_valid'])
		self.assertEqual(result['blocking_errors'], [])
		self.assertIsNone(result['step'])

	def test_impossible_values_are_rejected_with_the_owning_step(self):
		bad = dict(self.CLEAN_SURVEY, time_to_hire_months=-5,
				   employment_status='banana', first_job_sector='nonsense')
		result = validate_registration_payload(bad, self.CLEAN_PERSONAL)

		self.assertFalse(result['is_valid'])
		self.assertEqual(result['step'], 'employment')
		for field in ('time_to_hire_months', 'employment_status', 'first_job_sector'):
			self.assertIn(field, result['field_errors'])

	def test_missing_optional_answers_warn_rather_than_block(self):
		"""
		The employment form legitimately skips whole sections — a graduate who
		was never employed has no first-job details. Absence must not cost them
		their registration.
		"""
		sparse = {'employment_status': 'never_employed'}
		result = validate_registration_payload(sparse, self.CLEAN_PERSONAL)
		self.assertTrue(result['is_valid'])
		# Absent sections are not validated, so the signal is the completeness
		# score rather than warnings. It must actually fall — the old
		# calculation divided a field count by a section count and clamped to
		# 100, so it read "perfect" for a nearly empty survey.
		self.assertLess(result['completeness_score'], 60.0)
		full = validate_registration_payload(self.CLEAN_SURVEY, self.CLEAN_PERSONAL)
		self.assertEqual(full['completeness_score'], 100.0)

	def test_graduation_years_outside_the_old_hard_coded_range_are_accepted(self):
		"""
		BATCH_RANGE was (2020, 2025). The masterlist holds 2019 batches and a
		2026 graduate is already registered, so the old bound rejected real
		people and would have broken again every January.
		"""
		for year in (2019, 2026):
			result = validate_registration_payload(
				self.CLEAN_SURVEY, dict(self.CLEAN_PERSONAL, graduation_year=year)
			)
			self.assertTrue(result['is_valid'], f'year {year} should be accepted')

		future = validate_registration_payload(
			self.CLEAN_SURVEY, dict(self.CLEAN_PERSONAL, graduation_year=2999)
		)
		self.assertFalse(future['is_valid'])

	def test_month_and_year_birth_dates_do_not_error(self):
		"""
		The form collects "YYYY-MM" and legacy rows hold "MM/DD"; neither parses
		with fromisoformat. The old rule raised a hard error for every record.
		"""
		for value in ('2000-05', '2000-05-14', '03/05', 'nonsense'):
			result = validate_registration_payload(
				self.CLEAN_SURVEY, dict(self.CLEAN_PERSONAL, birth_date=value)
			)
			self.assertTrue(result['is_valid'], f'birth_date {value!r} must not block')


class PredictionComparisonTests(TestCase):
	"""
	The model is trained on synthetic data and APPLIED to real graduates, so the
	comparison path is where things silently break: a feature drifts and the
	model quietly receives the wrong column, or a missing actual is reported as
	a real zero.

	TestCase, not SimpleTestCase — _build_live_df() queries the database, and a
	fixture is created below so the parity check runs for real instead of
	skipping on an empty table.
	"""

	def setUp(self):
		user = User.objects.create_user(
			email="pred-test@example.com", password="TestPass123!", role=User.Role.ALUMNI
		)
		self.alumni = AlumniAccount.objects.create(
			user=user, account_status=AccountStatus.ACTIVE
		)
		AlumniProfile.objects.create(
			alumni=self.alumni, first_name="Ana", last_name="Reyes", graduation_year=2022
		)
		EmploymentProfile.objects.create(
			alumni=self.alumni,
			employment_status="employed_full_time",
			time_to_hire_months=3,
		)

	def _artifacts(self):
		from tracer.api import _load_ml_artifacts
		return _load_ml_artifacts()

	def test_model_artifacts_load(self):
		artifacts = self._artifacts()
		self.assertNotIn("error", artifacts, artifacts.get("error"))
		self.assertIn("features", artifacts)

	def test_live_frame_supplies_every_feature_the_model_expects(self):
		"""
		Train/serve parity. If _build_live_df stops emitting a feature the model
		was trained on, prediction does not raise — it degrades silently, which
		is far worse. This is the guard against that.
		"""
		from tracer.api import _build_live_df

		artifacts = self._artifacts()
		expected = list(artifacts["features"])

		live = _build_live_df()
		self.assertFalse(live.empty, "fixture graduate should produce a live row")

		missing = [f for f in expected if f not in live.columns]
		self.assertEqual(missing, [], f"live frame is missing trained features: {missing}")

	def test_real_employment_statuses_collapse_to_the_trained_binary(self):
		"""
		The model was trained on a binary target. Real data holds five strings,
		so the collapse has to agree with what the model learned.
		"""
		from tracer.api import _EMPLOYED_STATUSES

		for status in ("employed_full_time", "employed_part_time", "self_employed"):
			self.assertIn(status, _EMPLOYED_STATUSES, f"{status} must count as employed")
		for status in ("seeking", "not_seeking", "never_employed"):
			self.assertNotIn(status, _EMPLOYED_STATUSES, f"{status} must not count as employed")

	def test_absent_actuals_are_reported_as_null_not_zero(self):
		"""
		A batch with no answers must report None. Zero would assert a real 0%
		employment rate and an instant time-to-hire that nobody reported.
		"""
		import pandas as pd
		from tracer.api import _aggregate_for_batch

		artifacts = self._artifacts()
		feats = list(artifacts["features"])

		row = {f: 0 for f in feats}
		row.update(
			batch=2024,
			has_outcome=0,
			employment_status=0,
			time_to_hire_months=None,
			bsis_related_job_first=None,
			bsis_related_job_current=None,
		)
		local = {**artifacts, "df": pd.DataFrame([row])}

		result = _aggregate_for_batch(local, 2024)
		self.assertIsNone(result["actual_mean_time_to_hire_months"])
		self.assertIsNone(result["actual_bsis_first_rate"])
		self.assertIsNone(result["actual_bsis_current_rate"])
		# has_outcome=0 means the graduate is excluded from the actual rate
		# rather than silently counted as unemployed.
		self.assertIsNone(result["actual_employment_rate"])
		self.assertEqual(result["n_with_outcome"], 0)
		# A prediction is still produced — the model always has an opinion.
		self.assertIsNotNone(result["predicted_employment_rate"])
