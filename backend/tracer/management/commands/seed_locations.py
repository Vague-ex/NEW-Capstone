"""Seed Region / Province / CityMunicipality from the `barangay` PSGC package.

Run:
    python manage.py seed_locations           # idempotent upsert
    python manage.py seed_locations --reset    # truncate provinces+cities first
    python manage.py seed_locations --dry-run  # show counts without writing

Notes:
- Existing `Region` rows are reconciled by case-insensitive name match against
  the package data; if a name doesn't match, a new Region is created. Existing
  rows keep their UUIDs so foreign-key references (WorkAddress.region,
  EmploymentRecord.region) survive.
- Provinces and CityMunicipalities are upserted by `psgc_id`.
- Barangays (~42K rows) are intentionally NOT seeded — they're free-text on
  the form. Adding them would balloon the DB without UX benefit.
- NCR has no provinces in PSGC; cities like Pateros/Manila land directly under
  the region. This is modeled by leaving `CityMunicipality.province_id = NULL`
  in those cases.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from django.core.management.base import BaseCommand
from django.db import transaction

from tracer.models import CityMunicipality, Province, Region


class Command(BaseCommand):
    help = "Seed Region / Province / CityMunicipality reference data from the `barangay` package."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Truncate Province + CityMunicipality before seeding (Region rows preserved).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print counts without writing.",
        )

    def handle(self, *args, **options):
        try:
            import barangay  # noqa: F401
        except ImportError:
            self.stderr.write(self.style.ERROR(
                "The `barangay` package is not installed. Run: pip install barangay"
            ))
            return

        flat = barangay.BARANGAY_FLAT  # type: ignore[attr-defined]
        if not flat:
            self.stderr.write(self.style.ERROR("barangay.BARANGAY_FLAT is empty."))
            return

        # Bucket entries by type for ordered processing.
        by_type: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in flat:
            by_type[row.get("type", "")].append(row)

        self.stdout.write(
            "Source counts: "
            + ", ".join(
                f"{t}={len(by_type.get(t, []))}"
                for t in ["region", "province", "special_geographic_area", "city", "municipality", "submunicipality", "barangay"]
            )
        )

        if options["dry_run"]:
            self.stdout.write(self.style.WARNING("--dry-run set: no DB writes."))
            return

        # Don't wrap everything in one outer transaction — Supabase / hosted
        # Postgres setups enforce a statement timeout, and 1,600+ upserts in a
        # single tx will trip it. Each phase below opens its own short tx and
        # uses chunked bulk upserts for the high-volume tables.
        if options["reset"]:
            with transaction.atomic():
                deleted_cities, _ = CityMunicipality.objects.all().delete()
                deleted_provs, _ = Province.objects.all().delete()
                self.stdout.write(self.style.WARNING(
                    f"Reset: deleted {deleted_cities} cities + {deleted_provs} provinces "
                    f"(Region rows preserved)."
                ))

        psgc_to_region_id = self._upsert_regions(by_type.get("region", []))
        psgc_to_province_id = self._upsert_provinces(
            by_type.get("province", []) + by_type.get("special_geographic_area", []),
            psgc_to_region_id,
        )
        self._upsert_cities(
            by_type.get("city", []) + by_type.get("municipality", []) + by_type.get("submunicipality", []),
            psgc_to_region_id,
            psgc_to_province_id,
        )

        self.stdout.write(self.style.SUCCESS(
            f"Done. Regions={Region.objects.count()}, Provinces={Province.objects.count()}, "
            f"Cities/Municipalities={CityMunicipality.objects.count()}"
        ))

    # ── helpers ────────────────────────────────────────────────────────────

    def _upsert_regions(self, region_rows: list[dict[str, Any]]) -> dict[str, str]:
        """Match existing regions by case-insensitive name; create otherwise. Returns psgc → region_id.

        All UPDATEs collapse into one bulk_update and all CREATEs into one
        bulk_create so the hosted Postgres statement timeout doesn't trip.
        """
        existing_list = list(Region.objects.all())
        existing_by_name = {r.name.strip().lower(): r for r in existing_list}
        existing_codes = {r.code for r in existing_list}
        psgc_to_id: dict[str, str] = {}

        to_update: list[Region] = []
        to_create: list[Region] = []

        for row in region_rows:
            psgc_id = str(row.get("psgc_id") or "")
            name = (row.get("name") or "").strip()
            if not psgc_id or not name:
                continue

            # Try direct name match first; then by code substring (e.g. "Region IV-A").
            match = existing_by_name.get(name.lower())
            if not match:
                for r in existing_list:
                    short = (r.code or "").strip().lower()
                    if short and short in name.lower():
                        match = r
                        break

            if match:
                if match.psgc_id != psgc_id:
                    match.psgc_id = psgc_id
                    to_update.append(match)
                psgc_to_id[psgc_id] = str(match.id)
                continue

            # Build a unique code for the new Region.
            code_seed = name.split("(")[0].strip()[:40] or psgc_id[:8]
            code = code_seed
            suffix = 1
            while code in existing_codes:
                suffix += 1
                code = f"{code_seed[:35]}-{suffix}"
            existing_codes.add(code)

            new_region = Region(
                code=code,
                name=name,
                psgc_id=psgc_id,
                is_active=True,
            )
            to_create.append(new_region)

        if to_update:
            with transaction.atomic():
                Region.objects.bulk_update(to_update, fields=["psgc_id"])

        if to_create:
            with transaction.atomic():
                Region.objects.bulk_create(to_create)
            for r in to_create:
                psgc_to_id[r.psgc_id] = str(r.id)

        self.stdout.write(
            f"  Regions: updated={len(to_update)}, created={len(to_create)}, mapped={len(psgc_to_id)}"
        )
        return psgc_to_id

    def _upsert_provinces(self, province_rows: list[dict[str, Any]], psgc_to_region_id: dict[str, str]) -> dict[str, str]:
        # Build the candidate Province objects up-front, then bulk_create
        # with `update_conflicts` so PostgreSQL does a single ON CONFLICT
        # upsert. This stays well under any per-statement timeout.
        candidates: list[Province] = []
        skipped = 0
        for row in province_rows:
            psgc_id = str(row.get("psgc_id") or "")
            name = (row.get("name") or "").strip()
            parent_psgc = str(row.get("parent_psgc_id") or "")
            if not psgc_id or not name:
                continue
            region_id = psgc_to_region_id.get(parent_psgc)
            if not region_id:
                skipped += 1
                continue
            candidates.append(Province(
                psgc_id=psgc_id,
                name=name,
                region_id=region_id,
                is_active=True,
            ))

        chunk = 500
        total_written = 0
        with transaction.atomic():
            for i in range(0, len(candidates), chunk):
                batch = candidates[i:i + chunk]
                Province.objects.bulk_create(
                    batch,
                    update_conflicts=True,
                    unique_fields=["psgc_id"],
                    update_fields=["name", "region_id", "is_active"],
                )
                total_written += len(batch)

        psgc_to_id = {
            row[0]: str(row[1])
            for row in Province.objects.filter(
                psgc_id__in=[c.psgc_id for c in candidates]
            ).values_list("psgc_id", "id")
        }
        self.stdout.write(f"  Provinces: upserted={total_written}, skipped (no region)={skipped}, mapped={len(psgc_to_id)}")
        return psgc_to_id

    def _upsert_cities(
        self,
        city_rows: list[dict[str, Any]],
        psgc_to_region_id: dict[str, str],
        psgc_to_province_id: dict[str, str],
    ) -> None:
        # Pre-resolve province → region so we don't query inside the loop.
        province_id_to_region_id = {
            str(pid): str(rid)
            for pid, rid in Province.objects.values_list("id", "region_id")
        }

        candidates: list[CityMunicipality] = []
        skipped = 0
        ncr_direct = 0

        for row in city_rows:
            psgc_id = str(row.get("psgc_id") or "")
            name = (row.get("name") or "").strip()
            parent_psgc = str(row.get("parent_psgc_id") or "")
            type_str = (row.get("type") or "").strip()
            if not psgc_id or not name:
                continue

            province_id = psgc_to_province_id.get(parent_psgc)
            if province_id:
                region_id = province_id_to_region_id.get(province_id)
            else:
                region_id = psgc_to_region_id.get(parent_psgc)
                if region_id:
                    ncr_direct += 1

            if not region_id:
                skipped += 1
                continue

            is_city = type_str in {"city", "submunicipality"}
            candidates.append(CityMunicipality(
                psgc_id=psgc_id,
                name=name,
                region_id=region_id,
                province_id=province_id,
                is_city=is_city,
                is_active=True,
            ))

        chunk = 500
        total_written = 0
        # Chunk into separate transactions so a single batch's timeout
        # doesn't roll back already-written cities.
        for i in range(0, len(candidates), chunk):
            batch = candidates[i:i + chunk]
            with transaction.atomic():
                CityMunicipality.objects.bulk_create(
                    batch,
                    update_conflicts=True,
                    unique_fields=["psgc_id"],
                    update_fields=["name", "region_id", "province_id", "is_city", "is_active"],
                )
            total_written += len(batch)

        self.stdout.write(
            f"  Cities/Munis: upserted={total_written}, "
            f"skipped (no parent)={skipped}, region-direct (NCR-style)={ncr_direct}"
        )
