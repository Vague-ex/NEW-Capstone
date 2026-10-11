"""
Fill CityMunicipality.zip_code from the bundled philsite scrape.

The source is a flat CSV of `Region,Location,ZIP Code`, where "Region" is really
the province -- or, for NCR, the parent city, so Manila's districts arrive as
`Manila | Binondo | 1006`. Neither column carries a PSGC code, so rows are
matched by folded name in three passes, widest-confidence first:

  1. province + city      the only safe pass. Name alone is NOT, because it
                          collapses the twelve different San Joses onto one row.
  2. parent-city rollup   `Manila | Binondo` belongs to the City of Manila.
  3. unique city name     only when exactly one city nationwide carries it.

Anything still unmatched is reported, never guessed. A city with no match keeps
an empty zip_code, which the admin can fill in Settings -> Locations.

Rows whose code is not exactly four digits are dropped first: that is precisely
the 42 PO-box and institutional entries the site lists ("Ateneo De Manila, 917"),
and it matches the PH rule already enforced in audit_data_quality.
"""

from __future__ import annotations

import csv
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from django.db import transaction

from .models import CityMunicipality

DEFAULT_DATA_FILE = Path(__file__).resolve().parent / "data" / "ph_zip_codes_philsite.csv"

#: Words that say nothing about which place a name refers to.
_NOISE = re.compile(r"\b(city|municipality|of|the)\b")
#: "Kalookan City (North)" and "(South)" are one city to the PSA.
_QUALIFIER = re.compile(r"\([^)]*\)")
#: Spellings the scrape uses that the PSA does not.
_ALIASES = {"kalookan": "caloocan"}
#: The scrape abbreviates saints, the PSA spells them out.
_ABBREVIATIONS = ((r"\bsta\b", "santa"), (r"\bsto\b", "santo"), (r"\bgen\b", "general"))


def fold(name: str) -> str:
    """Casefold a place name to its comparable core.

    Accents are stripped so "Parañaque" and "Paranaque" meet, "City of" is
    dropped so the PSA's "City of Makati" meets the scrape's "Makati", and a
    parenthetical qualifier goes so "Kalookan City (North)" meets Caloocan.
    """
    decomposed = unicodedata.normalize("NFKD", name or "")
    plain = "".join(ch for ch in decomposed if not unicodedata.combining(ch)).lower()
    core = re.sub(r"[^a-z0-9]+", " ", _NOISE.sub(" ", _QUALIFIER.sub(" ", plain))).strip()
    for pattern, full in _ABBREVIATIONS:
        core = re.sub(pattern, full, core)
    return _ALIASES.get(core, core)


def drop_initials(name: str) -> str:
    """fold(), minus any single-letter word.

    The PSA writes middle initials the scrape leaves out -- "Enrique B.
    Magalona" against "Enrique Magalona". Used only by the lower-confidence
    passes, so a name that collides once the initial is gone cannot outvote an
    exact province-scoped match.
    """
    return " ".join(word for word in fold(name).split() if len(word) > 1)


def load_rows(path: str | Path | None = None) -> list[tuple[str, str, str]]:
    """Read the CSV as (province_or_parent_city, location, zip), 4-digit codes only."""
    path = Path(path) if path else DEFAULT_DATA_FILE
    rows: list[tuple[str, str, str]] = []
    # utf-8-sig: the scrape carries a BOM, which would otherwise become part of
    # the first header name and break DictReader's "Region" lookup.
    with open(path, "rt", encoding="utf-8-sig", newline="") as handle:
        for raw in csv.DictReader(handle):
            parent = (raw.get("Region") or "").strip()
            location = (raw.get("Location") or "").strip()
            code = (raw.get("ZIP Code") or "").strip()
            if location and len(code) == 4 and code.isdigit():
                rows.append((parent, location, code))
    return rows


@dataclass
class ZipSyncReport:
    applied: bool
    rows: int = 0
    dropped: int = 0
    matched: Counter = field(default_factory=Counter)
    updated: int = 0
    unchanged: int = 0
    cities_with_zip: int = 0
    cities_total: int = 0
    unresolved: list = field(default_factory=list)
    conflicts: list = field(default_factory=list)


