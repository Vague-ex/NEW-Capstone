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


import json as _json


class BarangayAdminApiTests(TestCase):
	"""Admin add / rename / soft-delete of barangays from Settings > Regions."""

	def setUp(self):
		self.client = APIClient()
		region = Region.objects.create(code="NIR", name="Negros Island Region (NIR)", psgc_id="1800000000")
		province = Province.objects.create(region=region, name="Negros Occidental", psgc_id="1804500000")
		self.city = CityMunicipality.objects.create(region=region, province=province, name="Enrique B. Magalona", psgc_id="1804508000")
		admin = User.objects.create_user(
			email="brgy-admin@example.com", password="AdminPass123!", role=User.Role.ADMIN, is_staff=True,
		)
		self.auth = {"HTTP_AUTHORIZATION": f"Bearer {generate_admin_access_token(admin.id)}"}

	def _create(self, **overrides):
		body = {"name": "San Jose", "city_id": str(self.city.id), "psgc_id": "1804508018", **overrides}
		return self.client.post("/api/reference/barangays/", body, format="json", **self.auth)

	def _names(self):
		response = self.client.get(f"/api/reference/barangays/?city={self.city.id}")
		return [b["name"] for b in response.data["barangays"]]

	def test_writes_require_admin(self):
		response = self.client.post(
			"/api/reference/barangays/",
			{"name": "San Jose", "city_id": str(self.city.id), "psgc_id": "1804508018"},
			format="json",
		)
		self.assertEqual(response.status_code, 401)

	def test_create_rename_and_soft_delete(self):
		created = self._create()
		self.assertEqual(created.status_code, 201)
		barangay_id = created.data["barangay"]["id"]
		self.assertEqual(self._names(), ["San Jose"])

		renamed = self.client.patch(
			f"/api/reference/barangays/{barangay_id}/", {"name": "San Jose (Pob.)"}, format="json", **self.auth,
		)
		self.assertEqual(renamed.status_code, 200)
		self.assertEqual(self._names(), ["San Jose (Pob.)"])

		deleted = self.client.delete(f"/api/reference/barangays/{barangay_id}/", **self.auth)
		self.assertEqual(deleted.status_code, 204)
		self.assertEqual(self._names(), [])
		# Soft delete: the row survives for saved addresses and PSGC re-syncs.
		self.assertFalse(Barangay.objects.get(pk=barangay_id).is_active)

	def test_rejects_bad_input(self):
		self.assertEqual(self._create(name="").status_code, 400)
		self.assertEqual(self._create(city_id="not-a-uuid").status_code, 404)
		self.assertEqual(self._create().status_code, 201)
		self.assertEqual(self._create(name="Duplicate").status_code, 409)


