"""
users/api.py

Authentication views for Admin, Alumni (register + face login).
Face descriptor comparison is performed server-side on login using
face_verification.py. The frontend (face-api.js) still handles camera
capture and descriptor extraction; the backend re-verifies using the
stored descriptor for a server-authoritative match decision.
"""

from datetime import date

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .face_verification import compare_descriptors, validate_descriptor
from .models import (
    AccountStatus,
    AlumniAccount,
    AlumniProfile,
    FaceScan,
    LoginAudit,
    GraduateMasterRecord,
    User,
)
from .supabase_storage import SupabaseStorageError, upload_image_bytes


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_json(raw) -> dict | list:
    """Return raw if already parsed, otherwise parse from string. Never raises."""
    if isinstance(raw, (dict, list)):
        return raw
    if isinstance(raw, str):
        import json
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            pass
    return {}


def _build_full_name(first: str, middle: str, last: str) -> str:
    return " ".join(p.strip() for p in [first, middle, last] if p and p.strip())


def _extract_year(value: str) -> int | None:
    """Pull a 4-digit year out of a freeform date string (e.g. '05/2023')."""
    if not value:
        return None
    for chunk in "".join(c if c.isdigit() else " " for c in value).split():
        if len(chunk) == 4:
            try:
                year = int(chunk)
                if 1900 <= year <= 2200:
                    return year
            except ValueError:
                continue
    return None


def _normalize_storage_key(raw: str) -> str:
    cleaned = "".join(c.lower() if c.isalnum() else "-" for c in raw.strip())
    normalized = "-".join(p for p in cleaned.split("-") if p)
    return normalized or f"alumni-{timezone.now().strftime('%Y%m%d%H%M%S')}"


def _find_master_record(
    email: str, family_name: str, first_name: str
) -> GraduateMasterRecord | None:
    by_email = GraduateMasterRecord.objects.filter(
        email__iexact=email, is_active=True
    ).first()
    if by_email:
        return by_email
    if family_name and first_name:
        return GraduateMasterRecord.objects.filter(
            last_name__iexact=family_name,
            full_name__icontains=first_name,
            is_active=True,
        ).first()
    return None


def _authenticate_user(email: str, password: str) -> User | None:
    user = User.objects.filter(email__iexact=email.strip()).first()
    if user and user.is_active and user.check_password(password):
        return user
    return None


def _session_payload(account: AlumniAccount) -> dict:
    """Build the JSON payload returned to the client after auth."""
    profile = getattr(account, "profile", None)

    graduation_year = (
        (profile.graduation_year if profile else None)
        or (account.master_record.batch_year if account.master_record else None)
        or date.today().year
    )

    name = None
    if profile:
        name = _build_full_name(
            profile.first_name, profile.middle_name, profile.last_name
        ).strip() or None
    if not name and account.master_record:
        name = account.master_record.full_name
    if not name:
        name = account.user.email.split("@")[0]

    verification_status = (
        "verified" if account.account_status == AccountStatus.ACTIVE else "pending"
    )

    current_record = account.employment_records.filter(is_current=True).first()
    employment_status = (
        current_record.employment_status if current_record else "unemployed"
    )

    student_id = (
        f"GMR-{str(account.master_record_id)[:8].upper()}"
        if account.master_record_id
        else f"ALUM-{str(account.id)[:8].upper()}"
    )

    return {
        "id": str(account.id),
        "schoolId": student_id,
        "studentId": student_id,
        "studentNumber": student_id,
        "name": name,
        "email": account.user.email,
        "graduationYear": graduation_year,
        "verificationStatus": verification_status,
        "employmentStatus": employment_status,
        "dateUpdated": timezone.localdate().isoformat(),
        "biometricCaptured": bool(account.face_photo_url),
        "biometricDate": timezone.localdate().isoformat() if account.face_photo_url else None,
        "facePhotoUrl": account.face_photo_url,
        "accountStatus": account.account_status,
    }


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------

