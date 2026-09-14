"""
Bring the location reference tables in line with an official PSGC release.

Rows are matched on their PSGC code and updated IN PLACE, never deleted and
re-created. Provinces and cities cascade from their region and an employment
record points at a region, so a delete-and-reload would take all of that with
it. Anything the release does not contain is switched off rather than removed.

What this repairs, as found in the 2026-09 audit:
  - the Region X row had been renamed "Outside of the Philippines" and switched
    off, hiding Northern Mindanao (Cagayan de Oro, Iligan, five provinces);
  - the Caraga row had been renamed "Cordillera Administrative Region", and the
    real Cordillera provinces were filed under it;
  - fourteen empty duplicate regions with no PSGC code;
  - no barangays at all.

Idempotent: a second run against the same release changes nothing.
"""

from __future__ import annotations

import gzip
import json
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from django.db import transaction

from .models import Barangay, CityMunicipality, Province, Region

PSGC_RELEASE = "2026-07-13"
DEFAULT_DATA_FILE = Path(__file__).resolve().parent / "data" / f"psgc_{PSGC_RELEASE}.json.gz"

CITY_TYPES = frozenset({
    "municipality",
    "component_city",
    "highly_urbanized_city",
    "independent_component_city",
})
NOT_A_PROVINCE_SUFFIX = " (Not a Province)"
BATCH_SIZE = 1000

# Region.code as this app spells it. Applied only where a row's current code is
# a placeholder or belongs to a different region; any other existing code is
# left exactly as it is.
CANONICAL_REGION_CODES = {
    "0100000000": "Region I",
    "0200000000": "Region II",
    "0300000000": "Region III",
    "0400000000": "Region IV-A",
    "0500000000": "Region V",
    "0600000000": "Region VI",
    "0700000000": "Region VII",
    "0800000000": "Region VIII",
    "0900000000": "Region IX",
    "1000000000": "Region X",
    "1100000000": "Region XI",
    "1200000000": "Region XII",
    "1300000000": "NCR",
    "1400000000": "CAR",
    "1600000000": "Region XIII",
    "1700000000": "MIMAROPA Region",
    "1800000000": "Negros Island Region",
    "1900000000": "BARMM",
}
PLACEHOLDER_REGION_CODES = frozenset({"", "NA", "N/A"})

# The province each highly urbanized city sits inside, for listing it in the
# dropdown. Source: PhilAtlas city list (checked 2026-09-14). Metro Manila
# cities are absent on purpose: NCR has no provinces. City of Isabela is absent
# because its geographic province (Basilan) is in a different region.
HUC_HOME_PROVINCES = {
    "City of Angeles": "Pampanga",
    "City of Bacolod": "Negros Occidental",
    "City of Baguio": "Benguet",
    "City of Butuan": "Agusan del Norte",
    "City of Cagayan De Oro": "Misamis Oriental",
    "City of Cebu": "Cebu",
    "City of Davao": "Davao del Sur",
    "City of General Santos": "South Cotabato",
    "City of Iligan": "Lanao del Norte",
    "City of Iloilo": "Iloilo",
    "City of Lapu-Lapu": "Cebu",
    "City of Lucena": "Quezon",
    "City of Mandaue": "Cebu",
    "City of Olongapo": "Zambales",
    "City of Puerto Princesa": "Palawan",
    "City of Tacloban": "Leyte",
    "City of Zamboanga": "Zamboanga del Sur",
}


def load_records(path: str | Path | None = None) -> list[dict]:
    """
    Read a PSGC release. Accepts the upstream flat JSON (a list of objects) or
    the compact bundled form: a gzipped list of [type, psgc_id, parent, name].
    """
    path = Path(path) if path else DEFAULT_DATA_FILE
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as handle:
        raw = json.load(handle)
    if raw and isinstance(raw[0], list):
        return [
            {"type": kind, "psgc_id": code, "parent_psgc_id": parent, "name": name}
            for kind, code, parent, name in raw
        ]
    return raw


