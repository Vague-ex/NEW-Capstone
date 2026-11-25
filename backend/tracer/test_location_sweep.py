"""Every PSGC location value against every column that can store one.

A BARMM registration once failed with a bare 500 because
"Bangsamoro Autonomous Region In Muslim Mindanao (BARMM)" is 55 characters and
the column was varchar(50). SQLite does not enforce varchar widths at all, so
the local test run could never have caught it and only Postgres refused the
row -- in front of the panel.

These tests need no database. They compare the bundled PSGC release, which is
the complete set of values the forms can ever submit, against the widths and
constraints declared on the models. A new location column that is too narrow,
or a release that grows a longer name, fails here instead of in production.
"""

from collections import Counter, defaultdict

from django.apps import apps
from django.db import models
from django.test import SimpleTestCase

from tracer.psgc_sync import CITY_TYPES, load_records

# Field-name fragment -> the PSGC level whose values can land in that column.
# Checked in order, so "city_municipality" matches city before municipal.
COLUMN_ROLES = (
    ("barangay", "barangay"),
    ("province", "province"),
    ("region", "region"),
    ("city", "city"),
    ("municipal", "city"),
)

# Columns whose name carries a role word but which never hold a place name.
ROLE_EXEMPT_SUFFIXES = ("_code", "_id")
ROLE_EXEMPT_FRAGMENTS = ("zip", "postal")


def _level(record):
    return "city" if record["type"] in CITY_TYPES else record["type"]


def _role_of(field_name):
    name = field_name.lower()
    if name.endswith(ROLE_EXEMPT_SUFFIXES) or any(f in name for f in ROLE_EXEMPT_FRAGMENTS):
        return None
    return next((level for fragment, level in COLUMN_ROLES if fragment in name), None)


def _location_columns():
    """(model, field, role) for every CharField a place name can reach."""
    for model in apps.get_models():
        for field in model._meta.get_fields():
            if not isinstance(field, models.CharField) or isinstance(field, models.EmailField):
                continue
            role = _role_of(field.name)
            if role:
                yield model, field, role


class PsgcReleaseFitsTheSchemaTests(SimpleTestCase):
    """The release the forms are populated from, against the declared widths."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.records = load_records(None)
        cls.by_level = defaultdict(list)
        for record in cls.records:
            cls.by_level[_level(record)].append(record)
        cls.longest = {
            level: max((r["name"] for r in rows), key=len)
            for level, rows in cls.by_level.items()
        }

    def test_the_release_still_contains_every_level_the_forms_offer(self):
        # A release that dropped a level would make the sweep below vacuously
        # pass: nothing to compare, so no column could ever be too narrow.
        for level in ("region", "province", "city", "barangay"):
            self.assertTrue(self.by_level[level], f"no {level} rows in the release")

    def test_every_psgc_value_fits_every_column_that_can_hold_it(self):
        checked = 0
        for model, field, role in _location_columns():
            longest = self.longest.get(role)
            if longest is None:
                continue
            checked += 1
            self.assertLessEqual(
                len(longest), field.max_length,
                f"{model._meta.label}.{field.name} is varchar({field.max_length}) but "
                f"{role} {longest!r} is {len(longest)} characters",
            )
        # The sweep is only worth anything if it found the columns. Lose the
        # naming convention and this says so rather than passing on nothing.
        self.assertGreaterEqual(checked, 8, "the role matching stopped finding location columns")

    def test_the_longest_assembled_address_fits_a_free_text_address_column(self):
        composite = ", ".join(
            self.longest[level] for level in ("barangay", "city", "province", "region")
        )
        for model, field_name in (
            (apps.get_model("users", "EmployerAccount"), "company_address"),
            (apps.get_model("tracer", "WorkAddress"), "street_address"),
        ):
            width = model._meta.get_field(field_name).max_length
            self.assertLessEqual(
                len(composite), width,
                f"{model._meta.label}.{field_name} is varchar({width}) but the longest "
                f"barangay + city + province + region runs to {len(composite)}",
            )

    def test_region_codes_seed_locations_derives_fit_and_stay_unique(self):
        # seed_locations builds Region.code from the name: name.split("(")[0][:40].
        # Without that slice BARMM overflows a second column, varchar(40) this time.
        from tracer.models import Region

        width = Region._meta.get_field("code").max_length
        codes = [r["name"].split("(")[0].strip()[:40] for r in self.by_level["region"]]
        for code in codes:
            self.assertLessEqual(len(code), width, f"derived region code {code!r} overflows")
        collisions = [code for code, n in Counter(codes).items() if n > 1]
        self.assertEqual(collisions, [], "two regions truncate to the same code")


class PsgcReleaseHonoursTheConstraintsTests(SimpleTestCase):
    """The unique and parent rules the tables declare, checked against the data
    before sync_psgc --apply tries to write it."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.records = load_records(None)

    def test_the_release_has_no_duplicate_psgc_ids(self):
        # psgc_id is unique on Province, CityMunicipality and Barangay, so a
        # duplicated code in the release fails the sync halfway through.
        duplicates = [code for code, n in Counter(r["psgc_id"] for r in self.records).items() if n > 1]
        self.assertEqual(duplicates, [])

    def test_no_two_provinces_in_a_region_share_a_name(self):
        # uniq_province_region_name.
        provinces = [r for r in self.records if r["type"] == "province"]
        pairs = Counter((r.get("parent_psgc_id"), r["name"]) for r in provinces)
        self.assertEqual([pair for pair, n in pairs.items() if n > 1], [])

    def test_every_row_hangs_off_a_parent_in_the_release(self):
        # A city or barangay whose parent is missing cannot be reached by the
        # Region -> Province -> City cascade, so it is unpickable in the form.
        known = {r["psgc_id"] for r in self.records}
        orphans = [
            r for r in self.records
            if r["type"] != "region"
            and r.get("parent_psgc_id")
            and r["parent_psgc_id"] not in known
        ]
        self.assertEqual([r["name"] for r in orphans], [])

    def test_no_letters_only_check_constraint_guards_a_location_column(self):
        # 2,840 barangays carry digits ("Bgy. No. 24"). The name CHECKs that
        # forbid [0-9] are for person and job-title names; pointing one at a
        # location column would reject those rows at the database.
        offenders = []
        for model in apps.get_models():
            for constraint in getattr(model._meta, "constraints", []):
                condition = getattr(constraint, "condition", None)
                if condition is None or "regex" not in str(condition):
                    continue
                for child in str(condition).split("'"):
                    if _role_of(child):
                        offenders.append(f"{model._meta.label}.{constraint.name}")
        self.assertEqual(offenders, [])
