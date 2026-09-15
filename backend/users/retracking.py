"""Retracking: verified graduates re-confirm their employment record every two years.

The clock runs from ``AlumniProfile.last_retraced_at``, which only registration and
a submitted employment form set. Personal & Education and Profile saves reach the
same update endpoint but must never reset it, which is why the clock no longer
reads ``EmploymentProfile.updated_at`` (every one of those saves bumps it).

Rows from before ``last_retraced_at`` existed fall back to the latest
EmploymentProfile save.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from django.conf import settings
from django.utils import timezone

from .email_send import send_branded_email
from .models import AlumniProfile

RETRACKING_THRESHOLD_DAYS = 730  # 2 years
REMINDER_COOLDOWN_DAYS = 30


def last_retraced_at(account) -> datetime | None:
    """When the graduate last confirmed their employment record, or None if never."""
    profile = getattr(account, "profile", None)
    if profile is not None and profile.last_retraced_at:
        return profile.last_retraced_at

    cached = getattr(account, "_prefetched_emp", None)
    if isinstance(cached, list):
        emp = cached[0] if cached else None
    else:
        emp = account.employment_profiles.order_by("-updated_at").first()
    return emp.updated_at if emp is not None else None


def retracking_status(account, now: datetime | None = None) -> dict:
    """Retracking fields in the camelCase shape the admin frontend reads."""
    last = last_retraced_at(account)
    if last is None:
        return {
            "requiresRetracking": False,
            "lastRetracedAt": None,
            "daysSinceRetrace": None,
            "retrackingDueAt": None,
            "retrackingOverdueDays": 0,
        }
    days = max(0, ((now or timezone.now()) - last).days)
    due = last + timedelta(days=RETRACKING_THRESHOLD_DAYS)
    return {
        "requiresRetracking": days >= RETRACKING_THRESHOLD_DAYS,
        "lastRetracedAt": timezone.localtime(last).date().isoformat(),
        "daysSinceRetrace": days,
        "retrackingDueAt": timezone.localtime(due).date().isoformat(),
        "retrackingOverdueDays": max(0, days - RETRACKING_THRESHOLD_DAYS),
    }


def needs_retracking(account) -> bool:
    return retracking_status(account)["requiresRetracking"]


def mark_retraced(account, when: datetime | None = None) -> datetime:
    """Restart the two-year clock for this graduate."""
    when = when or timezone.now()
    AlumniProfile.objects.filter(alumni=account).update(last_retraced_at=when)
    # Keep an already-loaded profile in step so a payload built later in the same
    # request does not report the old date.
    cached = account._state.fields_cache.get("profile")
    if cached is not None:
        cached.last_retraced_at = when
    return when


def graduate_first_name(account) -> str:
    profile = getattr(account, "profile", None)
    name = (getattr(profile, "first_name", "") or "").strip()
    if name:
        return name
    email = account.user.email if account.user_id else ""
    return email.split("@")[0]


def send_retracking_email(*, to_email: str, first_name: str, login_url: str | None = None, from_email=None) -> None:
    """Send the CHMSU-branded retracking reminder. Raises on transport error."""
    send_branded_email(
        to_email=to_email,
        subject="CHMSU Graduate Tracer: please update your employment record",
        template_base="retracking_reminder",
        context={
            "first_name": first_name,
            "login_url": login_url or settings.GRADUATE_LOGIN_URL,
        },
        from_email=from_email,
    )
