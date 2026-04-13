import json
from datetime import date

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import AccountStatus, AlumniAccount, GraduateMasterRecord, User
from .supabase_storage import SupabaseStorageError, upload_image_bytes


def _safe_json_loads(raw_value):
    if raw_value in (None, ""):
        return {}
    if isinstance(raw_value, dict):
        return raw_value
    try:
        return json.loads(raw_value)
    except (TypeError, json.JSONDecodeError):
        return {}


def _build_profile_name(first_name: str, middle_name: str, family_name: str) -> str:
    return " ".join(part.strip() for part in [first_name, middle_name, family_name] if part and part.strip())


def _extract_year(value: str) -> int | None:
    if not value:
        return None
    digits = "".join(ch if ch.isdigit() else " " for ch in value).split()
    for chunk in digits:
        if len(chunk) == 4:
            try:
                parsed = int(chunk)
                if 1900 <= parsed <= 2200:
                    return parsed
            except ValueError:
                continue
    return None


def _normalize_employment_status(value: str) -> str:
    status_map = {
        "yes": "employed",
        "no": "unemployed",
        "never employed": "unemployed",
    }
    return status_map.get((value or "").strip().lower(), "unemployed")


def _authenticate_by_email(email: str, password: str) -> User | None:
    if not email or not password:
        return None
    user = User.objects.filter(email__iexact=email.strip()).first()
    if not user:
        return None
    if not user.is_active:
        return None
    if not user.check_password(password):
        return None
    return user


