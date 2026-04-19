from django.core import signing
from django.test import TestCase
from rest_framework.test import APIClient

from users.models import AccountStatus, AlumniAccount, AlumniProfile, EmployerAccount, User

from .models import EmploymentRecord, JobTitle, Region, VerificationDecision, VerificationToken


class RegionReferenceApiTests(TestCase):
	def setUp(self):
		self.client = APIClient()

	def test_region_crud_lifecycle(self):
		create_response = self.client.post(
			"/api/reference/regions/",
			{"code": "R6", "name": "Region VI"},
			format="json",
		)
		self.assertEqual(create_response.status_code, 201)

		region_id = create_response.data["region"]["id"]

		patch_response = self.client.patch(
			f"/api/reference/regions/{region_id}/",
			{"name": "Region VI - Western Visayas"},
			format="json",
		)
		self.assertEqual(patch_response.status_code, 200)
		self.assertEqual(
			patch_response.data["region"]["name"], "Region VI - Western Visayas"
		)

		delete_response = self.client.delete(f"/api/reference/regions/{region_id}/")
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

		decision_response = self.client.post(
			f"/api/verification/tokens/{token_id}/decision/",
			{
				"decision": "confirm",
				"verified_employer_name": "Acme Corp",
				"verified_job_title_id": str(self.job_title.id),
				"comment": "Confirmed by HR",
			},
			format="json",
			**self._auth_headers(),
		)
		self.assertEqual(decision_response.status_code, 200)

		token.refresh_from_db()
		self.assertEqual(token.status, VerificationToken.Status.USED)

		self.employment_record.refresh_from_db()
		self.assertEqual(
			self.employment_record.verification_status,
			EmploymentRecord.VerificationStatus.VERIFIED,
		)
		self.assertEqual(self.employment_record.employer_account_id, self.employer_account.id)

		decision_payload = decision_response.data.get("decision", {})
		self.assertEqual(decision_payload.get("isHeld"), False)

		self.assertEqual(VerificationDecision.objects.count(), 1)

	def test_pending_employer_decision_is_saved_on_hold(self):
		issue_response = self.client.post(
			"/api/verification/tokens/issue/",
			{"employment_record_id": str(self.employment_record.id)},
			format="json",
			**self._pending_auth_headers(),
		)
		self.assertEqual(issue_response.status_code, 201)

		token_id = issue_response.data["token"]["id"]
		decision_response = self.client.post(
			f"/api/verification/tokens/{token_id}/decision/",
			{
				"decision": "confirm",
				"verified_employer_name": "Pending Corp",
				"comment": "Pending account submission",
			},
			format="json",
			**self._pending_auth_headers(),
		)
		self.assertEqual(decision_response.status_code, 200)

		decision_payload = decision_response.data.get("decision", {})
		self.assertEqual(decision_payload.get("isHeld"), True)

		token = VerificationToken.objects.get(token_id=token_id)
		self.assertEqual(token.status, VerificationToken.Status.USED)

		self.employment_record.refresh_from_db()
		self.assertEqual(
			self.employment_record.verification_status,
			EmploymentRecord.VerificationStatus.PENDING,
		)
		self.assertIsNone(self.employment_record.employer_account_id)

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
