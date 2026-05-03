"""
Nuke every non-admin user + cascading profile/survey rows.

Preserves:
    - AdminCredential rows and their linked User accounts
    - Reference tables (Industry, JobTitle, Skill, Region, SkillCategory)

Usage:
    python backend/manage.py wipe_demo_accounts --confirm
    python backend/manage.py wipe_demo_accounts --force     # skip prompt
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from users.models import AdminCredential, GraduateMasterRecord, User


class Command(BaseCommand):
    help = "Delete all non-admin users and their related data."

    def add_arguments(self, parser):
        parser.add_argument(
            "--confirm",
            action="store_true",
            help="Required to actually delete (no-op without this flag).",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="Skip interactive prompt.",
        )
        parser.add_argument(
            "--keep-masterlist",
            action="store_true",
            help="Do NOT delete GraduateMasterRecord rows.",
        )

    def handle(self, *args, **options):
        if not options["confirm"]:
            self.stdout.write(self.style.WARNING(
                "Dry-run. Pass --confirm to actually delete."
            ))
            return self._preview()

        if not options["force"]:
            self.stdout.write(self.style.WARNING(
                "This will delete ALL alumni + employer users and their survey data."
            ))
            answer = input("Type YES to continue: ").strip()
            if answer != "YES":
                self.stdout.write(self.style.NOTICE("Aborted."))
                return

        with transaction.atomic():
            admin_user_ids = list(
                AdminCredential.objects.values_list("user_id", flat=True)
            )
            victims = User.objects.exclude(id__in=admin_user_ids)
            user_count = victims.count()
            victims.delete()  # cascades to alumni/employer/profile rows

            master_count = 0
            if not options["keep_masterlist"]:
                master_count = GraduateMasterRecord.objects.count()
                GraduateMasterRecord.objects.all().delete()

        self.stdout.write(self.style.SUCCESS(
            f"Deleted {user_count} users + {master_count} master records. "
            f"Admin accounts preserved."
        ))

    def _preview(self):
        admin_ids = list(AdminCredential.objects.values_list("user_id", flat=True))
        total = User.objects.count()
        victims = User.objects.exclude(id__in=admin_ids).count()
        masters = GraduateMasterRecord.objects.count()
        self.stdout.write(f"Users total: {total}")
        self.stdout.write(f"Admin users (preserved): {total - victims}")
        self.stdout.write(f"Users that would be deleted: {victims}")
        self.stdout.write(f"Master-list rows that would be deleted: {masters}")
