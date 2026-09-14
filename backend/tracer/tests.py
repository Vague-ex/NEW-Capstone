from datetime import timedelta

from django.core import signing
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from users.auth import generate_admin_access_token, generate_alumni_access_token
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


from unittest.mock import patch as _patch

from django.core.cache import cache as _cache

from . import geo_lookup as _geo
from .models import Barangay, CityMunicipality, Province
from .psgc_sync import sync_psgc


def _psgc_fixture():
	"""A miniature PSGC release covering every shape the real one throws at the sync."""
	def rec(kind, code, parent, name):
		return {"type": kind, "psgc_id": code, "parent_psgc_id": parent, "name": name}
	return [
		rec("region", "0900000000", "0000000000", "Region IX (Zamboanga Peninsula)"),
		rec("region", "1000000000", "0000000000", "Region X (Northern Mindanao)"),
		rec("region", "1300000000", "0000000000", "National Capital Region (NCR)"),
		rec("region", "1400000000", "0000000000", "Cordillera Administrative Region (CAR)"),
		rec("region", "1600000000", "0000000000", "Region XIII (Caraga)"),
		rec("region", "1800000000", "0000000000", "Negros Island Region (NIR)"),
		rec("province", "1001300000", "1000000000", "Bukidnon"),
		rec("province", "1401100000", "1400000000", "Benguet"),
		rec("province", "1600200000", "1600000000", "Agusan del Norte"),
		rec("province", "1804500000", "1800000000", "Negros Occidental"),
		rec("municipality", "1001301000", "1001300000", "Baungon"),
		rec("highly_urbanized_city", "1030500000", "1000000000", "City of Cagayan De Oro"),
		rec("municipality", "1401101000", "1401100000", "Atok"),
		rec("municipality", "1804508000", "1804500000", "Enrique B. Magalona"),
		rec("highly_urbanized_city", "1830200000", "1800000000", "City of Bacolod"),
		# Listed twice by the PSA: the "(Not a Province)" entry and the city under it.
		rec("independent_component_city", "0990100000", "0900000000", "City of Isabela (Not a Province)"),
		rec("component_city", "0990101000", "0990100000", "City of Isabela"),
		rec("highly_urbanized_city", "1380600000", "1300000000", "City of Manila"),
		rec("submunicipality", "1380601000", "1380600000", "Tondo I/II"),
		rec("barangay", "1804508018", "1804508000", "San Jose"),
		rec("barangay", "1830200006", "1830200000", "Barangay 6"),
		rec("barangay", "0990101001", "0990101000", "Aguada"),
		rec("barangay", "1380601001", "1380601000", "Barangay 1"),
		rec("barangay", "1401101001", "1401101000", "Abiang"),
	]


