"""Recompute GraduateMasterRecord.last_name from full_name.

Run:
    python manage.py repair_master_last_names --dry-run   # show what would change
    python manage.py repair_master_last_names             # apply

Why this matters
----------------
AlumniRegisterView rejects a registration when the submitted family name does
not equal the master record's last_name. The original masterlist importer took
the final whitespace-separated token as the surname, so a graduate recorded as
"Rolly Lerit Samson Jr." was stored with last_name "Jr." and could never
register — the mismatch check refused them every time.

This command re-derives every surname with the suffix- and comma-aware parser
in users/names.py. It only writes rows whose value actually changes.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from users.models import GraduateMasterRecord
from users.names import derive_last_name


class Command(BaseCommand):
    help = "Recompute GraduateMasterRecord.last_name from full_name."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run", action="store_true",
            help="Report what would change without writing.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        changes = []
        for record in GraduateMasterRecord.objects.all().iterator():
            correct = derive_last_name(record.full_name)
            if correct and correct != (record.last_name or "").strip():
                changes.append((record, record.last_name, correct))

        if not dry_run and changes:
            with transaction.atomic():
                for record, _old, correct in changes:
                    record.last_name = correct
                    record.save(update_fields=["last_name"])

        verb = "Would repair" if dry_run else "Repaired"
        self.stdout.write(self.style.SUCCESS(f"{verb} {len(changes)} record(s)."))
        for record, old, correct in changes[:50]:
            self.stdout.write(f"  {record.full_name!r}: {old!r} -> {correct!r}")

        total = GraduateMasterRecord.objects.count()
        self.stdout.write(f"\nScanned {total} master record(s).")
