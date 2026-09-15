"""Send 2-year retracking email reminders to verified graduates whose employment
record has not been confirmed in two years.

Run daily (e.g. via cron):
    python manage.py send_retracking_reminders
"""

import logging
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import Prefetch
from django.utils import timezone

from tracer.models import EmploymentProfile
from users.models import AccountStatus, AlumniAccount
from users.retracking import (
    REMINDER_COOLDOWN_DAYS,
    graduate_first_name,
    needs_retracking,
    send_retracking_email,
)


LOGGER = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Email verified graduates whose employment record is over 2 years old to prompt retracking."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="List recipients without sending email.",
        )
        parser.add_argument(
            "--from-email",
            default=None,
            help="Override the From address (defaults to DEFAULT_FROM_EMAIL).",
        )
        parser.add_argument(
            "--login-url",
            default=None,
            help="Override the login URL printed in the email body.",
        )

    def handle(self, *args, **options):
        dry_run = options.get("dry_run", False)
        now = timezone.now()
        cooldown_threshold = now - timedelta(days=REMINDER_COOLDOWN_DAYS)
        from_email = options.get("from_email")
        login_url = options.get("login_url")

        # Pending and rejected accounts are never asked to retrace.
        accounts = (
            AlumniAccount.objects.select_related("user", "profile")
            .filter(account_status=AccountStatus.ACTIVE)
            .prefetch_related(
                Prefetch(
                    "employment_profiles",
                    queryset=EmploymentProfile.objects.order_by("-updated_at"),
                    to_attr="_prefetched_emp",
                )
            )
        )

        sent = 0
        skipped = 0
        for account in accounts:
            if not needs_retracking(account):
                continue

            profile = getattr(account, "profile", None)
            if profile and profile.last_retracking_reminder_at and profile.last_retracking_reminder_at >= cooldown_threshold:
                skipped += 1
                continue

            email = account.user.email if account.user else None
            if not email:
                skipped += 1
                continue

            first_name = graduate_first_name(account)

            if dry_run:
                self.stdout.write(f"[dry-run] would email {email} ({first_name})")
                sent += 1
                continue

            try:
                send_retracking_email(
                    to_email=email,
                    first_name=first_name,
                    login_url=login_url,
                    from_email=from_email,
                )
            except Exception as exc:  # pragma: no cover - log only
                self.stderr.write(f"Failed to email {email}: {exc}")
                continue

            if profile:
                profile.last_retracking_reminder_at = now
                profile.save(update_fields=["last_retracking_reminder_at"])
            sent += 1

        self.stdout.write(self.style.SUCCESS(f"Retracking reminders: sent={sent} skipped={skipped}"))