@dataclass
class SyncReport:
    applied: bool
    created: Counter = field(default_factory=Counter)
    updated: Counter = field(default_factory=Counter)
    deactivated: Counter = field(default_factory=Counter)
    changes: dict = field(default_factory=lambda: defaultdict(list))
    warnings: list = field(default_factory=list)

    def note(self, level: str, line: str) -> None:
        self.changes[level].append(line)

    @property
    def changed_anything(self) -> bool:
        return bool(sum(self.created.values()) + sum(self.updated.values()) + sum(self.deactivated.values()))


class _DryRun(Exception):
    """Raised to roll a dry run back once every change has been worked out."""


def sync_psgc(records: list[dict], *, apply: bool = False) -> SyncReport:
    """
    Sync all four levels in one transaction.

    A dry run performs the real writes and then rolls them back, so the report
    it prints is exactly what --apply would do, not an approximation of it.
    """
    report = SyncReport(applied=apply)
    try:
        with transaction.atomic():
            _sync(records, report)
            if not apply:
                raise _DryRun
    except _DryRun:
        pass
    return report


def _sync(records: list[dict], report: SyncReport) -> None:
    by_code = {r["psgc_id"]: r for r in records}

    def region_code_of(code: str) -> str:
        record = by_code.get(code)
        while record is not None and record["type"] != "region":
            record = by_code.get(record["parent_psgc_id"])
        if record is None:
            raise ValueError(f"PSGC code {code} has no region above it")
        return record["psgc_id"]

    regions = _sync_regions(records, report)
    provinces = _sync_provinces(records, regions, region_code_of, report)
    cities = _sync_cities(records, by_code, regions, provinces, region_code_of, report)
    _sync_barangays(records, by_code, cities, report)


# ── Regions ──────────────────────────────────────────────────────────────────

def _sync_regions(records: list[dict], report: SyncReport) -> dict[str, Region]:
    official = sorted((r for r in records if r["type"] == "region"), key=lambda r: r["psgc_id"])
    official_codes = {r["psgc_id"] for r in official}
    rows = list(Region.objects.all())
    by_psgc = {row.psgc_id: row for row in rows if row.psgc_id in official_codes}
    extras = [row for row in rows if row.psgc_id not in official_codes]

    desired: dict[str, tuple[str, str]] = {}
    for off in official:
        code = off["psgc_id"]
        canonical = CANONICAL_REGION_CODES.get(code, off["name"][:40])
        row = by_psgc.get(code)
        if row is None:
            desired[code] = (off["name"], canonical)
            continue
        others = {c for psgc, c in CANONICAL_REGION_CODES.items() if psgc != code}
        keep = row.code not in PLACEHOLDER_REGION_CODES and row.code not in others
        desired[code] = (off["name"], row.code if keep else canonical)

    # Retire rows the release does not contain, freeing any name or code an
    # official region is about to take. Region.name and Region.code are unique.
    taken_names = {name for name, _ in desired.values()}
    taken_codes = {code for _, code in desired.values()}
    for row in extras:
        changed = []
        if row.name in taken_names:
            row.name = f"{row.name} (legacy)"[:120]
            changed.append("name")
        if row.code in taken_codes:
            row.code = f"{row.code}-legacy"[:40]
            changed.append("code")
        if row.is_active:
            row.is_active = False
            changed.append("is_active")
            report.deactivated["region"] += 1
            report.note("region", f"switched off  {row.name!r} (not in PSGC)")
        if changed:
            row.save(update_fields=changed)

    result: dict[str, Region] = {}
    pending = []
    for off in official:
        row = by_psgc.get(off["psgc_id"])
        if row is None:
            continue
        name, code = desired[off["psgc_id"]]
        diffs = []
        if row.name != name:
            diffs.append(f"name {row.name!r} -> {name!r}")
        if row.code != code:
            diffs.append(f"code {row.code!r} -> {code!r}")
        if not row.is_active:
            diffs.append("switched back on")
        if diffs:
            pending.append((row, name, code, diffs))
        result[off["psgc_id"]] = row

    # Two passes so rows can trade names or codes without tripping the unique
    # constraints mid-way (the Caraga row currently holds the code "CAR").
    for row, _, _, _ in pending:
        row.name = f"__psgc_sync__{row.psgc_id}"
        row.code = f"__{row.psgc_id}"
        row.save(update_fields=["name", "code"])
    for row, name, code, diffs in pending:
        row.name, row.code, row.is_active = name, code, True
        row.save(update_fields=["name", "code", "is_active"])
        report.updated["region"] += 1
        report.note("region", f"{row.psgc_id}  " + "; ".join(diffs))

    for off in official:
        if off["psgc_id"] in result:
            continue
        name, code = desired[off["psgc_id"]]
        result[off["psgc_id"]] = Region.objects.create(
            psgc_id=off["psgc_id"], name=name, code=code, is_active=True,
        )
        report.created["region"] += 1
        report.note("region", f"{off['psgc_id']}  created {name!r} (code {code!r})")
    return result