def _find_master_record(
    email: str,
    family_name: str,
    first_name: str,
) -> GraduateMasterRecord | None:
    by_email = GraduateMasterRecord.objects.filter(
        email__iexact=email,
        is_active=True,
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


def _normalize_storage_key(raw_value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in raw_value.strip())
    normalized = "-".join(part for part in cleaned.split("-") if part)
    if normalized:
        return normalized
    return f"alumni-{timezone.now().strftime('%Y%m%d%H%M%S')}"


def _session_payload_from_alumni(account: AlumniAccount) -> dict:
    template = _safe_json_loads(account.biometric_template)
    profile = template.get("profile", {}) if isinstance(template, dict) else {}

    graduation_year = profile.get("graduation_year") or (
        account.master_record.batch_year if account.master_record else date.today().year
    )
    name = profile.get("name")
    if not name and account.master_record:
        name = account.master_record.full_name
    if not name:
        name = account.user.email.split("@")[0]

    verification_status = "verified" if account.account_status == AccountStatus.ACTIVE else "pending"
    employment_status = profile.get("employment_status", "unemployed")
    student_identifier = profile.get("student_number")
    if not student_identifier and account.master_record_id:
        student_identifier = f"GMR-{str(account.master_record_id)[:8].upper()}"
    if not student_identifier:
        student_identifier = f"ALUM-{str(account.id)[:8].upper()}"

    return {
        "id": str(account.id),
        "schoolId": student_identifier,
        "studentId": student_identifier,
        "studentNumber": student_identifier,
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


def _pending_alumni_payload(account: AlumniAccount) -> dict:
    template = _safe_json_loads(account.biometric_template)
    profile = template.get("profile", {}) if isinstance(template, dict) else {}
    survey_data = profile.get("survey_data", {}) if isinstance(profile, dict) else {}
    capture_meta = template.get("capture_meta", {}) if isinstance(template, dict) else {}
    gps = capture_meta.get("gps", {}) if isinstance(capture_meta, dict) else {}
    registration_scans_raw = template.get("registration_face_scans", {}) if isinstance(template, dict) else {}
    registration_scans = registration_scans_raw if isinstance(registration_scans_raw, dict) else {}
    registration_face_scans = {
        "front": registration_scans.get("face_front") or registration_scans.get("front") or account.face_photo_url,
        "left": registration_scans.get("face_left") or registration_scans.get("left"),
        "right": registration_scans.get("face_right") or registration_scans.get("right"),
    }
    primary_face_url = account.face_photo_url or registration_face_scans.get("front")
    has_biometric_capture = bool(
        primary_face_url or registration_face_scans.get("left") or registration_face_scans.get("right")
    )

    graduation_year = profile.get("graduation_year")
    if not graduation_year and account.master_record:
        graduation_year = account.master_record.batch_year
    if not graduation_year:
        graduation_year = date.today().year

    name = profile.get("name")
    if not name and account.master_record:
        name = account.master_record.full_name
    if not name:
        name = account.user.email.split("@")[0]

    employment_status = profile.get("employment_status", "unemployed")
    job_related = survey_data.get("currentJobRelated") or survey_data.get("firstJobRelated")
    if isinstance(job_related, str):
        job_related = job_related.strip().lower()
    job_alignment = None
    if job_related == "yes":
        job_alignment = "related"
    elif job_related == "no":
        job_alignment = "not-related"

    skills = survey_data.get("skills") if isinstance(survey_data, dict) else []
    if not isinstance(skills, list):
        skills = []

    lat_raw = gps.get("lat") if isinstance(gps, dict) else None
    lng_raw = gps.get("lng") if isinstance(gps, dict) else None
    lat = None
    lng = None
    try:
        if lat_raw not in (None, ""):
            lat = float(lat_raw)
    except (TypeError, ValueError):
        lat = None
    try:
        if lng_raw not in (None, ""):
            lng = float(lng_raw)
    except (TypeError, ValueError):
        lng = None

    return {
        "id": str(account.id),
        "name": name,
        "email": account.user.email,
        "graduationYear": graduation_year,
        "verificationStatus": "pending",
        "employmentStatus": employment_status,
        "jobTitle": survey_data.get("currentJobPosition") or survey_data.get("firstJobTitle") or "",
        "company": survey_data.get("currentJobCompany") or "",
        "industry": survey_data.get("currentJobSector") or survey_data.get("firstJobSector") or "",
        "jobAlignment": job_alignment,
        "workLocation": survey_data.get("currentJobLocation") or "",
        "unemploymentReason": survey_data.get("unemploymentReason") or "",
        "dateUpdated": timezone.localdate().isoformat(),
        "biometricCaptured": has_biometric_capture,
        "biometricDate": timezone.localdate().isoformat() if has_biometric_capture else None,
        "facePhotoUrl": primary_face_url,
        "registrationFaceScans": registration_face_scans,
        "captureTime": capture_meta.get("captured_at") if isinstance(capture_meta, dict) else None,
        "skills": skills,
        "lat": lat,
        "lng": lng,
        "surveyData": survey_data,
    }


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

        user = _authenticate_by_email(email=email, password=password)
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
                "user": {
                    "id": str(user.id),
                    "email": user.email,
                    "role": "admin",
                },
            },
            status=status.HTTP_200_OK,
        )


