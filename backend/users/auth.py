"""
Signed bearer-token authentication for admin and graduate endpoints.

Lives in its own module (rather than users/api.py) so that tracer/api.py and
tracer/reports_api.py can import the guards without creating an import cycle:
users.api already imports tracer.models, so tracer importing users.api back
would be fragile. This module depends only on users.models and DRF.

The scheme mirrors the pre-existing employer token in tracer/api.py:
django.core.signing with a per-role salt and a TTL. Tokens are stateless, so
every guard re-checks the account against the database — deactivating an admin
or suspending a graduate revokes access immediately rather than whenever the
token happens to expire.
"""

from django.core import signing
from django.core.signing import BadSignature, SignatureExpired
from django.db import DatabaseError, OperationalError
from rest_framework import status
from rest_framework.response import Response

from .models import AccountStatus, AdminCredential, AlumniAccount, User

# Distinct salts mean a token minted for one role can never be replayed against
# another, even though all roles share Django's SECRET_KEY.
ADMIN_TOKEN_SALT = "users.admin.access"
ADMIN_TOKEN_TTL_SECONDS = 60 * 60 * 8  # 8 hours
ALUMNI_TOKEN_SALT = "users.alumni.access"
ALUMNI_TOKEN_TTL_SECONDS = 60 * 60 * 12  # 12 hours


def generate_admin_access_token(user_id) -> str:
    return signing.dumps({"uid": str(user_id)}, salt=ADMIN_TOKEN_SALT, compress=True)


def generate_alumni_access_token(user_id) -> str:
    return signing.dumps({"uid": str(user_id)}, salt=ALUMNI_TOKEN_SALT, compress=True)


def _unauthorized(detail: str) -> Response:
    return Response({"detail": detail}, status=status.HTTP_401_UNAUTHORIZED)


def _db_unavailable() -> Response:
    return Response(
        {"detail": "Service temporarily unavailable. Please try again."},
        status=status.HTTP_503_SERVICE_UNAVAILABLE,
    )


def decode_access_token(request, *, salt: str, max_age: int, label: str):
    """Decode a bearer token. Returns (user_id, error_response)."""
    header = request.headers.get("Authorization") or ""
    if not header.lower().startswith("bearer "):
        return None, _unauthorized("Authentication credentials were not provided.")
    token = header[7:].strip()
    if not token:
        return None, _unauthorized("Authentication credentials were not provided.")

    try:
        payload = signing.loads(token, salt=salt, max_age=max_age)
    except SignatureExpired:
        return None, _unauthorized(f"{label} access token has expired.")
    except BadSignature:
        return None, _unauthorized(f"Invalid {label.lower()} access token.")

    user_id = payload.get("uid") if isinstance(payload, dict) else None
    if not user_id:
        return None, _unauthorized(f"Invalid {label.lower()} access token.")
    return user_id, None


def require_admin(request):
    """
    Gate for administrator-only endpoints. Returns (user, error_response);
    callers must return the error response when it is not None.
    """
    user_id, error = decode_access_token(
        request, salt=ADMIN_TOKEN_SALT, max_age=ADMIN_TOKEN_TTL_SECONDS, label="Admin",
    )
    if error:
        return None, error

    try:
        user = User.objects.filter(id=user_id, is_active=True).first()
        # Mirror AdminLoginView's own rule exactly (role == ADMIN or is_staff).
        # Requiring an AdminCredential row here instead would lock out Django
        # superusers, who can log in but have no credential row — they would
        # authenticate successfully and then be refused by every endpoint.
        is_admin = bool(user) and (user.role == User.Role.ADMIN or user.is_staff)
        # When a credential row does exist it governs access, so deactivating it
        # revokes a still-valid token immediately rather than at expiry.
        revoked = (
            AdminCredential.objects.filter(user_id=user_id, is_active=False).exists()
            and not AdminCredential.objects.filter(user_id=user_id, is_active=True).exists()
            if user
            else False
        )
    except (OperationalError, DatabaseError):
        return None, _db_unavailable()

    if not is_admin or revoked:
        return None, _unauthorized("Administrator account is not active.")
    return user, None


def require_alumni(request, *, alumni_id=None):
    """
    Gate for graduate-owned endpoints. When alumni_id is supplied the token
    holder must own that record — otherwise any signed-in graduate could edit
    another graduate's data just by changing the URL.
    """
    user_id, error = decode_access_token(
        request, salt=ALUMNI_TOKEN_SALT, max_age=ALUMNI_TOKEN_TTL_SECONDS, label="Graduate",
    )
    if error:
        return None, error

    try:
        account = (
            AlumniAccount.objects.select_related("user")
            .filter(user_id=user_id, user__role=User.Role.ALUMNI, user__is_active=True)
            .first()
        )
    except (OperationalError, DatabaseError):
        return None, _db_unavailable()

    if not account:
        return None, _unauthorized("Graduate account was not found.")
    if account.account_status in {AccountStatus.REJECTED, AccountStatus.SUSPENDED}:
        return None, Response(
            {"detail": "This graduate account is not active."},
            status=status.HTTP_403_FORBIDDEN,
        )
    if alumni_id is not None and str(account.id) != str(alumni_id):
        # 403 rather than 404: the caller is authenticated, just not authorised.
        return None, Response(
            {"detail": "You do not have permission to modify this record."},
            status=status.HTTP_403_FORBIDDEN,
        )
    return account, None