# ── Provinces ────────────────────────────────────────────────────────────────

def _sync_provinces(records, regions, region_code_of, report) -> dict[str, Province]:
    official = [r for r in records if r["type"] == "province"]
    official_codes = {r["psgc_id"] for r in official}
    rows = {p.psgc_id: p for p in Province.objects.select_related("region")}
    result: dict[str, Province] = {}
    to_update, to_create = [], []

    for off in official:
        region = regions[region_code_of(off["psgc_id"])]
        row = rows.get(off["psgc_id"])
        if row is None:
            row = Province(psgc_id=off["psgc_id"], name=off["name"], region=region, is_active=True)
            to_create.append(row)
            report.created["province"] += 1
            report.note("province", f"{off['psgc_id']}  created {off['name']!r} under {region.name!r}")
        else:
            diffs = []
            if row.name != off["name"]:
                diffs.append(f"name {row.name!r} -> {off['name']!r}")
                row.name = off["name"]
            if row.region_id != region.id:
                diffs.append(f"region {row.region.name!r} -> {region.name!r}")
                row.region = region
            if not row.is_active:
                diffs.append("switched back on")
                row.is_active = True
            if diffs:
                to_update.append(row)
                report.updated["province"] += 1
                report.note("province", f"{row.psgc_id}  {row.name}: " + "; ".join(diffs))
        result[off["psgc_id"]] = row

    for code, row in rows.items():
        if code not in official_codes and row.is_active:
            row.is_active = False
            to_update.append(row)
            report.deactivated["province"] += 1
            report.note("province", f"{code}  switched off {row.name!r} (not a province in PSGC)")

    Province.objects.bulk_update(to_update, ["name", "region", "is_active"], batch_size=BATCH_SIZE)
    Province.objects.bulk_create(to_create, batch_size=BATCH_SIZE)
    return result


# ── Cities and municipalities ────────────────────────────────────────────────

def _official_cities(records: list[dict], by_code: dict) -> list[dict]:
    """
    City-level records, minus duplicates of the same place.

    The PSA lists some cities twice: "City of Isabela (Not a Province)" at the
    province level, with "City of Isabela" beneath it holding the barangays.
    That is one city to a graduate, so the inner entry is folded into the outer.
    """
    out = []
    for record in records:
        if record["type"] not in CITY_TYPES:
            continue
        parent = by_code.get(record["parent_psgc_id"])
        if parent is not None and parent["type"] in CITY_TYPES:
            continue
        out.append(record)
    return out


def _display_city_name(name: str) -> str:
    return name[: -len(NOT_A_PROVINCE_SUFFIX)] if name.endswith(NOT_A_PROVINCE_SUFFIX) else name


