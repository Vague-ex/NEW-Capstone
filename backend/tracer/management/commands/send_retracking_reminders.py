"""Send 2-year retracking email reminders to graduates whose employment data is stale.

Run daily (e.g. via cron):
    python manage.py send_retracking_reminders
"""

import logging
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db.models import Max
from django.utils import timezone

from tracer.models import EmploymentProfile
from users.email_send import send_branded_email
from users.models import AlumniAccount


LOGGER = logging.getLogger(__name__)

REMINDER_AT_DAYS = 730  # 2 years
REMINDER_COOLDOWN_DAYS = 30


def _send_retracking_email(*, to_email: str, first_name: str, login_url: str, from_email=None) -> None:
    """Send the CHMSU-branded retracking reminder via the shared helper."""
    send_branded_email(
        to_email=to_email,
        subject="CHMSU Graduate Tracer: please update your employment record",
        template_base="retracking_reminder",
        context={
            "first_name": first_name,
            "login_url": login_url,
        },
        from_email=from_email,
    )


class Command(BaseCommand):
    help = "Email graduates whose employment profile is older than 2 years to prompt retracking."

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
        threshold = now - timedelta(days=REMINDER_AT_DAYS)
        cooldown_threshold = now - timedelta(days=REMINDER_COOLDOWN_DAYS)
        from_email = options.get("from_email")
        login_url = options.get("login_url") or getattr(
            settings, "GRADUATE_LOGIN_URL", "https://chmsu-tracer.example/login",
        )

        # Find graduates whose latest employment profile updated_at is older than threshold.
        stale = (
            EmploymentProfile.objects.values("alumni")
            .annotate(latest=Max("updated_at"))
            .filter(latest__lte=threshold)
            .values_list("alumni", flat=True)
        )

        accounts = (
            AlumniAccount.objects.select_related("user", "profile")
            .filter(id__in=list(stale))
        )

        sent = 0
        skipped = 0
        for account in accounts:
            profile = getattr(account, "profile", None)
            if profile and profile.last_retracking_reminder_at and profile.last_retracking_reminder_at >= cooldown_threshold:
                skipped += 1
                continue

            email = account.user.email if account.user else None
            if not email:
                skipped += 1
                continue

            first_name = ""
            if profile and profile.first_name:
                first_name = profile.first_name.strip()
            first_name = first_name or email.split("@")[0]

            if dry_run:
                self.stdout.write(f"[dry-run] would email {email} ({first_name})")
                sent += 1
                continue

            try:
                _send_retracking_email(
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