class PsgcSyncTests(TestCase):
	"""
	sync_psgc against the reference data as it was actually found: Region X
	renamed "Outside of the Philippines" and switched off, the Caraga row renamed
	"Cordillera Administrative Region" with the real Cordillera provinces under
	it, an empty duplicate region, and a hand-added Bacolod row.
	"""

	def setUp(self):
		self.region_x = Region.objects.create(code="NA", name="Outside of the Philippines", psgc_id="1000000000", is_active=False)
		self.caraga = Region.objects.create(code="CAR", name="Cordillera Administrative Region", psgc_id="1600000000")
		self.nir = Region.objects.create(code="Negros Island Region", name="Negros Island Region (NIR)", psgc_id="1800000000")
		self.region_ix = Region.objects.create(code="Region IX", name="Region IX (Zamboanga Peninsula)", psgc_id="0900000000")
		self.ncr = Region.objects.create(code="NCR", name="National Capital Region", psgc_id="1300000000")
		self.duplicate = Region.objects.create(code="R10", name="Region X - Northern Mindanao", psgc_id="")

		self.bukidnon = Province.objects.create(region=self.region_x, name="Bukidnon", psgc_id="1001300000")
		self.benguet = Province.objects.create(region=self.caraga, name="Benguet", psgc_id="1401100000")
		Province.objects.create(region=self.caraga, name="Agusan del Norte", psgc_id="1600200000")
		self.negros_occ = Province.objects.create(region=self.nir, name="Negros Occidental", psgc_id="1804500000")

		CityMunicipality.objects.create(region=self.region_x, province=self.bukidnon, name="Baungon", psgc_id="1001301000")
		CityMunicipality.objects.create(region=self.region_x, name="City of Cagayan De Oro", psgc_id="1030500000", is_city=True)
		self.atok = CityMunicipality.objects.create(region=self.caraga, province=self.benguet, name="Atok", psgc_id="1401101000")
		self.emb = CityMunicipality.objects.create(region=self.nir, province=self.negros_occ, name="Enrique B. Magalona", psgc_id="1804508000")
		self.bacolod = CityMunicipality.objects.create(region=self.nir, name="City of Bacolod", psgc_id="1830200000", is_city=True)
		self.manual_bacolod = CityMunicipality.objects.create(region=self.nir, province=self.negros_occ, name="City of Bacolod", psgc_id="184501000", is_city=True)
		self.isabela = CityMunicipality.objects.create(region=self.region_ix, name="City of Isabela (Not a Province)", psgc_id="0990100000", is_city=True)
		self.manila = CityMunicipality.objects.create(region=self.ncr, name="City of Manila", psgc_id="1380600000", is_city=True)

	def test_repairs_regions_in_place(self):
		report = sync_psgc(_psgc_fixture(), apply=True)

		self.region_x.refresh_from_db()
		self.caraga.refresh_from_db()
		self.duplicate.refresh_from_db()
		# Same rows, repaired - not deleted and re-created.
		self.assertEqual((self.region_x.name, self.region_x.code, self.region_x.is_active), ("Region X (Northern Mindanao)", "Region X", True))
		self.assertEqual((self.caraga.name, self.caraga.code), ("Region XIII (Caraga)", "Region XIII"))
		self.assertFalse(self.duplicate.is_active)

		car = Region.objects.get(psgc_id="1400000000")
		self.assertEqual(car.code, "CAR")
		self.benguet.refresh_from_db()
		self.atok.refresh_from_db()
		self.assertEqual(self.benguet.region_id, car.id)
		self.assertEqual(self.atok.region_id, car.id)
		self.assertEqual(report.created["region"], 1)

	def test_lists_highly_urbanized_cities_under_their_province(self):
		sync_psgc(_psgc_fixture(), apply=True)
		self.bacolod.refresh_from_db()
		self.manual_bacolod.refresh_from_db()
		self.assertIsNone(self.bacolod.province_id)  # still exactly as the PSA publishes it
		self.assertEqual(self.bacolod.home_province_id, self.negros_occ.id)
		# The hand-added duplicate is no longer needed, and is switched off rather than deleted.
		self.assertFalse(self.manual_bacolod.is_active)

		response = self.client.get(f"/api/reference/cities/?province={self.negros_occ.id}")
		names = [c["name"] for c in response.data["cities"]]
		self.assertIn("City of Bacolod", names)
		self.assertIn("Enrique B. Magalona", names)
		self.assertEqual(names.count("City of Bacolod"), 1)

	def test_links_barangays_to_the_city_a_graduate_picks(self):
		sync_psgc(_psgc_fixture(), apply=True)
		self.assertEqual(Barangay.objects.get(psgc_id="1804508018").city_id, self.emb.id)
		# Through Manila's district, and through Isabela's "(Not a Province)" entry.
		self.assertEqual(Barangay.objects.get(psgc_id="1380601001").city_id, self.manila.id)
		self.assertEqual(Barangay.objects.get(psgc_id="0990101001").city_id, self.isabela.id)
		self.assertFalse(CityMunicipality.objects.filter(psgc_id="0990101000").exists())
		self.isabela.refresh_from_db()
		self.assertEqual(self.isabela.name, "City of Isabela")

	def test_dry_run_writes_nothing_but_reports_everything(self):
		report = sync_psgc(_psgc_fixture(), apply=False)
		self.region_x.refresh_from_db()
		self.assertEqual(self.region_x.name, "Outside of the Philippines")
		self.assertEqual(Barangay.objects.count(), 0)
		self.assertFalse(Region.objects.filter(psgc_id="1400000000").exists())
		self.assertEqual(report.created["barangay"], 5)
		self.assertTrue(report.changed_anything)

	def test_second_run_changes_nothing(self):
		sync_psgc(_psgc_fixture(), apply=True)
		again = sync_psgc(_psgc_fixture(), apply=True)
		self.assertFalse(again.changed_anything, dict(again.changes))

	def test_barangay_list_requires_a_city(self):
		sync_psgc(_psgc_fixture(), apply=True)
		self.assertEqual(self.client.get("/api/reference/barangays/").status_code, 400)
		response = self.client.get(f"/api/reference/barangays/?city={self.emb.id}")
		self.assertEqual(response.status_code, 200)
		self.assertEqual([b["name"] for b in response.data["barangays"]], ["San Jose"])


