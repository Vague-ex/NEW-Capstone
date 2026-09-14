"""
Sync regions, provinces, cities and barangays to the bundled PSGC release.

    python manage.py sync_psgc            # dry run: shows every change, writes nothing
    python manage.py sync_psgc --apply    # performs the changes

Rows are matched on PSGC code and updated in place; nothing is deleted. See
tracer/psgc_sync.py for what it repairs and why.
"""

from django.core.management.base import BaseCommand

from tracer.psgc_sync import DEFAULT_DATA_FILE, PSGC_RELEASE, load_records, sync_psgc

LEVELS = ("region", "province", "city", "barangay")


class Command(BaseCommand):
    help = "Sync location reference tables to the PSGC release by code. Dry run unless --apply."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Write the changes. Without it the sync runs and is rolled back.",
        )
        parser.add_argument(
            "--file",
            default=None,
            help=f"PSGC data file (default: bundled {DEFAULT_DATA_FILE.name}).",
        )
        parser.add_argument(
            "--show",
            type=int,
            default=30,
            help="Maximum change lines to print per level; 0 prints all.",
        )

    def handle(self, *args, **options):
        records = load_records(options["file"])
        report = sync_psgc(records, apply=options["apply"])

        mode = "APPLIED" if report.applied else "DRY RUN - nothing was written; re-run with --apply"
        self.stdout.write(self.style.MIGRATE_HEADING(f"PSGC {PSGC_RELEASE} sync: {mode}"))
        self.stdout.write(f"  {'':12s}{'created':>9s}{'updated':>9s}{'switched off':>14s}")
        for level in LEVELS:
            self.stdout.write(
                f"  {level + 's':12s}{report.created[level]:>9d}{report.updated[level]:>9d}"
                f"{report.deactivated[level]:>14d}"
            )

        limit = options["show"]
        for level in LEVELS:
            lines = report.changes.get(level, [])
            if not lines:
                continue
            self.stdout.write(self.style.MIGRATE_LABEL(f"\n{level}s"))
            shown = lines if limit == 0 else lines[:limit]
            for line in shown:
                self.stdout.write(f"  {line}")
            if len(lines) > len(shown):
                self.stdout.write(f"  ... and {len(lines) - len(shown)} more (use --show 0)")

        for warning in report.warnings:
            self.stdout.write(self.style.WARNING(f"warning: {warning}"))
        if not report.changed_anything:
            self.stdout.write(self.style.SUCCESS("\nAlready in sync; nothing to change."))