class CspReportTests(TestCase):
	"""
	POST /api/csp-report/ receives the browser's Content-Security-Policy
	violation reports while the full policy runs in report-only mode.
	"""

	URL = "/api/csp-report/"
	LEGACY_REPORT = _json.dumps({
		"csp-report": {
			"document-uri": "https://gradtracer.tech/register/alumni",
			"violated-directive": "img-src",
			"effective-directive": "img-src",
			"blocked-uri": "https://evil.example/x.png",
		}
	})

	def setUp(self):
		_cache.clear()
		self.client = APIClient()

	def _report(self, body, content_type="application/csp-report"):
		return self.client.generic("POST", self.URL, body, content_type=content_type)

	def test_legacy_report_is_logged(self):
		with self.assertLogs("tracer.api", level="WARNING") as logs:
			response = self._report(self.LEGACY_REPORT)
		self.assertEqual(response.status_code, 204)
		self.assertEqual(len(logs.output), 1)
		self.assertIn("directive=img-src", logs.output[0])
		self.assertIn("blocked=https://evil.example/x.png", logs.output[0])
		self.assertIn("page=https://gradtracer.tech/register/alumni", logs.output[0])

	def test_reporting_api_batch_is_logged(self):
		"""Newer browsers send a JSON array in the Reporting API format."""
		body = _json.dumps([
			{"type": "csp-violation", "body": {
				"documentURL": "https://gradtracer.tech/",
				"effectiveDirective": "connect-src",
				"blockedURL": "https://tracker.example/beacon",
			}},
			{"type": "deprecation", "body": {"id": "ignored"}},
		])
		with self.assertLogs("tracer.api", level="WARNING") as logs:
			response = self._report(body, "application/reports+json")
		self.assertEqual(response.status_code, 204)
		self.assertEqual(len(logs.output), 1)
		self.assertIn("directive=connect-src", logs.output[0])

	def test_long_fields_are_trimmed(self):
		body = _json.dumps({"csp-report": {"violated-directive": "img-src", "blocked-uri": "https://x.example/" + "a" * 1000}})
		with self.assertLogs("tracer.api", level="WARNING") as logs:
			self._report(body)
		self.assertLess(len(logs.output[0]), 600)

	def test_malformed_and_oversized_bodies_are_dropped_silently(self):
		oversized = _json.dumps({"csp-report": {"violated-directive": "img-src", "blocked-uri": "x" * 9000}})
		with self.assertNoLogs("tracer.api", level="WARNING"):
			self.assertEqual(self._report("not json").status_code, 204)
			self.assertEqual(self._report(oversized).status_code, 204)
			self.assertEqual(self._report(_json.dumps({"unexpected": True})).status_code, 204)

	def test_only_post_is_allowed(self):
		self.assertEqual(self.client.get(self.URL).status_code, 405)

	def test_rate_limited_per_client(self):
		from .api import CspReportView

		with self.assertLogs("tracer.api", level="WARNING") as logs:
			for _ in range(CspReportView.RATE_LIMIT + 5):
				self.assertEqual(self._report(self.LEGACY_REPORT).status_code, 204)
		self.assertEqual(len(logs.output), CspReportView.RATE_LIMIT)


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
		for year in (2019, timezone.now().year):
			result = validate_registration_payload(
				self.CLEAN_SURVEY, dict(self.CLEAN_PERSONAL, graduation_year=year)
			)
			self.assertTrue(result['is_valid'], f'year {year} should be accepted')

		future = validate_registration_payload(
			self.CLEAN_SURVEY, dict(self.CLEAN_PERSONAL, graduation_year=2999)
		)
		self.assertFalse(future['is_valid'])

	def test_future_graduation_dates_are_refused(self):
		"""
		Allowing next year let 2027 graduates register, and they then appeared in
		analytics as a batch that has not graduated yet.
		"""
		today = timezone.now()
		next_year = validate_registration_payload(
			self.CLEAN_SURVEY, dict(self.CLEAN_PERSONAL, graduation_year=today.year + 1)
		)
		self.assertFalse(next_year['is_valid'])

		year, month = (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
		next_month = validate_registration_payload(
			self.CLEAN_SURVEY,
			dict(self.CLEAN_PERSONAL, graduation_year=year, graduation_date=f'{year}-{month:02d}'),
		)
		self.assertFalse(next_month['is_valid'])
		self.assertTrue({'graduation_date', 'graduation_year'} & set(next_month['field_errors']))

		this_month = validate_registration_payload(
			self.CLEAN_SURVEY,
			dict(self.CLEAN_PERSONAL, graduation_year=today.year, graduation_date=f'{today.year}-{today.month:02d}'),
		)
		self.assertTrue(this_month['is_valid'], this_month.get('field_errors'))

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


def _graduate_rows(n, strength, seed=7):
	"""Synthetic graduate frame where `strength` scales how much the
	pre-graduation answers decide the 12-month outcome (0 = not at all)."""
	import numpy as np
	import pandas as pd
	from tracer.employability import FRAME_COLUMNS, TARGET

	rng = np.random.default_rng(seed)
	honors = rng.choice([1, 2, 3, 4], size=n, p=[0.8, 0.12, 0.06, 0.02])
	prior = rng.integers(0, 2, n)
	ojt = rng.integers(1, 4, n).astype(float)
	ojt[rng.random(n) < 0.2] = np.nan
	portfolio = rng.integers(0, 2, n)
	scholarship = (rng.random(n) < 0.25).astype(int)
	logit = -0.2 + strength * (
		0.9 * prior + 0.7 * (np.nan_to_num(ojt, nan=2.0) - 2) + 0.8 * portfolio + 0.3 * (honors - 1)
	)
	outcome = (rng.random(n) < 1 / (1 + np.exp(-logit))).astype(int)
	frame = pd.DataFrame({
		"alumni_id": [f"T{i}" for i in range(n)],
		"batch": rng.choice(range(2019, 2025), size=n),
		"gender": np.where(rng.random(n) < 0.5, "female", "male"),
		"months_since_graduation": 24,
		"academic_honors": honors,
		"prior_work_experience": prior,
		"ojt_relevance": ojt,
		"has_portfolio": portfolio,
		"scholarship": scholarship,
		"employment_status": None,
		"has_outcome": 1,
		"employed_now": outcome,
		"in_labor_force": 1,
		"time_to_hire_months": np.nan,
		TARGET: outcome,
		"bsis_first": np.nan,
		"bsis_current": np.nan,
		"is_sample": False,
		"future_graduation": False,
	})
	return frame[FRAME_COLUMNS]


class EmployabilityIndicatorTests(SimpleTestCase):
	"""Derived variables and rates. A missing or tiny group must never read as 0%."""

	def test_wilson_interval_brackets_the_rate_and_handles_no_data(self):
		from tracer.employability import wilson_interval

		low, high = wilson_interval(6, 10)
		self.assertLess(low, 0.6)
		self.assertGreater(high, 0.6)
		self.assertEqual(wilson_interval(0, 0), (None, None))

	def test_small_groups_are_suppressed_and_empty_groups_are_null(self):
		from tracer.employability import rate_estimate

		tiny = rate_estimate([1, 1, 0])
		self.assertTrue(tiny["suppressed"])
		self.assertIsNone(tiny["rate"])

		empty = rate_estimate([None, float("nan")])
		self.assertEqual(empty["n"], 0)
		self.assertIsNone(empty["rate"])
		self.assertFalse(empty["suppressed"])

		shown = rate_estimate([1] * 6 + [0] * 4)
		self.assertAlmostEqual(shown["rate"], 0.6)
		self.assertLessEqual(shown["ci_low"], 0.6)
		self.assertGreaterEqual(shown["ci_high"], 0.6)

	def test_employed_within_12_months_derivation(self):
		from tracer.employability import employed_within_12_months as within

		self.assertEqual(within("employed_full_time", 9, 30), 1)   # "6 months to 1 year"
		self.assertEqual(within("employed_full_time", 18, 40), 0)  # "1-2 years"
		self.assertEqual(within("seeking", None, 30), 0)           # still looking after a year
		self.assertIsNone(within("seeking", None, 6))              # still inside the 12-month window
		self.assertIsNone(within("not_seeking", None, 30))         # not in the labor force
		self.assertIsNone(within("employed_full_time", None, 30))  # employed, hire time unknown

	def test_model_inputs_are_all_known_at_graduation(self):
		"""The previous model read job fields only employed graduates can fill in."""
		from tracer.employability import MODEL_FEATURES, leaked_features

		self.assertEqual(leaked_features(MODEL_FEATURES), [])
		self.assertEqual(
			leaked_features(["ojt_relevance", "current_sector_2", "first_job_source", "technical_skill_count"]),
			["current_sector_2", "first_job_source", "technical_skill_count"],
		)

	def test_expected_range_is_wide_until_enough_batches_exist(self):
		from tracer.employability import employment_outlook

		def batch(year, rate):
			return {"batch": year, "employment_rate": {"rate": rate}}

		self.assertFalse(employment_outlook([batch(2023, 0.6)])["available"])
		short = employment_outlook([batch(2023, 0.6), batch(2024, 0.7)])
		self.assertEqual(short["basis"], "default")
		self.assertAlmostEqual(short["years"][0]["high"] - short["years"][0]["low"], 0.4)


class EmployabilityGateTests(SimpleTestCase):
	"""The acceptance gate decides whether a model may be shown at all."""

	def test_gate_rejects_a_model_that_predicts_nothing(self):
		from tracer.employability import evaluate_candidate

		result = evaluate_candidate(_graduate_rows(600, strength=0.0), repeats=3, n_boot=40)
		self.assertFalse(result["passed"])
		checks = {c["key"]: c for c in result["checks"]}
		self.assertFalse(checks["discrimination"]["passed"])

	def test_gate_accepts_an_informative_model(self):
		from tracer.employability import evaluate_candidate

		result = evaluate_candidate(_graduate_rows(900, strength=2.0), repeats=3, n_boot=40)
		failed = [c for c in result["checks"] if not c["passed"]]
		self.assertTrue(result["passed"], failed)
		self.assertTrue(any(f["clear"] and f["odds_ratio"] > 1 for f in result["factors"]))

	def test_only_a_passing_version_can_be_activated(self):
		import shutil
		import tempfile
		from tracer import employability as E

		folder = tempfile.mkdtemp()
		self.addCleanup(shutil.rmtree, folder, ignore_errors=True)
		with self.settings(EMPLOYABILITY_MODEL_DIR=folder):
			weak = _graduate_rows(600, strength=0.0)
			failed_version, _ = E.save_version(E.evaluate_candidate(weak, repeats=3, n_boot=20), weak, "test")
			with self.assertRaises(ValueError):
				E.activate_version(failed_version)
			self.assertIsNone(E.load_active_model())

			strong = _graduate_rows(900, strength=2.0)
			passed_version, _ = E.save_version(E.evaluate_candidate(strong, repeats=3, n_boot=20), strong, "test")
			E.activate_version(passed_version)
			active = E.load_active_model()
			self.assertEqual(active["version"], passed_version)
			self.assertEqual(active["meta"]["features"], E.MODEL_FEATURES)


class EmployabilityApiTests(TestCase):
	"""Endpoint and report built from real graduate rows, with no active model."""

	def setUp(self):
		import shutil
		import tempfile
		from django.core.cache import cache

		cache.clear()
		self.model_dir = tempfile.mkdtemp()
		self.addCleanup(shutil.rmtree, self.model_dir, ignore_errors=True)
		admin = User.objects.create_user(
			email="analytics-admin@example.com", password="AdminPass123!", role=User.Role.ADMIN, is_staff=True,
		)
		self.headers = {"HTTP_AUTHORIZATION": f"Bearer {generate_admin_access_token(admin.id)}"}
		for i, (status_value, months) in enumerate([("employed_full_time", 3), ("seeking", None), (None, None)]):
			user = User.objects.create_user(
				email=f"graduate{i}@example.com", password="TestPass123!", role=User.Role.ALUMNI,
			)
			account = AlumniAccount.objects.create(user=user, account_status=AccountStatus.ACTIVE)
			AlumniProfile.objects.create(
				alumni=account, first_name="Grad", last_name=["Reyes", "Santos", "Cruz"][i],
				graduation_year=2022, graduation_date="2022-06",
			)
			if status_value:
				EmploymentProfile.objects.create(
					alumni=account, employment_status=status_value, time_to_hire_months=months,
				)

	def test_graduate_frame_keeps_unknown_outcomes_unknown(self):
		from tracer.employability import TARGET, build_graduate_frame

		frame = build_graduate_frame().set_index("employment_status", drop=False)
		self.assertEqual(len(frame), 3)
		unanswered = frame[frame["has_outcome"] == 0].iloc[0]
		self.assertTrue(unanswered.isna()["employed_now"])
		self.assertTrue(unanswered.isna()[TARGET])
		self.assertEqual(frame.loc["employed_full_time", TARGET], 1)
		# Graduated June 2022 and still looking: more than 12 months, so 0.
		self.assertEqual(frame.loc["seeking", TARGET], 0)

	def test_endpoint_reports_observed_values_without_a_model(self):
		with self.settings(EMPLOYABILITY_MODEL_DIR=self.model_dir):
			response = APIClient().get("/api/admin/analytics/employability-predictions/", **self.headers)
		self.assertEqual(response.status_code, 200)
		data = response.json()
		self.assertEqual(data["model"]["status"], "none")
		self.assertNotIn("forecast", data)
		self.assertEqual(data["overall"]["respondents"], 3)
		# Two graduates in the labor force: too few to show, and never 0%.
		self.assertTrue(data["overall"]["employment_rate"]["suppressed"])
		self.assertIsNone(data["overall"]["employment_rate"]["rate"])

	def test_endpoint_requires_admin(self):
		response = APIClient().get("/api/admin/analytics/employability-predictions/")
		self.assertIn(response.status_code, (401, 403))

	def test_predictive_trend_report_builds(self):
		with self.settings(EMPLOYABILITY_MODEL_DIR=self.model_dir):
			response = APIClient().get("/api/admin/reports/predictive-trend/", **self.headers)
		self.assertEqual(response.status_code, 200)
		titles = [s["title"] for s in response.json()["sections"]]
		self.assertIn("Cross-Batch Timeline", titles)
		self.assertIn("Model Acceptance Checks", titles)


class EmployabilityDataGuardTests(SimpleTestCase):
	"""Future graduation dates stay out of analytics, and skills are counted once."""

	def test_future_graduation_dates_are_detected(self):
		from datetime import datetime
		from tracer.employability import is_future_graduation

		now = datetime(2026, 9, 16)
		self.assertTrue(is_future_graduation("2027-04", 2027, now))
		self.assertTrue(is_future_graduation("2026-10", 2026, now))
		self.assertFalse(is_future_graduation("2026-09", 2026, now))
		self.assertTrue(is_future_graduation("", 2027, now))
		self.assertFalse(is_future_graduation("", 2026, now))

	def test_future_graduates_are_left_out_and_counted(self):
		from tracer.employability import analytics_payload

		frame = _graduate_rows(40, strength=1.0)
		frame.loc[frame.index[:3], "batch"] = 2027
		frame.loc[frame.index[:3], "future_graduation"] = True
		payload = analytics_payload(frame, {2024: 10})
		self.assertEqual(payload["data_issues"]["future_graduation"], 3)
		self.assertNotIn(2027, [b["batch"] for b in payload["per_batch"]])
		self.assertEqual(payload["overall"]["respondents"], 37)

	def test_expected_range_follows_the_latest_reported_batch(self):
		from tracer.employability import employment_outlook

		batches = [
			{"batch": 2023, "employment_rate": {"rate": 0.7}},
			{"batch": 2024, "employment_rate": {"rate": 0.8}},
			{"batch": 2027, "employment_rate": {"rate": None}},
		]
		self.assertEqual(employment_outlook(batches)["years"][0]["batch"], 2025)

	def test_skill_names_are_merged_and_typed_from_the_form_lists(self):
		from tracer.employability import _CANONICAL_SKILLS, rate_difference, skill_key

		self.assertEqual(skill_key("Technical Support / Troubleshooting"), skill_key("technical support/troubleshooting"))
		self.assertEqual(_CANONICAL_SKILLS[skill_key("Written Communication")][1], "soft")
		self.assertEqual(_CANONICAL_SKILLS[skill_key("Cloud Computing")][1], "technical")
		difference, low, high = rate_difference(9, 10, 5, 10)
		self.assertAlmostEqual(difference, 0.4)
		self.assertLess(low, 0.4)
		self.assertGreater(high, 0.4)


class GraduationDateEditTests(TestCase):
	"""The Personal & Education page saves through the employment update endpoint."""

	def test_portal_refuses_a_future_graduation_date(self):
		user = User.objects.create_user(email="future-grad@example.com", password="TestPass123!", role=User.Role.ALUMNI)
		account = AlumniAccount.objects.create(user=user, account_status=AccountStatus.ACTIVE)
		AlumniProfile.objects.create(alumni=account, first_name="Ana", last_name="Reyes", graduation_year=2022)
		today = timezone.now()
		year, month = (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
		response = APIClient().post(
			f"/api/auth/alumni/account/{account.id}/employment/",
			{"survey_data": {"graduationDate": f"{year}-{month:02d}"}},
			format="json",
			HTTP_AUTHORIZATION=f"Bearer {generate_alumni_access_token(user.id)}",
		)
		self.assertEqual(response.status_code, 400)
		self.assertIn("graduationDate", response.json()["field_errors"])


class SimulatedSourceTests(TestCase):
	"""Seeded simulated graduates stay apart from real ones, switched on /admin/debug/a."""

	def setUp(self):
		import shutil
		import tempfile
		from django.core.cache import cache

		cache.clear()
		self.model_dir = tempfile.mkdtemp()
		self.addCleanup(shutil.rmtree, self.model_dir, ignore_errors=True)
		admin = User.objects.create_user(
			email="debug-admin@example.com", password="AdminPass123!", role=User.Role.ADMIN, is_staff=True,
		)
		self.headers = {"HTTP_AUTHORIZATION": f"Bearer {generate_admin_access_token(admin.id)}"}
		self.real = self._graduate("real.grad@example.com", sample=False)
		self.simulated = self._graduate("bea.santos21@gmail.test", sample=True)

	def _graduate(self, email, sample):
		user = User.objects.create_user(email=email, password=None, role=User.Role.ALUMNI)
		account = AlumniAccount.objects.create(
			user=user, account_status=AccountStatus.ACTIVE,
			biometric_template={"is_sample": True} if sample else {},
		)
		AlumniProfile.objects.create(
			alumni=account, first_name="Bea", last_name="Santos", graduation_year=2022, graduation_date="2022-06",
		)
		EmploymentProfile.objects.create(alumni=account, employment_status="employed_full_time", time_to_hire_months=3)
		return account

	def test_frame_follows_the_source(self):
		from tracer import employability as E

		real = E.build_graduate_frame(source=E.SOURCE_REAL)
		simulated = E.build_graduate_frame(source=E.SOURCE_SIMULATED)
		self.assertEqual(list(real["alumni_id"]), [str(self.real.id)])
		self.assertEqual(list(simulated["alumni_id"]), [str(self.simulated.id)])
		self.assertEqual(len(E.build_graduate_frame()), 2)
		self.assertEqual(E.masterlist_counts(E.SOURCE_SIMULATED), {2022: 1})

	def test_settings_default_to_real_and_persist(self):
		from tracer import employability as E

		with self.settings(EMPLOYABILITY_MODEL_DIR=self.model_dir):
			self.assertEqual(E.debug_settings(), {"source": "real", "show_samples_in_verified": False})
			E.update_debug_settings(source="simulated", show_samples_in_verified=True)
			self.assertEqual(E.analytics_source(), "simulated")
			with self.assertRaises(ValueError):
				E.update_debug_settings(source="everything")

	def test_verified_list_hides_simulated_until_toggled(self):
		client = APIClient()
		with self.settings(EMPLOYABILITY_MODEL_DIR=self.model_dir):
			emails = lambda r: sorted(a["email"] for a in r.json()["results"])  # noqa: E731
			self.assertEqual(emails(client.get("/api/admin/alumni/verified/", **self.headers)), ["real.grad@example.com"])

			response = client.put(
				"/api/admin/debug/analytics-settings/", {"show_samples_in_verified": True}, format="json", **self.headers,
			)
			self.assertEqual(response.status_code, 200)
			self.assertEqual(response.json()["counts"], {"real": 1, "simulated": 1})
			self.assertEqual(len(client.get("/api/admin/alumni/verified/", **self.headers).json()["results"]), 2)

			# The geomap follows the analytics source instead.
			client.put("/api/admin/debug/analytics-settings/", {"source": "simulated"}, format="json", **self.headers)
			self.assertEqual(
				emails(client.get("/api/admin/alumni/verified/?purpose=analytics", **self.headers)),
				["bea.santos21@gmail.test"],
			)

	def test_analytics_endpoint_reports_its_source(self):
		from tracer import employability as E

		with self.settings(EMPLOYABILITY_MODEL_DIR=self.model_dir):
			E.update_debug_settings(source="simulated")
			data = APIClient().get("/api/admin/analytics/employability-predictions/", **self.headers).json()
		self.assertEqual(data["data_source"], "simulated")
		self.assertEqual(data["overall"]["respondents"], 1)

	def test_debug_edit_and_bulk_delete(self):
		client = APIClient()
		response = client.patch(
			f"/api/admin/debug/alumni/{self.real.id}/",
			{"firstName": "Carlo", "graduationYear": 2023, "employmentStatus": "seeking"}, format="json", **self.headers,
		)
		self.assertEqual(response.status_code, 200)
		self.real.profile.refresh_from_db()
		self.assertEqual((self.real.profile.first_name, self.real.profile.graduation_year), ("Carlo", 2023))

		bad = client.patch(f"/api/admin/debug/alumni/{self.real.id}/", {"firstName": "C4rlo"}, format="json", **self.headers)
		self.assertEqual(bad.status_code, 400)

		deleted = client.post("/api/admin/debug/simulated-accounts/delete/", **self.headers)
		self.assertEqual(deleted.json()["deleted"], 1)
		self.assertFalse(AlumniAccount.objects.filter(id=self.simulated.id).exists())
		self.assertTrue(AlumniAccount.objects.filter(id=self.real.id).exists())

	def test_no_email_is_sent_to_seeded_addresses(self):
		from unittest.mock import patch
		from users.email_send import send_branded_email

		with patch("users.email_send._send_via_django_smtp") as smtp, patch("users.email_send._send_via_resend") as resend:
			send_branded_email(to_email="bea.santos21@gmail.test", subject="x", template_base="unused", context={})
		smtp.assert_not_called()
		resend.assert_not_called()