def _sync_cities(records, by_code, regions, provinces, region_code_of, report) -> dict[str, CityMunicipality]:
    official = _official_cities(records, by_code)
    official_codes = {r["psgc_id"] for r in official}
    provinces_by_name: dict[str, list[Province]] = defaultdict(list)
    for province in provinces.values():
        provinces_by_name[province.name].append(province)

    rows = {
        c.psgc_id: c
        for c in CityMunicipality.objects.select_related("region", "province", "home_province")
    }
    result: dict[str, CityMunicipality] = {}
    to_update, to_create = [], []

    for off in official:
        region = regions[region_code_of(off["psgc_id"])]
        parent = by_code.get(off["parent_psgc_id"])
        province = provinces.get(parent["psgc_id"]) if parent and parent["type"] == "province" else None

        home = None
        home_name = HUC_HOME_PROVINCES.get(off["name"])
        if home_name:
            candidates = [p for p in provinces_by_name.get(home_name, []) if p.region_id == region.id]
            if len(candidates) == 1:
                home = candidates[0]
            else:
                report.warnings.append(
                    f"{off['name']}: no single province named {home_name!r} in {region.name!r}"
                )

        name = _display_city_name(off["name"])
        is_city = off["type"] != "municipality"
        row = rows.get(off["psgc_id"])
        if row is None:
            row = CityMunicipality(
                psgc_id=off["psgc_id"], name=name, region=region, province=province,
                home_province=home, is_city=is_city, is_active=True,
            )
            to_create.append(row)
            report.created["city"] += 1
            report.note("city", f"{off['psgc_id']}  created {name!r} in {region.name!r}")
        else:
            diffs = []
            if row.name != name:
                diffs.append(f"name {row.name!r} -> {name!r}")
                row.name = name
            if row.region_id != region.id:
                diffs.append(f"region {row.region.name!r} -> {region.name!r}")
                row.region = region
            if row.province_id != (province.id if province else None):
                before = row.province.name if row.province_id else None
                diffs.append(f"province {before!r} -> {province.name if province else None!r}")
                row.province = province
            if row.home_province_id != (home.id if home else None):
                diffs.append(f"listed under {home.name if home else None!r}")
                row.home_province = home
            if row.is_city != is_city:
                diffs.append(f"is_city {row.is_city} -> {is_city}")
                row.is_city = is_city
            if not row.is_active:
                diffs.append("switched back on")
                row.is_active = True
            if diffs:
                to_update.append(row)
                report.updated["city"] += 1
                report.note("city", f"{row.psgc_id}  {name}: " + "; ".join(diffs))
        result[off["psgc_id"]] = row

    for code, row in rows.items():
        if code not in official_codes and row.is_active:
            row.is_active = False
            to_update.append(row)
            report.deactivated["city"] += 1
            report.note("city", f"{code}  switched off {row.name!r} (code not in PSGC)")

    CityMunicipality.objects.bulk_update(
        to_update,
        ["name", "region", "province", "home_province", "is_city", "is_active"],
        batch_size=BATCH_SIZE,
    )
    CityMunicipality.objects.bulk_create(to_create, batch_size=BATCH_SIZE)
    return result


# ── Barangays ────────────────────────────────────────────────────────────────

def _sync_barangays(records, by_code, cities, report) -> None:
    def city_for(code: str) -> CityMunicipality | None:
        # Walk up past Manila's districts and the folded "(Not a Province)"
        # entries until reaching a city this app has a row for.
        record = by_code.get(code)
        while record is not None:
            if record["psgc_id"] in cities:
                return cities[record["psgc_id"]]
            record = by_code.get(record["parent_psgc_id"])
        return None

    official = [r for r in records if r["type"] == "barangay"]
    existing = {b.psgc_id: b for b in Barangay.objects.all()}
    seen: set[str] = set()
    to_create, to_update = [], []
    unlinked = 0

    for off in official:
        city = city_for(off["parent_psgc_id"])
        if city is None:
            unlinked += 1
            continue
        seen.add(off["psgc_id"])
        row = existing.get(off["psgc_id"])
        if row is None:
            to_create.append(Barangay(psgc_id=off["psgc_id"], name=off["name"], city=city, is_active=True))
        elif row.name != off["name"] or row.city_id != city.id or not row.is_active:
            row.name, row.city, row.is_active = off["name"], city, True
            to_update.append(row)

    stale = [row for code, row in existing.items() if code not in seen and row.is_active]
    for row in stale:
        row.is_active = False

    Barangay.objects.bulk_create(to_create, batch_size=BATCH_SIZE)
    Barangay.objects.bulk_update(to_update + stale, ["name", "city", "is_active"], batch_size=BATCH_SIZE)

    report.created["barangay"] += len(to_create)
    report.updated["barangay"] += len(to_update)
    report.deactivated["barangay"] += len(stale)
    report.note(
        "barangay",
        f"{len(official)} in PSGC: {len(to_create)} created, {len(to_update)} updated, {len(stale)} switched off",
    )
    if unlinked:
        report.warnings.append(f"{unlinked} barangays could not be linked to a city and were skipped")
