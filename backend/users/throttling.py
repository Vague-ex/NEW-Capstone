"""
Failed-login cooldown helpers.

The policy is a stepped backoff. Every time a user crosses the
LOGIN_THROTTLE_FAIL_LIMIT threshold of failed attempts, the system
starts a cooldown drawn from LOGIN_THROTTLE_BACKOFF_SECONDS. Subsequent
failures past the threshold escalate to the next tier in the list.

Identifier convention: f"{role}:{email_lower}".
- role is "graduate", "employer", or "admin"
- email_lower is the credential email, stripped and lower-cased

A row in users_login_attempt_throttle is upserted per identifier.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Tuple

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import LoginAttemptThrottle


def _backoff_seconds(tier: int) -> int:
    table = settings.LOGIN_THROTTLE_BACKOFF_SECONDS or [15]
    if tier <= 0:
        return 0
    idx = min(tier, len(table)) - 1
    return int(table[idx])


def is_locked_out(identifier: str) -> Tuple[bool, int]:
    """Return (is_locked, seconds_remaining)."""
    try:
        row = LoginAttemptThrottle.objects.get(identifier=identifier)
    except LoginAttemptThrottle.DoesNotExist:
        return (False, 0)

    if row.lockout_until is None:
        return (False, 0)

    now = timezone.now()
    if now >= row.lockout_until:
        return (False, 0)

    remaining = int((row.lockout_until - now).total_seconds())
    return (True, max(remaining, 1))


def register_failed_attempt(identifier: str, role: str) -> Tuple[bool, int]:
    """
    Record one failed attempt. If the failure pushes the user across the
    threshold, escalate the lockout tier and set lockout_until.

    Returns (now_locked, lockout_seconds).
    """
    fail_limit = int(settings.LOGIN_THROTTLE_FAIL_LIMIT)
    now = timezone.now()

    with transaction.atomic():
        row, _ = LoginAttemptThrottle.objects.select_for_update().get_or_create(
            identifier=identifier,
            defaults={"role": role},
        )
        if row.role != role:
            row.role = role

        row.failed_count = (row.failed_count or 0) + 1
        row.last_failed_at = now

        crossed_threshold = (
            row.failed_count >= fail_limit
            and (row.failed_count - fail_limit) % fail_limit == 0
        )
        if crossed_threshold:
            row.lockout_tier = (row.lockout_tier or 0) + 1
            secs = _backoff_seconds(row.lockout_tier)
            row.lockout_until = now + timedelta(seconds=secs)
            row.save()
            return (True, secs)

        row.save()

    locked, remaining = is_locked_out(identifier)
    return (locked, remaining)


def reset_attempts(identifier: str) -> None:
    """Clear the throttle row after a successful login or successful reset."""
    LoginAttemptThrottle.objects.filter(identifier=identifier).update(
        failed_count=0,
        last_failed_at=None,
        lockout_until=None,
        lockout_tier=0,
    )


def make_identifier(role: str, email: str) -> str:
    return f"{role.strip().lower()}:{(email or '').strip().lower()}"
