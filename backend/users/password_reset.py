"""
Password reset helpers: code generation, hashing, email send, and the
three API endpoints (request, verify, resend) used by the frontend
"Forgot password" flow.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import timedelta
from email.mime.image import MIMEImage
from pathlib import Path
from typing import Optional, Tuple

from django.conf import settings
from django.core import signing
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils import timezone
from django.utils.crypto import constant_time_compare
from rest_framework import status
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

RESET_TICKET_SALT = "graduate-tracer.forgot-password"
RESET_TICKET_MAX_AGE = 5 * 60  # 5 minutes between check-code and set-password

from .models import (
    AccountStatus, AlumniAccount, EmployerAccount, PasswordResetCode, User,
)
from .throttling import (
    is_locked_out, make_identifier, register_failed_attempt, reset_attempts,
)


LOGGER = logging.getLogger(__name__)

ROLE_GRADUATE = PasswordResetCode.ROLE_GRADUATE
ROLE_EMPLOYER = PasswordResetCode.ROLE_EMPLOYER
ALLOWED_ROLES = {ROLE_GRADUATE, ROLE_EMPLOYER}

LOGO_PATH = Path(__file__).resolve().parent / "email_templates" / "chmsu-logo.png"


# ---------- code generation / hashing ----------

def _generate_numeric_code(length: int) -> str:
    digits = "0123456789"
    return "".join(secrets.choice(digits) for _ in range(length))


def _format_code(code: str) -> str:
    """Group a 12-digit code as XXX-XXX-XXX-XXX. Falls back to plain for other lengths."""
    if len(code) == 12:
        return f"{code[0:3]}-{code[3:6]}-{code[6:9]}-{code[9:12]}"
    return code


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


# ---------- account lookup ----------

def _find_user_for_reset(email: str, role: str) -> Optional[User]:
    """Locate a User row for the (email, role) pair. None if not found."""
    email = (email or "").strip().lower()
    if not email or role not in ALLOWED_ROLES:
        return None

    if role == ROLE_GRADUATE:
        qs = User.objects.filter(email__iexact=email, role=User.Role.ALUMNI)
        user = qs.first()
        if not user:
            return None
        try:
            acct = user.alumni_account
        except AlumniAccount.DoesNotExist:
            return None
        if acct.account_status in {AccountStatus.REJECTED, AccountStatus.SUSPENDED}:
            return None
        return user

    # Employer
    employer = (
        EmployerAccount.objects
        .select_related("user")
        .filter(company_email__iexact=email)
        .first()
    )
    if not employer or not employer.user:
        return None
    if employer.account_status in {AccountStatus.REJECTED, AccountStatus.SUSPENDED}:
        return None
    return employer.user


def _get_first_name(user: User, role: str) -> str:
    if role == ROLE_GRADUATE:
        try:
            profile = user.alumni_account.profile
            return (profile.first_name or "").strip() or "there"
        except Exception:
            return "there"
    if role == ROLE_EMPLOYER:
        try:
            return (user.employer_account.contact_name or "").split(" ")[0] or "there"
        except Exception:
            return "there"
    return "there"


# ---------- email send ----------

def _send_reset_email(*, to_email: str, role: str, first_name: str, code: str) -> None:
    """
    Send the styled password reset email with the CHMSU logo inlined by
    Content-ID. Raises on transport error so the caller can decide how
    to react.
    """
    ttl_minutes = int(round(settings.PASSWORD_RESET_CODE_TTL_SECONDS / 60))
    code_pretty = _format_code(code)
    logo_cid = "chmsu-logo"
    role_display = "graduate" if role == ROLE_GRADUATE else "employer"

    context = {
        "first_name": first_name,
        "code_pretty": code_pretty,
        "ttl_minutes": ttl_minutes,
        "role_display": role_display,
        "logo_cid": logo_cid,
    }
    html_body = render_to_string("password_reset.html", context)
    text_body = render_to_string("password_reset.txt", context)

    subject = "Your CHMSU Graduate Tracer password reset code"
    msg = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[to_email],
    )
    msg.attach_alternative(html_body, "text/html")
    msg.mixed_subtype = "related"

    # Inline the CHMSU logo if the asset exists.
    if LOGO_PATH.is_file():
        with LOGO_PATH.open("rb") as f:
            image = MIMEImage(f.read(), _subtype="png")
        image.add_header("Content-ID", f"<{logo_cid}>")
        image.add_header("Content-Disposition", "inline", filename="chmsu-logo.png")
        msg.attach(image)
    else:
        LOGGER.warning("CHMSU logo not found at %s; email will render without it.", LOGO_PATH)

    msg.send(fail_silently=False)


# ---------- core flow used by request + resend ----------

def _issue_code_and_send(
    *,
    user: User,
    email_normalized: str,
    role: str,
    request_ip: Optional[str],
) -> Tuple[Optional[PasswordResetCode], Optional[str]]:
    """
    Generate, persist, and email a fresh reset code. Returns (row, error)
    where error is None on success.
    """
    now = timezone.now()
    cooldown = int(settings.PASSWORD_RESET_RESEND_COOLDOWN_SECONDS)
    ttl = int(settings.PASSWORD_RESET_CODE_TTL_SECONDS)
    code_length = int(settings.PASSWORD_RESET_CODE_LENGTH)

    last_sent = (
        PasswordResetCode.objects
        .filter(email__iexact=email_normalized, role=role)
        .order_by("-sent_at")
        .first()
    )
    if last_sent:
        elapsed = (now - last_sent.sent_at).total_seconds()
        if elapsed < cooldown:
            return None, f"Please wait {int(cooldown - elapsed)}s before requesting another code."

    # Invalidate any unused codes for this (email, role).
    PasswordResetCode.objects.filter(
        email__iexact=email_normalized, role=role, used_at__isnull=True,
    ).update(used_at=now)

    code = _generate_numeric_code(code_length)
    row = PasswordResetCode.objects.create(
        email=email_normalized,
        role=role,
        code_hash=_hash_code(code),
        expires_at=now + timedelta(seconds=ttl),
        request_ip=request_ip,
    )

    try:
        _send_reset_email(
            to_email=user.email,
            role=role,
            first_name=_get_first_name(user, role),
            code=code,
        )
    except Exception as exc:
        LOGGER.exception("Failed to send password reset email: %s", exc)
        # Mark the row used so the user can request a fresh attempt
        # immediately (we do not want them blocked by the cooldown when
        # the send failed for our side).
        row.used_at = timezone.now()
        row.save(update_fields=["used_at"])
        return None, "Could not send the email. Please try again in a moment."

    return row, None


def _client_ip(request) -> Optional[str]:
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


# ---------- generic success payload (anti-enumeration) ----------

def _generic_success(now=None) -> dict:
    """
    Always returned for the request endpoint regardless of whether the
    account exists. This prevents account enumeration.
    """
    now = now or timezone.now()
    cooldown = int(settings.PASSWORD_RESET_RESEND_COOLDOWN_SECONDS)
    ttl = int(settings.PASSWORD_RESET_CODE_TTL_SECONDS)
    return {
        "message": "If that email is registered, a reset code is on its way.",
        "resend_available_in_seconds": cooldown,
        "code_expires_in_seconds": ttl,
    }


# ---------- API views ----------

class ForgotPasswordRequestView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        email = (request.data.get("email") or "").strip().lower()
        role = (request.data.get("role") or "").strip().lower()

        if role not in ALLOWED_ROLES:
            return Response(
                {"detail": "role must be 'graduate' or 'employer'."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not email or "@" not in email:
            return Response(
                {"detail": "A valid email is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = _find_user_for_reset(email, role)
        # Anti-enumeration: respond with the same shape whether or not
        # the email is registered. Only send the email if a user exists.
        if user:
            _row, err = _issue_code_and_send(
                user=user,
                email_normalized=email,
                role=role,
                request_ip=_client_ip(request),
            )
            if err:
                # Internal error sending email. We do not leak details.
                LOGGER.warning("Issue/send returned soft error: %s", err)

        return Response(_generic_success(), status=status.HTTP_200_OK)


class ForgotPasswordResendView(APIView):
    """Same shape as Request but always sends a fresh code (still cooldown gated)."""
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        return ForgotPasswordRequestView().post(request)


def _validate_code_or_response(*, email: str, role: str, code_in: str):
    """
    Shared code-validation logic. Returns (row, error_response).
    On match: (row, None). On any failure: (None, Response).

    Throttle counter is incremented on mismatch; on match the row's
    attempt_count is also bumped so we keep tight bounds on guessing.
    """
    code_clean = "".join(ch for ch in code_in if ch.isdigit())

    identifier = make_identifier(role, email)
    locked, secs_left = is_locked_out(identifier)
    if locked:
        return None, Response(
            {"detail": "Too many failed attempts. Try again later.",
             "lockout_seconds": secs_left},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    row = (
        PasswordResetCode.objects
        .filter(email__iexact=email, role=role, used_at__isnull=True)
        .order_by("-sent_at")
        .first()
    )
    if not row or row.is_expired:
        register_failed_attempt(identifier, role)
        return None, Response(
            {"detail": "Code is invalid or expired. Request a new one."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    max_attempts = int(settings.PASSWORD_RESET_MAX_ATTEMPTS)
    row.attempt_count = (row.attempt_count or 0) + 1
    if row.attempt_count > max_attempts:
        row.used_at = timezone.now()
        row.save(update_fields=["attempt_count", "used_at"])
        register_failed_attempt(identifier, role)
        return None, Response(
            {"detail": "Too many wrong attempts on this code. Request a new one."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    row.save(update_fields=["attempt_count"])

    if not constant_time_compare(_hash_code(code_clean), row.code_hash):
        now_locked, lockout_secs = register_failed_attempt(identifier, role)
        payload = {
            "detail": "The code does not match. Please double-check and try again.",
            "remaining_attempts": max(0, max_attempts - row.attempt_count),
        }
        if now_locked:
            payload["lockout_seconds"] = lockout_secs
            return None, Response(payload, status=status.HTTP_429_TOO_MANY_REQUESTS)
        return None, Response(payload, status=status.HTTP_400_BAD_REQUEST)

    return row, None


class ForgotPasswordCheckCodeView(APIView):
    """
    Step 2 of the flow. Validates the code and returns a short-lived
    signed `reset_ticket` that the frontend uses to actually set the
    new password. The code row stays unused so this view can be retried
    if the next step fails for any reason, but the row's `attempt_count`
    and the login throttle counters are both incremented per call so
    brute force is still bounded.
    """
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        email = (request.data.get("email") or "").strip().lower()
        role = (request.data.get("role") or "").strip().lower()
        code_in = (request.data.get("code") or "").strip()

        if role not in ALLOWED_ROLES:
            return Response(
                {"detail": "role must be 'graduate' or 'employer'."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not email or not code_in:
            return Response(
                {"detail": "email and code are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        row, err = _validate_code_or_response(email=email, role=role, code_in=code_in)
        if err:
            return err

        # Code is good. Issue a signed ticket that the next step consumes.
        ticket = signing.dumps(
            {
                "row_id": str(row.id),
                "email": email,
                "role": role,
                "code_hash": row.code_hash,
            },
            salt=RESET_TICKET_SALT,
        )
        return Response(
            {
                "message": "Code accepted. You can now set a new password.",
                "reset_ticket": ticket,
                "ticket_expires_in_seconds": RESET_TICKET_MAX_AGE,
            },
            status=status.HTTP_200_OK,
        )


class ForgotPasswordSetPasswordView(APIView):
    """
    Step 3 of the flow. Consumes the `reset_ticket` issued by check-code
    and sets the new password. The corresponding code row is marked used
    so the same code cannot be replayed.
    """
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        ticket = (request.data.get("reset_ticket") or "").strip()
        new_password = request.data.get("new_password") or ""

        if not ticket or not new_password:
            return Response(
                {"detail": "reset_ticket and new_password are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(new_password) < 8:
            return Response(
                {"detail": "Password must be at least 8 characters."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            payload = signing.loads(ticket, salt=RESET_TICKET_SALT, max_age=RESET_TICKET_MAX_AGE)
        except signing.SignatureExpired:
            return Response(
                {"detail": "This reset ticket has expired. Please verify the code again."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except signing.BadSignature:
            return Response(
                {"detail": "Invalid reset ticket."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        email = (payload.get("email") or "").strip().lower()
        role = (payload.get("role") or "").strip().lower()
        row_id = payload.get("row_id")
        code_hash = payload.get("code_hash")
        if role not in ALLOWED_ROLES or not email or not row_id:
            return Response(
                {"detail": "Invalid reset ticket."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        row = PasswordResetCode.objects.filter(id=row_id, email__iexact=email, role=role).first()
        if not row or row.used_at is not None or row.is_expired or row.code_hash != code_hash:
            return Response(
                {"detail": "Code is no longer valid. Please request a new one."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = _find_user_for_reset(email, role)
        if not user:
            return Response(
                {"detail": "Account no longer exists."},
                status=status.HTTP_404_NOT_FOUND,
            )
        user.set_password(new_password)
        user.save(update_fields=["password"])

        row.used_at = timezone.now()
        row.save(update_fields=["used_at"])

        reset_attempts(make_identifier(role, email))

        return Response(
            {"message": "Password updated. You can now log in."},
            status=status.HTTP_200_OK,
        )


# Back-compat alias so any cached frontend bundle that still calls
# /verify/ continues to work for one release. New code uses the two
# split views above.
class ForgotPasswordVerifyView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        email = (request.data.get("email") or "").strip().lower()
        role = (request.data.get("role") or "").strip().lower()
        code_in = (request.data.get("code") or "").strip()
        new_password = request.data.get("new_password") or ""

        if role not in ALLOWED_ROLES:
            return Response(
                {"detail": "role must be 'graduate' or 'employer'."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not email or not code_in or not new_password:
            return Response(
                {"detail": "email, code, and new_password are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(new_password) < 8:
            return Response(
                {"detail": "Password must be at least 8 characters."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        row, err = _validate_code_or_response(email=email, role=role, code_in=code_in)
        if err:
            return err

        user = _find_user_for_reset(email, role)
        if not user:
            return Response(
                {"detail": "Account no longer exists."},
                status=status.HTTP_404_NOT_FOUND,
            )
        user.set_password(new_password)
        user.save(update_fields=["password"])
        row.used_at = timezone.now()
        row.save(update_fields=["used_at"])
        reset_attempts(make_identifier(role, email))

        return Response(
            {"message": "Password updated. You can now log in."},
            status=status.HTTP_200_OK,
        )