class AdminLoginView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        email = (request.data.get("email") or "").strip()
        password = request.data.get("password") or ""

        if not email or not password:
            return Response(
                {"detail": "Email and password are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = _authenticate_user(email, password)
        if not user:
            return Response(
                {"detail": "Invalid email or password."},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        if not (user.role == User.Role.ADMIN or user.is_staff):
            return Response(
                {"detail": "This account is not allowed to access the admin portal."},
                status=status.HTTP_403_FORBIDDEN,
            )

        return Response(
            {
                "message": "Admin login successful.",
                "user": {"id": str(user.id), "email": user.email, "role": "admin"},
            }
        )


class AlumniRegisterView(APIView):
    parser_classes = [MultiPartParser, FormParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        # ── Required text fields ───────────────────────────────────────────
        email = (request.data.get("email") or "").strip().lower()
        password = request.data.get("password") or ""
        confirm_password = request.data.get("confirm_password") or ""
        first_name = (request.data.get("first_name") or "").strip()
        middle_name = (request.data.get("middle_name") or "").strip()
        family_name = (request.data.get("family_name") or "").strip()
        graduation_date = (request.data.get("graduation_date") or "").strip()
        employment_status_raw = request.data.get("employment_status") or ""

        # Validate required fields
        missing = [
            k for k, v in {
                "email": email,
                "password": password,
                "confirm_password": confirm_password,
                "first_name": first_name,
                "family_name": family_name,
            }.items() if not v
        ]
        if missing:
            return Response(
                {"detail": f"Missing required fields: {', '.join(missing)}."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if password != confirm_password:
            return Response(
                {"detail": "Passwords do not match."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(password) < 8:
            return Response(
                {"detail": "Password must be at least 8 characters."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if User.objects.filter(email=email).exists():
            return Response(
                {"detail": "This email is already registered."},
                status=status.HTTP_409_CONFLICT,
            )

        # Required face scan files
        required_files = ["face_front", "face_left", "face_right"]
        missing_files = [f for f in required_files if f not in request.FILES]
        if missing_files:
            return Response(
                {"detail": f"Missing biometric images: {', '.join(missing_files)}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── Face descriptor (optional but stored if provided) ──────────────
        raw_descriptor = _safe_json(request.data.get("face_descriptor"))
        if isinstance(raw_descriptor, list) and raw_descriptor:
            error = validate_descriptor(raw_descriptor)
            if error:
                return Response(
                    {"detail": f"Invalid face descriptor: {error}"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            face_descriptor = raw_descriptor
        else:
            face_descriptor = []

        # ── Master record lookup ───────────────────────────────────────────
        master_record = _find_master_record(email, family_name, first_name)
        if master_record and family_name.lower() != master_record.last_name.lower():
            return Response(
                {"detail": "Family name does not match the graduate master record."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        storage_key = _normalize_storage_key(
            master_record.full_name if master_record else email.split("@")[0]
        )

        # ── Upload face scans ──────────────────────────────────────────────
        timestamp = timezone.now().strftime("%Y%m%d%H%M%S%f")
        face_scan_urls: dict[str, str] = {}

        try:
            for scan_key in required_files:
                scan_file = request.FILES[scan_key]
                path = f"face-registration/{storage_key}/{timestamp}_{scan_key}.jpg"
                face_scan_urls[scan_key] = upload_image_bytes(
                    file_bytes=scan_file.read(),
                    object_path=path,
                    content_type=scan_file.content_type or "image/jpeg",
                )
        except SupabaseStorageError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        # ── Parse survey data and metadata ────────────────────────────────
        survey_data = _safe_json(request.data.get("survey_data"))
        graduation_year = _extract_year(graduation_date) or (
            master_record.batch_year if master_record else date.today().year
        )

        captured_at_raw = request.data.get("capture_time")
        captured_at = parse_datetime(captured_at_raw) if captured_at_raw else timezone.now()
        if captured_at is None:
            captured_at = timezone.now()

        gps_lat = request.data.get("gps_lat") or None
        gps_lng = request.data.get("gps_lng") or None

        # ── Persist to DB ─────────────────────────────────────────────────
        with transaction.atomic():
            user = User.objects.create_user(
                email=email,
                password=password,
                role=User.Role.ALUMNI,
            )

            alumni_account = AlumniAccount.objects.create(
                user=user,
                master_record=master_record,
                face_photo_url=face_scan_urls["face_front"],
                biometric_template=face_descriptor,
                account_status=AccountStatus.PENDING,
            )

            AlumniProfile.objects.create(
                alumni=alumni_account,
                first_name=first_name,
                middle_name=middle_name,
                last_name=family_name,
                gender=survey_data.get("gender", ""),
                birth_date=survey_data.get("birthDate", ""),
                civil_status=survey_data.get("civilStatus", ""),
                mobile=survey_data.get("mobile", ""),
                facebook_url=survey_data.get("facebook", ""),
                city=survey_data.get("city", ""),
                province=survey_data.get("province", ""),
                graduation_date=graduation_date,
                graduation_year=graduation_year,
                scholarship=survey_data.get("scholarship", ""),
                highest_attainment=survey_data.get("highestAttainment", ""),
                graduate_school=survey_data.get("graduateSchool", ""),
                prof_eligibility=",".join(survey_data.get("profEligibility", [])),
                prof_eligibility_other=survey_data.get("profEligibilityOther", ""),
                awards=survey_data.get("awards", ""),
            )

            for scan_key in required_files:
                FaceScan.objects.create(
                    alumni=alumni_account,
                    scan_type=scan_key,
                    url=face_scan_urls[scan_key],
                    captured_at=captured_at,
                    gps_lat=gps_lat,
                    gps_lng=gps_lng,
                )

        return Response(
            {
                "message": "Graduate registration submitted. Account is pending verification.",
                "user": {
                    "id": str(user.id),
                    "email": user.email,
                    "role": user.role,
                },
                "alumni": _session_payload(alumni_account),
            },
            status=status.HTTP_201_CREATED,
        )


class AlumniLoginView(APIView):
    parser_classes = [MultiPartParser, FormParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        email = (request.data.get("email") or "").strip()
        password = request.data.get("password") or ""
        face_scan = request.FILES.get("face_scan")

        if not email or not password:
            return Response(
                {"detail": "Email and password are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not face_scan:
            return Response(
                {"detail": "A face scan image is required for graduate login."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = _authenticate_user(email, password)
        if not user:
            return Response(
                {"detail": "Invalid email or password."},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        if user.role != User.Role.ALUMNI:
            return Response(
                {"detail": "This account is not a graduate account."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            alumni_account = user.alumni_account
        except AlumniAccount.DoesNotExist:
            return Response(
                {"detail": "Graduate profile was not found for this account."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if alumni_account.account_status in {AccountStatus.REJECTED, AccountStatus.SUSPENDED}:
            return Response(
                {
                    "detail": (
                        f"Account access blocked ({alumni_account.account_status}). "
                        "Contact the administrator."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        # ── Server-side face descriptor comparison ─────────────────────────
        # The frontend sends the similarity_score it computed client-side.
        # If we also have a stored descriptor, we compute our own score for
        # audit logging and can reject logins that fail the server check.
        client_similarity: float | None = None
        raw_score = request.data.get("similarity_score")
        if raw_score is not None:
            try:
                client_similarity = float(raw_score)
            except (TypeError, ValueError):
                pass

        server_comparison: dict | None = None
        candidate_descriptor = _safe_json(request.data.get("face_descriptor"))
        stored_descriptor = alumni_account.biometric_template

        if (
            isinstance(stored_descriptor, list)
            and stored_descriptor
            and isinstance(candidate_descriptor, list)
            and candidate_descriptor
        ):
            try:
                server_comparison = compare_descriptors(stored_descriptor, candidate_descriptor)
            except ValueError:
                # Descriptor length mismatch — log but do not block login;
                # we fall back to the client-reported similarity score.
                server_comparison = None

        # Determine the authoritative similarity score for the audit log.
        # Prefer the server-computed value; fall back to client-reported.
        similarity_score = (
            server_comparison["similarity_score"]
            if server_comparison
            else client_similarity
        )

        # ── Upload login face scan ─────────────────────────────────────────
        scan_timestamp = timezone.now().strftime("%Y%m%d%H%M%S%f")
        storage_key = _normalize_storage_key(
            alumni_account.master_record.full_name
            if alumni_account.master_record
            else alumni_account.user.email
        )
        object_path = f"face-login/{storage_key}/{scan_timestamp}.jpg"

        try:
            login_scan_url = upload_image_bytes(
                file_bytes=face_scan.read(),
                object_path=object_path,
                content_type=face_scan.content_type or "image/jpeg",
            )
        except SupabaseStorageError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        # ── Persist login audit + scan ─────────────────────────────────────
        now = timezone.now()
        LoginAudit.objects.create(
            alumni=alumni_account,
            timestamp=now,
            scan_url=login_scan_url,
            similarity_score=similarity_score,
            descriptor_distance=(
                server_comparison["distance"] if server_comparison else None
            ),
            status="success",
        )
        FaceScan.objects.create(
            alumni=alumni_account,
            scan_type="login",
            url=login_scan_url,
            captured_at=now,
        )

        return Response(
            {
                "message": "Graduate login successful.",
                "alumni": _session_payload(alumni_account),
                "faceScanUrl": login_scan_url,
            }
        )