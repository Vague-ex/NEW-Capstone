"""The abroad address cascade: countries and divisions are a closed list.

The point of these two tables is that the same place can no longer arrive as
"UAE", "U.A.E." and "United Arab Emirates" in three accounts, so the checks
here are about the code being the thing that is stored and matched on.
"""

from django.test import TestCase

from tracer.models import Country, CountryDivision
from tracer.placedb_sync import sync_placedb

SAMPLE = {
    "countries": [
        {"code": "AE", "name": "United Arab Emirates"},
        {"code": "SG", "name": "Singapore"},
    ],
    "divisions": [
        {"country": "AE", "name": "Emirate of Dubai", "iso_3166_2": "AE-DU", "lat": 25.26, "lon": 55.31},
        {"country": "AE", "name": "Emirate of Sharjah", "iso_3166_2": "AE-SH", "lat": 25.35, "lon": 55.43},
        {"country": "XX", "name": "Nowhere", "iso_3166_2": "", "lat": None, "lon": None},
    ],
}


class PlacedbSyncTests(TestCase):
    def test_apply_loads_countries_and_divisions(self):
        report = sync_placedb(SAMPLE, apply=True)
        self.assertEqual(report.created["country"], 2)
        self.assertEqual(report.created["division"], 2)  # the XX row has no country
        self.assertEqual(Country.objects.count(), 2)
        dubai = CountryDivision.objects.get(iso_3166_2="AE-DU")
        self.assertEqual(dubai.country.code, "AE")
        self.assertAlmostEqual(dubai.latitude, 25.26)

    def test_dry_run_writes_nothing(self):
        report = sync_placedb(SAMPLE, apply=False)
        self.assertEqual(report.created["country"], 2)
        self.assertEqual(Country.objects.count(), 0)

    def test_running_twice_changes_nothing(self):
        sync_placedb(SAMPLE, apply=True)
        again = sync_placedb(SAMPLE, apply=True)
        self.assertFalse(again.changed_anything)

    def test_a_country_that_leaves_the_release_is_switched_off_not_deleted(self):
        sync_placedb(SAMPLE, apply=True)
        shrunk = {"countries": SAMPLE["countries"][:1], "divisions": SAMPLE["divisions"][:1]}
        report = sync_placedb(shrunk, apply=True)
        self.assertEqual(report.deactivated["country"], 1)
        # Still there: a graduate's profile may point at it by code.
        self.assertFalse(Country.objects.get(code="SG").is_active)
        self.assertEqual(Country.objects.count(), 2)

    def test_a_renamed_country_keeps_its_row(self):
        sync_placedb(SAMPLE, apply=True)
        before = Country.objects.get(code="AE").pk
        renamed = {
            "countries": [{"code": "AE", "name": "UAE"}, SAMPLE["countries"][1]],
            "divisions": SAMPLE["divisions"],
        }
        sync_placedb(renamed, apply=True)
        country = Country.objects.get(code="AE")
        self.assertEqual(country.pk, before)
        self.assertEqual(country.name, "UAE")


class CountryReferenceApiTests(TestCase):
    def setUp(self):
        sync_placedb(SAMPLE, apply=True)

    def test_country_list_is_public_and_sorted_by_name(self):
        response = self.client.get("/api/reference/countries/")
        self.assertEqual(response.status_code, 200)
        names = [c["name"] for c in response.json()["countries"]]
        self.assertEqual(names, sorted(names))
        self.assertIn("Singapore", names)

    def test_divisions_are_filtered_by_country_case_insensitively(self):
        response = self.client.get("/api/reference/country-divisions/?country=ae")
        self.assertEqual(response.status_code, 200)
        divisions = response.json()["divisions"]
        self.assertEqual({d["iso_3166_2"] for d in divisions}, {"AE-DU", "AE-SH"})

    def test_divisions_require_a_country(self):
        # Without this the endpoint would hand back every division on earth.
        self.assertEqual(self.client.get("/api/reference/country-divisions/").status_code, 400)

    def test_an_unknown_country_is_empty_not_an_error(self):
        response = self.client.get("/api/reference/country-divisions/?country=ZZ")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["divisions"], [])

    def test_a_switched_off_country_is_not_offered(self):
        Country.objects.filter(code="SG").update(is_active=False)
        response = self.client.get("/api/reference/countries/")
        self.assertNotIn("SG", [c["code"] for c in response.json()["countries"]])