class LocationLookupTests(TestCase):
	"""
	POST /api/reference/locate/ with the geocoder mocked. The Bacolod address
	is Nominatim's real answer for Bacolod City Hall, captured 2026-09-14.
	"""

	BACOLOD_CITY_HALL = {
		"display_name": "Gatuslao Street, Macapiña, Barangay 6, Bacolod-1, Bacolod, Negros Island Region, 6100, Philippines",
		"address": {
			"road": "Gatuslao Street", "neighbourhood": "Macapiña", "quarter": "Barangay 6",
			"city_district": "Bacolod-1", "city": "Bacolod", "region": "Negros Island Region",
			"postcode": "6100", "country": "Philippines", "country_code": "ph",
		},
	}

	def setUp(self):
		_cache.clear()
		PsgcSyncTests.setUp(self)
		sync_psgc(_psgc_fixture(), apply=True)
		self.client = APIClient()

	def _locate(self, payload=None, side_effect=None, body=None):
		with _patch("tracer.api.reverse_geocode", return_value=payload, side_effect=side_effect):
			return self.client.post(
				"/api/reference/locate/",
				body if body is not None else {"latitude": 10.6765, "longitude": 122.9509},
				format="json",
			)

	def test_resolves_osm_names_to_our_rows(self):
		response = self._locate(self.BACOLOD_CITY_HALL)
		self.assertEqual(response.status_code, 200)
		data = response.data
		self.assertFalse(data["abroad"])
		self.assertEqual(data["region"]["name"], "Negros Island Region (NIR)")
		# Bacolod has no province; the lookup reports the one it is listed under.
		self.assertEqual(data["province"]["name"], "Negros Occidental")
		self.assertEqual(data["city"]["name"], "City of Bacolod")
		self.assertEqual(data["barangay"]["name"], "Barangay 6")
		self.assertIn("OpenStreetMap", data["attribution"])

	def test_town_and_village_keys(self):
		response = self._locate({"address": {
			"village": "San Jose", "town": "Enrique B. Magalona", "state": "Negros Occidental",
			"region": "Negros Island Region", "country": "Philippines", "country_code": "ph",
		}})
		self.assertEqual(response.data["city"]["name"], "Enrique B. Magalona")
		self.assertEqual(response.data["barangay"]["name"], "San Jose")

	def test_abroad_returns_locality_not_philippine_rows(self):
		response = self._locate({"address": {"city": "Singapore", "country": "Singapore", "country_code": "sg"}})
		self.assertTrue(response.data["abroad"])
		self.assertEqual(response.data["locality"], "Singapore")
		self.assertIsNone(response.data["city"])

	def test_unmatched_names_are_left_empty_not_guessed(self):
		response = self._locate({"address": {"city": "Nowhere", "country_code": "ph", "country": "Philippines"}})
		self.assertEqual(response.status_code, 200)
		self.assertIsNone(response.data["city"])
		self.assertIsNone(response.data["barangay"])

	def test_geocoder_outage_is_a_502_with_a_manual_fallback_message(self):
		response = self._locate(side_effect=_geo.GeoLookupError("down"))
		self.assertEqual(response.status_code, 502)
		self.assertIn("by hand", response.data["detail"])

	def test_rejects_bad_coordinates(self):
		self.assertEqual(self._locate(body={"latitude": "abc", "longitude": 1}).status_code, 400)
		self.assertEqual(self._locate(body={"latitude": 95, "longitude": 1}).status_code, 400)

	def test_rate_limited_per_client(self):
		from .api import LocationLookupView
		for _ in range(LocationLookupView.RATE_LIMIT):
			self.assertEqual(self._locate(self.BACOLOD_CITY_HALL).status_code, 200)
		self.assertEqual(self._locate(self.BACOLOD_CITY_HALL).status_code, 429)


