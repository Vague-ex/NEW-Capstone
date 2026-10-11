"""
Fill CityMunicipality.zip_code from the bundled philsite scrape.

    python manage.py sync_city_zip_codes            # dry run: shows every change, writes nothing
    python manage.py sync_city_zip_codes --apply    # performs the changes

Rows are matched by folded name (the source carries no PSGC code); nothing is
deleted, and a city the scrape cannot resolve keeps an empty zip_code for an
admin to fill in Settings -> Locations. See tracer/zip_sync.py for the three
matching passes and why name-alone is not one of them.
"""

from django.core.management.base import BaseCommand

from tracer.zip_sync import DEFAULT_DATA_FILE, load_rows, sync_zip_codes


class Command(BaseCommand):
    help = "Fill city/municipality ZIP codes from the bundled dataset. Dry run unless --apply."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Write the changes. Without it the sync runs and is rolled back.",
        )
        parser.add_argument(
            "--file",
            default=None,
            help=f"ZIP code CSV (default: bundled {DEFAULT_DATA_FILE.name}).",
        )
        parser.add_argument(
            "--show",
            type=int,
            default=20,
            help="Maximum unresolved/conflict lines to print; 0 prints all.",
        )

    def handle(self, *args, **options):
        rows = load_rows(options["file"])
        report = sync_zip_codes(rows, apply=options["apply"])

        mode = "APPLIED" if report.applied else "DRY RUN - nothing was written; re-run with --apply"
        self.stdout.write(self.style.MIGRATE_HEADING(f"City ZIP code sync: {mode}"))
        self.stdout.write(f"  rows read (4-digit codes only) : {report.rows}")
        for how, count in report.matched.most_common():
            self.stdout.write(f"    matched by {how:16s}: {count}")
        self.stdout.write(f"  unresolved rows                : {len(report.unresolved)}")
        self.stdout.write(
            f"  cities given a code            : {report.cities_with_zip} of {report.cities_total}"
        )
        self.stdout.write(f"    written                      : {report.updated}")
        self.stdout.write(f"    already correct              : {report.unchanged}")

        limit = options["show"]
        if report.conflicts:
            self.stdout.write(self.style.MIGRATE_LABEL(
                f"\ncities offering several codes ({len(report.conflicts)}) - the lowest was taken"
            ))
            shown = report.conflicts if limit == 0 else report.conflicts[:limit]
            for name, codes in shown:
                self.stdout.write(f"  {name}: {', '.join(codes)}")

        if report.unresolved:
            self.stdout.write(self.style.MIGRATE_LABEL(
                f"\nunresolved - no city matched, left for an admin ({len(report.unresolved)})"
            ))
            shown = report.unresolved if limit == 0 else report.unresolved[:limit]
            for parent, location, code in shown:
                self.stdout.write(f"  {parent} | {location} | {code}")
            if limit and len(report.unresolved) > limit:
                self.stdout.write(f"  ... and {len(report.unresolved) - limit} more (--show 0 for all)")