class CountryMapViewTests(TestCase):
    """Picking a country moves the map to it; picking a division tightens it.

    placedb has no coordinates per country, so the country view is derived from
    the box its divisions sit in.
    """

    def test_a_country_is_centred_on_its_divisions(self):
        sync_placedb(SAMPLE, apply=True)
        ae = Country.objects.get(code="AE")
        # Dubai 25.26 / Sharjah 25.35 -> centre between them.
        self.assertAlmostEqual(ae.latitude, 25.305, places=3)
        self.assertAlmostEqual(ae.longitude, 55.37, places=2)

    def test_a_small_country_zooms_in_further_than_a_large_one(self):
        wide = {
            "countries": [{"code": "XW", "name": "Wideland"}, {"code": "XN", "name": "Narrowland"}],
            "divisions": [
                {"country": "XW", "name": "West", "iso_3166_2": "", "lat": 0.0, "lon": -80.0},
                {"country": "XW", "name": "East", "iso_3166_2": "", "lat": 0.0, "lon": 80.0},
                {"country": "XN", "name": "A", "iso_3166_2": "", "lat": 1.0, "lon": 103.0},
                {"country": "XN", "name": "B", "iso_3166_2": "", "lat": 1.1, "lon": 103.1},
            ],
        }
        sync_placedb(wide, apply=True)
        self.assertLess(
            Country.objects.get(code="XW").map_zoom,
            Country.objects.get(code="XN").map_zoom,
        )

    def test_zoom_stays_within_leaflet_range(self):
        sync_placedb(SAMPLE, apply=True)
        for country in Country.objects.exclude(map_zoom=None):
            self.assertGreaterEqual(country.map_zoom, 2)
            self.assertLessEqual(country.map_zoom, 10)

    def test_a_single_division_country_does_not_divide_by_zero(self):
        one = {
            "countries": [{"code": "XS", "name": "Singleton"}],
            "divisions": [{"country": "XS", "name": "Only", "iso_3166_2": "", "lat": 5.0, "lon": 5.0}],
        }
        sync_placedb(one, apply=True)
        country = Country.objects.get(code="XS")
        self.assertEqual((country.latitude, country.longitude), (5.0, 5.0))
        self.assertEqual(country.map_zoom, 10)

    def test_a_country_with_no_coordinates_has_no_map_view(self):
        none = {
            "countries": [{"code": "XZ", "name": "Nowhereland"}],
            "divisions": [{"country": "XZ", "name": "Void", "iso_3166_2": "", "lat": None, "lon": None}],
        }
        sync_placedb(none, apply=True)
        country = Country.objects.get(code="XZ")
        self.assertIsNone(country.latitude)
        self.assertIsNone(country.map_zoom)

    def test_the_endpoint_hands_the_map_view_to_the_form(self):
        sync_placedb(SAMPLE, apply=True)
        response = self.client.get("/api/reference/countries/")
        ae = next(c for c in response.json()["countries"] if c["code"] == "AE")
        self.assertIsNotNone(ae["latitude"])
        self.assertIsNotNone(ae["longitude"])
        self.assertIsNotNone(ae["map_zoom"])


class WorkAddressCountryCodeTests(TestCase):
    """Registration's work address stores the ISO code, normalised.

    The two hardcoded dropdowns this replaced disagreed with each other, so a
    graduate who registered and then edited their profile changed the stored
    country without touching the field.
    """

    def test_registration_upper_cases_the_country_code(self):
        from users.api import _extract_work_address_data

        extracted = _extract_work_address_data({
            "city_municipality": "Dubai",
            "region": "Abroad",
            "country": "United Arab Emirates",
            "country_code": "ae",
        })
        self.assertEqual(extracted["country_code"], "AE")
        self.assertEqual(extracted["country"], "United Arab Emirates")

    def test_a_missing_country_code_is_blank_not_none(self):
        from users.api import _extract_work_address_data

        extracted = _extract_work_address_data({
            "city_municipality": "Bacolod",
            "region": "Region VI",
        })
        self.assertEqual(extracted["country_code"], "")

    def test_an_abroad_workplace_keeps_its_state_and_region(self):
        """The foreign division goes in `province`, which used to be a dash."""
        from users.api import _extract_work_address_data

        extracted = _extract_work_address_data({
            "city_municipality": "Dubai",
            "region": "Abroad",
            "province_work": "Emirate of Dubai",
            "country": "United Arab Emirates",
            "country_code": "AE",
            "latitude": 25.264444,
            "longitude": 55.311667,
        })
        self.assertEqual(extracted["province"], "Emirate of Dubai")
        self.assertEqual(extracted["region"], "Abroad")
        self.assertEqual(extracted["latitude"], 25.264444)

    def test_an_over_long_code_is_truncated_not_rejected(self):
        from users.api import _extract_work_address_data

        extracted = _extract_work_address_data({
            "city_municipality": "Dubai",
            "region": "Abroad",
            "country_code": "AEX",
        })
        self.assertEqual(len(extracted["country_code"]), 2)
