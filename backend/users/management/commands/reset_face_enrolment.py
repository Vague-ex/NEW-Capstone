"""
Clear enrolled face templates so graduates can capture a new one at next login.

Written for the engine switch: embeddings from different engines are not
comparable, so every stored template becomes unusable at once. Rather than
recreate accounts -- which would discard survey answers, employment records and
consent -- this clears only the biometric half. The graduate signs in with their
password, is asked to capture their face again, and everything else is untouched.

    python manage.py reset_face_enrolment                 # dry run, changes nothing
    python manage.py reset_face_enrolment --confirm       # actually clear
    python manage.py reset_face_enrolment --email a@b.c   # one account

Deliberately a removal of NAMED keys rather than a rewrite of the template.
`biometric_template` also carries `profile`, which holds survey_data and
graduation_year for every pre-table row -- replacing the blob wholesale would
silently destroy those.
"""

from __future__ import annotations

import json

from django.core.management.base import BaseCommand

from users.models import AlumniAccount

# Face-specific keys. Everything not listed here survives untouched, which is
# the safe direction: an unrecognised key is far more likely to be data worth
# keeping than a leftover of enrolment.
FACE_KEYS = (
    "face_descriptor",
    "face_descriptor_samples",
    "engines",
    "engine",
    "engine_dim",
    "registration_face_scans",
    "capture_meta",
    "sample_meta",
    "liveness_signals",
    "last_login_scan_url",
    "login_audit",
)


class Command(BaseCommand):
    help = "Clear enrolled face templates so graduates re-capture at next login."

    def add_arguments(self, parser):
        parser.add_argument(
            "--confirm",
            action="store_true",
            help="Apply the changes. Without this the command only reports.",
        )
        parser.add_argument(
            "--email",
            default="",
            help="Limit to one account, by the graduate's email address.",
        )

    def handle(self, *args, **options):
        confirm = options["confirm"]
        email = (options["email"] or "").strip().lower()

        accounts = AlumniAccount.objects.select_related("user").all()
        if email:
            accounts = accounts.filter(user__email__iexact=email)

        examined = 0
        affected = 0
        skipped = 0

        for account in accounts:
            examined += 1
            raw = account.biometric_template
            try:
                template = json.loads(raw) if isinstance(raw, str) else raw
            except (TypeError, ValueError):
                template = None
            if not isinstance(template, dict):
                template = {}

            present = [k for k in FACE_KEYS if k in template]
            has_photo = bool(account.face_photo_url)
            if not present and not has_photo:
                skipped += 1
                continue

            affected += 1
            label = account.user.email if account.user else str(account.id)
            self.stdout.write(
                f"  {label}: clearing {', '.join(present) or '(template already empty)'}"
                + ("  + face_photo_url" if has_photo else "")
            )

            if not confirm:
                continue

            for key in present:
                template.pop(key, None)
            account.biometric_template = json.dumps(template)
            account.face_photo_url = ""
            account.save(update_fields=["biometric_template", "face_photo_url"])

        self.stdout.write("")
        self.stdout.write(
            f"  examined {examined} · would clear {affected} · already clear {skipped}"
        )
        if confirm:
            self.stdout.write(self.style.SUCCESS("  Applied."))
            self.stdout.write(
                "  Those graduates can sign in with their password and will be "
                "asked to capture their face again."
            )
        else:
            self.stdout.write(
                self.style.WARNING("  Dry run — nothing changed. Re-run with --confirm.")
            )

        # FaceScan rows and the images in Supabase Storage are left alone on
        # purpose: they are the audit trail the PRD requires, and clearing an
        # enrolment is not a reason to destroy the record that it happened.