class _DryRun(Exception):
    """Raised to roll a dry run back once every change has been worked out."""


def sync_zip_codes(rows, *, apply: bool = False) -> ZipSyncReport:
    """Resolve every row onto a city and write the codes in one transaction.

    A dry run performs the real writes and then rolls them back, so the report
    is exactly what --apply would do rather than an approximation of it.
    """
    report = ZipSyncReport(applied=apply)
    try:
        with transaction.atomic():
            _sync(rows, report)
            if not apply:
                raise _DryRun
    except _DryRun:
        pass
    return report


def _sync(rows, report: ZipSyncReport) -> None:
    cities = list(CityMunicipality.objects.select_related("province").all())
    report.cities_total = len(cities)

    by_province_city: dict[tuple[str, str], list] = defaultdict(list)
    by_name: dict[str, list] = defaultdict(list)
    # The same two indexes with middle initials dropped, so the PSA's
    # "Enrique B. Magalona" meets the scrape's "Enrique Magalona".
    by_province_city_loose: dict[tuple[str, str], list] = defaultdict(list)
    by_name_loose: dict[str, list] = defaultdict(list)
    for city in cities:
        by_name[fold(city.name)].append(city)
        by_name_loose[drop_initials(city.name)].append(city)
        for province in (city.province, city.home_province):
            if province is not None:
                by_province_city[(fold(province.name), fold(city.name))].append(city)
                by_province_city_loose[(fold(province.name), drop_initials(city.name))].append(city)

    # city id -> confidence rank -> the codes that pass offered.
    # Ranked because the passes are not equally trustworthy: a Quezon City
    # barangay called Katipunan would otherwise lend its 1105 to the Zamboanga
    # del Norte municipality of the same name, which is really 7109.
    candidates: dict[str, dict[int, set[str]]] = defaultdict(lambda: defaultdict(set))
    by_id = {str(c.id): c for c in cities}
    passes = {
        1: "province+city",
        2: "province+city, no initials",
        3: "parent rollup",
        4: "unique name",
        5: "unique name, no initials",
    }

    for parent, location, code in rows:
        report.rows += 1
        rank, hit = 1, by_province_city.get((fold(parent), fold(location)))
        if not hit:
            # Still province-scoped, so dropping an initial cannot reach across
            # the country: "Enrique B. Magalona" meets "Enrique Magalona".
            loose = by_province_city_loose.get((fold(parent), drop_initials(location)))
            if loose and len(loose) == 1:
                rank, hit = 2, loose
        if not hit:
            # `Manila | Binondo`: the parent column names the city itself.
            owner = by_name.get(fold(parent)) or []
            if len(owner) > 1:
                # "Quezon City" folds to "quezon", which four municipalities also
                # answer to. Only a city has districts to list, so that breaks it.
                owner = [c for c in owner if c.is_city] or owner
            if len(owner) == 1:
                rank, hit = 3, owner
        if not hit:
            named = by_name.get(fold(location))
            if named and len(named) == 1:
                rank, hit = 4, named
        if not hit:
            named = by_name_loose.get(drop_initials(location))
            if named and len(named) == 1:
                rank, hit = 5, named
        if not hit:
            report.unresolved.append((parent, location, code))
            continue
        report.matched[passes[rank]] += 1
        candidates[str(hit[0].id)][rank].add(code)

    for city_id, by_rank in candidates.items():
        city = by_id[city_id]
        # Only the most trustworthy pass that found this city gets a say.
        codes = by_rank[min(by_rank)]
        # A large city has a code per district (Manila has 18). The lowest is
        # the city-proper code, and the graduate can correct it on the form.
        chosen = min(codes)
        if len(codes) > 1:
            report.conflicts.append((city.name, sorted(codes)))
        if city.zip_code == chosen:
            report.unchanged += 1
            continue
        city.zip_code = chosen
        city.save(update_fields=["zip_code"])
        report.updated += 1

    report.dropped = len(report.unresolved)
    report.cities_with_zip = len(candidates)