class GeoNameFoldingTests(SimpleTestCase):
	def test_variants_bridge_psa_and_osm_spellings(self):
		self.assertIn("bacolod", _geo._variants("City of Bacolod"))
		self.assertIn("western visayas", _geo._variants("Region VI (Western Visayas)"))
		self.assertIn("negros island", _geo._variants("Negros Island Region (NIR)"))
		self.assertEqual(_geo._fold("Sta. Cruz"), _geo._fold("Santa Cruz"))
		self.assertEqual(_geo._fold("Parañaque"), "paranaque")


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

	def _alumni_auth(self):
		"""
		The invite endpoint is graduate-owned: require_alumni resolves the token
		to an AlumniAccount and refuses if it is not the one named in the URL.
		"""
		return {
			"HTTP_AUTHORIZATION": f"Bearer {generate_alumni_access_token(self.alumni_account.user_id)}"
		}

	def _invite(self):
		"""
		Mint a token the way the system actually does now: the GRADUATE
		requests verification. The old employer-token issue endpoint was
		removed with the employer accounts.
		"""
		return self.client.post(
			f"/api/verification/alumni/{self.alumni_account.id}/invite/",
			{}, format="json", **self._alumni_auth(),
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
		first = self.client.post(f"/api/verification/alumni/{alumni_id}/invite/", {}, format="json", **self._alumni_auth())
		second = self.client.post(f"/api/verification/alumni/{alumni_id}/invite/", {}, format="json", **self._alumni_auth())
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

	def test_invite_requires_authentication(self):
		"""
		The invite mints a verification link for a specific graduate. It was
		reachable with no credentials at all, so a third party could mint a link
		for someone else's employment record and address it to an evaluator of
		their choosing — the exact fabrication this flow exists to prevent.
		"""
		response = self.client.post(
			f"/api/verification/alumni/{self.alumni_account.id}/invite/",
			{}, format="json",
		)
		self.assertIn(response.status_code, (401, 403))
		self.assertEqual(VerificationToken.objects.count(), 0)

	def test_invite_rejects_a_different_graduates_token(self):
		"""Being signed in is not enough; the caller must own the record."""
		other_user = User.objects.create_user(
			email="other.grad@example.com", password="pw-Other-123", role=User.Role.ALUMNI,
		)
		other_account = AlumniAccount.objects.create(
			user=other_user, account_status=AccountStatus.ACTIVE,
		)
		response = self.client.post(
			f"/api/verification/alumni/{self.alumni_account.id}/invite/",
			{}, format="json",
			HTTP_AUTHORIZATION=f"Bearer {generate_alumni_access_token(other_account.user_id)}",
		)
		self.assertEqual(response.status_code, 403)
		self.assertEqual(VerificationToken.objects.count(), 0)

	def test_used_link_cannot_be_reused(self):
		alumni_id = str(self.alumni_account.id)
		token_id = self.client.post(
			f"/api/verification/alumni/{alumni_id}/invite/", {}, format="json",
			**self._alumni_auth(),
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

	def _alumni_auth(self):
		return {
			"HTTP_AUTHORIZATION": f"Bearer {generate_alumni_access_token(self.alumni.user_id)}"
		}

	def _invite(self, employer_email=None):
		body = {"employer_email": employer_email} if employer_email else {}
		return self.client.post(
			f"/api/verification/alumni/{self.alumni.id}/invite/", body, format="json",
			**self._alumni_auth(),
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
