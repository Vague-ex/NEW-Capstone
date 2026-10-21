"""
Load the bundled placedb release into the Country / CountryDivision tables.

These two tables are what turns an abroad address from five free-text boxes
into a Country -> State/Region cascade, so that the same place stops arriving
as "UAE", "U.A.E." and "United Arab Emirates" in three different accounts.

Rows are matched on their code and updated IN PLACE, never deleted and
re-created: a graduate's profile points at a country by ISO code, and divisions
cascade from their country. Anything the release no longer contains is switched
off rather than removed, exactly as psgc_sync does.

Idempotent: a second run against the same file changes nothing.

Data is placedb (https://placedb.org/), CC0-1.0, built from Wikidata. Refresh
the bundled file with `python backend/scripts/fetch_placedb.py <out.json.gz>`.
"""

from __future__ import annotations

import gzip
import json
import math
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from django.db import transaction

from .models import Country, CountryDivision

PLACEDB_RELEASE = "2026-09-20"
DEFAULT_DATA_FILE = Path(__file__).resolve().parent / "data" / f"placedb_{PLACEDB_RELEASE}.json.gz"

LEVELS = ("country", "division")
# Supabase is reached through a connection pooler, where 4,000 single INSERTs
# take minutes and one bulk_create takes seconds.
BATCH_SIZE = 1000


@dataclass
class SyncReport:
    applied: bool = False
    created: dict = field(default_factory=lambda: {level: 0 for level in LEVELS})
    updated: dict = field(default_factory=lambda: {level: 0 for level in LEVELS})
    deactivated: dict = field(default_factory=lambda: {level: 0 for level in LEVELS})
    changes: dict = field(default_factory=lambda: {level: [] for level in LEVELS})
    warnings: list = field(default_factory=list)

    @property
    def changed_anything(self) -> bool:
        return any(
            self.created[level] or self.updated[level] or self.deactivated[level]
            for level in LEVELS
        )


def load_records(path=None) -> dict:
    """The bundled release as {countries: [...], divisions: [...]}."""
    path = Path(path) if path else DEFAULT_DATA_FILE
    if not path.exists():
        raise FileNotFoundError(f"placedb data file not found: {path}")
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as fh:
        data = json.load(fh)
    if not data.get("countries"):
        raise ValueError(f"{path} contains no countries")
    return data