class AlumniRegisterView(APIView):
    parser_classes = [MultiPartParser, FormParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        email = (request.data.get("email") or "").strip().lower()
        password = request.data.get("password") or ""
        confirm_password = request.data.get("confirm_password") or ""
        first_name = (request.data.get("first_name") or "").strip()
        middle_name = (request.data.get("middle_name") or "").strip()
        family_name = (request.data.get("family_name") or "").strip()
        graduation_date = (request.data.get("graduation_date") or "").strip()
        employment_status = request.data.get("employment_status") or ""

        missing = []
        for field_name, value in {
            "email": email,
            "password": password,
            "confirm_password": confirm_password,
            "first_name": first_name,
            "family_name": family_name,
        }.items():
            if not value:
                missing.append(field_name)

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

        required_files = ["face_front", "face_left", "face_right"]
        missing_files = [name for name in required_files if name not in request.FILES]
        if missing_files:
            return Response(
                {"detail": f"Missing biometric images: {', '.join(missing_files)}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        master_record = _find_master_record(
            email=email,
            family_name=family_name,
            first_name=first_name,
        )

        if master_record and family_name.lower() != master_record.last_name.lower():
            return Response(
                {"detail": "Family name does not match the graduate master record."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        storage_key_basis = email.split("@")[0]
        if master_record:
            storage_key_basis = master_record.full_name
        storage_key = _normalize_storage_key(storage_key_basis)

        face_scan_urls: dict[str, str] = {}
        timestamp = timezone.now().strftime("%Y%m%d%H%M%S%f")

        try:
            for scan_key in required_files:
                scan_file = request.FILES[scan_key]
                object_path = f"face-registration/{storage_key}/{timestamp}_{scan_key}.jpg"
                face_scan_urls[scan_key] = upload_image_bytes(
                    file_bytes=scan_file.read(),
                    object_path=object_path,
                    content_type=scan_file.content_type or "image/jpeg",
                )
        except SupabaseStorageError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        profile_name = _build_profile_name(first_name, middle_name, family_name)
        survey_data = _safe_json_loads(request.data.get("survey_data"))
        graduation_year = _extract_year(graduation_date)

        profile_data = {
            "name": profile_name,
            "graduation_year": graduation_year or (master_record.batch_year if master_record else date.today().year),
            "employment_status": _normalize_employment_status(employment_status),
            "survey_data": survey_data,
        }

        capture_meta = {
            "captured_at": request.data.get("capture_time") or timezone.now().isoformat(),
            "gps": {
                "lat": request.data.get("gps_lat"),
                "lng": request.data.get("gps_lng"),
            },
        }

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
                biometric_template=json.dumps(
                    {
                        "profile": profile_data,
                        "registration_face_scans": face_scan_urls,
                        "capture_meta": capture_meta,
                    }
                ),
                account_status=AccountStatus.PENDING,
            )

        return Response(
            {
                "message": "Graduate registration submitted. Account is pending verification.",
                "user": {
                    "id": str(user.id),
                    "email": user.email,
                    "role": user.role,
                },
                "alumni": _session_payload_from_alumni(alumni_account),
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

        user = _authenticate_by_email(email=email, password=password)
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
                {"detail": f"Account access blocked ({alumni_account.account_status}). Contact the administrator."},
                status=status.HTTP_403_FORBIDDEN,
            )

        scan_timestamp = timezone.now().strftime("%Y%m%d%H%M%S%f")
        storage_key_basis = alumni_account.master_record.full_name if alumni_account.master_record else alumni_account.user.email
        object_path = f"face-login/{_normalize_storage_key(storage_key_basis)}/{scan_timestamp}.jpg"

        try:
            login_scan_url = upload_image_bytes(
                file_bytes=face_scan.read(),
                object_path=object_path,
                content_type=face_scan.content_type or "image/jpeg",
            )
        except SupabaseStorageError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        template = _safe_json_loads(alumni_account.biometric_template)
        login_audit = template.get("login_audit", []) if isinstance(template, dict) else []
        if not isinstance(login_audit, list):
            login_audit = []

        login_audit.append(
            {
                "timestamp": timezone.now().isoformat(),
                "scan_url": login_scan_url,
            }
        )
        login_audit = login_audit[-5:]

        if not isinstance(template, dict):
            template = {}
        template["login_audit"] = login_audit
        template["last_login_scan_url"] = login_scan_url

        alumni_account.biometric_template = json.dumps(template)
        alumni_account.save(update_fields=["biometric_template"])

        return Response(
            {
                "message": "Graduate login successful.",
                "alumni": _session_payload_from_alumni(alumni_account),
                "faceScanUrl": login_scan_url,
            },
            status=status.HTTP_200_OK,
        )


class PendingAlumniListView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        pending_accounts = AlumniAccount.objects.select_related("user", "master_record").filter(
            account_status=AccountStatus.PENDING
        ).order_by("-created_at")

        return Response(
            {
                "count": pending_accounts.count(),
                "results": [_pending_alumni_payload(account) for account in pending_accounts],
            },
            status=status.HTTP_200_OK,
        )
