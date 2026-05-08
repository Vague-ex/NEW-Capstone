"""Send 2-year retracking email reminders to graduates whose employment data is stale.

Run daily (e.g. via cron):
    python manage.py send_retracking_reminders
"""

from datetime import timedelta

from django.core.mail import send_mail
from django.core.management.base import BaseCommand
from django.db.models import Max
from django.utils import timezone

from tracer.models import EmploymentProfile
from users.models import AlumniAccount


REMINDER_AT_DAYS = 730  # 2 years
REMINDER_COOLDOWN_DAYS = 30


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

    def handle(self, *args, **options):
        dry_run = options.get("dry_run", False)
        now = timezone.now()
        threshold = now - timedelta(days=REMINDER_AT_DAYS)
        cooldown_threshold = now - timedelta(days=REMINDER_COOLDOWN_DAYS)

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

            name = ""
            if profile:
                name = " ".join(
                    p for p in [profile.first_name, profile.last_name] if p
                ).strip()
            name = name or email.split("@")[0]

            subject = "CHMSU Graduate Tracer — Please update your employment record"
            body = (
                f"Hi {name},\n\n"
                "Your employment record on the CHMSU Graduate Tracer System is over 2 years old.\n"
                "Please log in and re-complete the employment form so we can keep your record current.\n\n"
                "Sign in: https://chmsu-tracer.example/login\n\n"
                "Thank you,\nCHMSU Talisay BSIS Program"
            )

            if dry_run:
                self.stdout.write(f"[dry-run] would email {email} ({name})")
                sent += 1
                continue

            try:
                send_mail(
                    subject=subject,
                    message=body,
                    from_email=options.get("from_email"),
                    recipient_list=[email],
                    fail_silently=False,
                )
            except Exception as exc:  # pragma: no cover - log only
                self.stderr.write(f"Failed to email {email}: {exc}")
                continue

            if profile:
                profile.last_retracking_reminder_at = now
                profile.save(update_fields=["last_retracking_reminder_at"])
            sent += 1

        self.stdout.write(self.style.SUCCESS(f"Retracking reminders: sent={sent} skipped={skipped}"))