@transaction.atomic
def sync_placedb(data: dict, apply: bool = False) -> SyncReport:
    """Reconcile both tables against `data`. Rolled back unless `apply`."""
    report = SyncReport(applied=apply)

    # Countries, keyed on ISO 3166-1 alpha-2.
    existing = {c.code: c for c in Country.objects.all()}
    seen_codes = set()
    to_create, to_update = [], []
    for row in data["countries"]:
        code = (row.get("code") or "").strip().upper()
        name = (row.get("name") or "").strip()
        if len(code) != 2 or not name:
            report.warnings.append(f"skipped country with bad code/name: {row!r}")
            continue
        seen_codes.add(code)
        country = existing.get(code)
        if country is None:
            to_create.append(Country(code=code, name=name))
            report.created["country"] += 1
            report.changes["country"].append(f"+ {code} {name}")
            continue
        changed = False
        if country.name != name:
            report.changes["country"].append(f"~ {code} {country.name!r} -> {name!r}")
            country.name = name
            changed = True
        if not country.is_active:
            country.is_active = True
            changed = True
            report.changes["country"].append(f"~ {code} switched back on")
        if changed:
            to_update.append(country)
            report.updated["country"] += 1

    stale = []
    for code, country in existing.items():
        if code not in seen_codes and country.is_active:
            country.is_active = False
            stale.append(country)
            report.deactivated["country"] += 1
            report.changes["country"].append(f"- {code} {country.name} switched off")

    Country.objects.bulk_create(to_create, batch_size=BATCH_SIZE)
    Country.objects.bulk_update(to_update + stale, ["name", "is_active"], batch_size=BATCH_SIZE)

    # Divisions, keyed on (country code, name): placedb leaves iso_3166_2 blank
    # for roughly a fifth of them, so it cannot be the key.
    countries = {c.code: c for c in Country.objects.all()}
    existing_divisions = {
        (d.country.code, d.name): d
        for d in CountryDivision.objects.select_related("country")
    }
    seen_divisions = set()
    div_create, div_update = [], []
    for row in data.get("divisions", []):
        code = (row.get("country") or "").strip().upper()
        name = (row.get("name") or "").strip()
        country = countries.get(code)
        if country is None or not name:
            report.warnings.append(f"skipped division with unknown country: {row!r}")
            continue
        key = (code, name)
        if key in seen_divisions:
            continue
        seen_divisions.add(key)
        iso = (row.get("iso_3166_2") or "").strip()
        lat, lon = row.get("lat"), row.get("lon")

        division = existing_divisions.get(key)
        if division is None:
            div_create.append(CountryDivision(
                country=country, name=name, iso_3166_2=iso, latitude=lat, longitude=lon,
            ))
            report.created["division"] += 1
            report.changes["division"].append(f"+ {code} {name}")
            continue
        fields = []
        for attr, value in (("iso_3166_2", iso), ("latitude", lat), ("longitude", lon)):
            if getattr(division, attr) != value:
                setattr(division, attr, value)
                fields.append(attr)
        if not division.is_active:
            division.is_active = True
            fields.append("is_active")
        if fields:
            div_update.append(division)
            report.updated["division"] += 1
            report.changes["division"].append(f"~ {code} {name} ({', '.join(fields)})")

    div_stale = []
    for key, division in existing_divisions.items():
        if key not in seen_divisions and division.is_active:
            division.is_active = False
            div_stale.append(division)
            report.deactivated["division"] += 1
            report.changes["division"].append(f"- {key[0]} {key[1]} switched off")

    CountryDivision.objects.bulk_create(div_create, batch_size=BATCH_SIZE)
    CountryDivision.objects.bulk_update(
        div_update + div_stale,
        ["iso_3166_2", "latitude", "longitude", "is_active"],
        batch_size=BATCH_SIZE,
    )

    _place_countries_on_the_map(data, countries, report)

    if not apply:
        transaction.set_rollback(True)
    return report


def _country_view(points: list[tuple[float, float]]) -> tuple[float, float, int] | None:
    """Centre and zoom that frame a country, from its divisions' coordinates.

    placedb gives coordinates per division but none per country, so the country
    view is derived from the box its divisions sit in. The centre is the box's
    middle rather than the mean, so one distant overseas territory shifts the
    view less than it would drag an average.
    """
    if not points:
        return None
    lats = [lat for lat, _ in points]
    lons = [lon for _, lon in points]
    centre_lat = (min(lats) + max(lats)) / 2
    centre_lon = (min(lons) + max(lons)) / 2

    # Leaflet shows roughly 360/2**zoom degrees of longitude across the map, so
    # the zoom that fits a span is log2(360/span). Latitude is weighted by 2
    # because the viewport is wider than it is tall.
    span = max((max(lats) - min(lats)) * 2, max(lons) - min(lons), 0.05)
    zoom = int(math.floor(math.log2(360 / span)))
    return centre_lat, centre_lon, max(2, min(zoom, 10))


def _place_countries_on_the_map(data: dict, countries: dict, report: SyncReport) -> None:
    by_code: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for row in data.get("divisions", []):
        lat, lon = row.get("lat"), row.get("lon")
        if lat is None or lon is None:
            continue
        by_code[(row.get("country") or "").strip().upper()].append((float(lat), float(lon)))

    to_update = []
    for code, country in countries.items():
        view = _country_view(by_code.get(code, []))
        if view is None:
            continue
        lat, lon, zoom = view
        if (country.latitude, country.longitude, country.map_zoom) == (lat, lon, zoom):
            continue
        country.latitude, country.longitude, country.map_zoom = lat, lon, zoom
        to_update.append(country)

    if to_update:
        Country.objects.bulk_update(
            to_update, ["latitude", "longitude", "map_zoom"], batch_size=BATCH_SIZE,
        )
        report.updated["country"] += len(to_update)
        report.changes["country"].append(f"~ map view set for {len(to_update)} countries")
