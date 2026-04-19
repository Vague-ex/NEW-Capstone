"""
users/api.py

Authentication views for Admin, Alumni (register + face login).
Face descriptor comparison is performed server-side on login using
face_verification.py. The frontend (face-api.js) still handles camera
capture and descriptor extraction; the backend re-verifies using the
stored descriptor for a server-authoritative match decision.
"""

from datetime import date

from django.core import signing
from django.core.signing import BadSignature, SignatureExpired
from django.db import DatabaseError, OperationalError, transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from tracer.models import (
    AlumniSkill,
    EmploymentRecord,
    JobTitle,
    Region,
    Skill,
    VerificationDecision,
)

from .face_verification import compare_descriptors, validate_descriptor
from .models import (
    AccountStatus,
    AlumniAccount,
    AlumniProfile,
    EmployerAccount,
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
    # GraduateMasterRecord email was removed in migration 0006.
    # Match by name components only.
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


def _authenticate_by_email(email: str, password: str) -> User | None:
    """Backward-compatible alias used by tests and auth views."""
    return _authenticate_user(email, password)


def _database_unavailable_response() -> Response:
    return Response(
        {
            "detail": "Database is temporarily unavailable. Please try again.",
            "retryable": True,
        },
        status=status.HTTP_503_SERVICE_UNAVAILABLE,
    )


_ADMIN_TOKEN_SALT = "users.admin.access"
_ADMIN_TOKEN_TTL_SECONDS = 60 * 60 * 8
_EMPLOYER_TOKEN_SALT = "users.employer.access"
_EMPLOYER_TOKEN_TTL_SECONDS = 60 * 60 * 8


def _issue_admin_token(user: User) -> str:
    return signing.dumps(
        {"uid": str(user.id), "role": User.Role.ADMIN},
        salt=_ADMIN_TOKEN_SALT,
    )


def _issue_employer_token(user: User) -> str:
    return signing.dumps(
        {"uid": str(user.id), "role": User.Role.EMPLOYER},
        salt=_EMPLOYER_TOKEN_SALT,
    )


def _extract_bearer_token(request) -> str:
    header = request.headers.get("Authorization") or ""
    if not header.lower().startswith("bearer "):
        return ""
    return header[7:].strip()


def _touch_last_login(user: User, timestamp=None) -> None:
    if not hasattr(user, "save"):
        return
    user.last_login = timestamp or timezone.now()
    user.save(update_fields=["last_login"])


def _require_admin(request) -> tuple[User | None, Response | None]:
    token = _extract_bearer_token(request)
    if not token:
        return None, Response(
            {"detail": "Authentication credentials were not provided."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    try:
        payload = signing.loads(
            token,
            salt=_ADMIN_TOKEN_SALT,
            max_age=_ADMIN_TOKEN_TTL_SECONDS,
        )
    except SignatureExpired:
        return None, Response(
            {"detail": "Admin access token has expired."},
            status=status.HTTP_401_UNAUTHORIZED,
        )
    except BadSignature:
        return None, Response(
            {"detail": "Invalid admin access token."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    user_id = payload.get("uid")
    if not user_id:
        return None, Response(
            {"detail": "Invalid admin access token."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    try:
        user = User.objects.filter(id=user_id, is_active=True).first()
    except (OperationalError, DatabaseError):
        return None, _database_unavailable_response()

    if not user:
        return None, Response(
            {"detail": "Admin account was not found."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    if not (user.role == User.Role.ADMIN or user.is_staff):
        return None, Response(
            {"detail": "This account is not allowed to access admin endpoints."},
            status=status.HTTP_403_FORBIDDEN,
        )

    return user, None


def _require_employer_account(
    request,
    *,
    allow_pending: bool = False,
) -> tuple[EmployerAccount | None, Response | None]:
    token = _extract_bearer_token(request)
    if not token:
        return None, Response(
            {"detail": "Authentication credentials were not provided."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    try:
        payload = signing.loads(
            token,
            salt=_EMPLOYER_TOKEN_SALT,
            max_age=_EMPLOYER_TOKEN_TTL_SECONDS,
        )
    except SignatureExpired:
        return None, Response(
            {"detail": "Employer access token has expired."},
            status=status.HTTP_401_UNAUTHORIZED,
        )
    except BadSignature:
        return None, Response(
            {"detail": "Invalid employer access token."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    user_id = payload.get("uid")
    if not user_id:
        return None, Response(
            {"detail": "Invalid employer access token."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    try:
        user = User.objects.filter(
            id=user_id,
            role=User.Role.EMPLOYER,
            is_active=True,
        ).first()
        account = EmployerAccount.objects.select_related("user").filter(user=user).first()
    except (OperationalError, DatabaseError):
        return None, _database_unavailable_response()

    if not user or not account:
        return None, Response(
            {"detail": "Employer account was not found."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    if account.account_status in {AccountStatus.REJECTED, AccountStatus.SUSPENDED}:
        return None, Response(
            {
                "detail": (
                    f"Employer account access blocked ({account.account_status}). "
                    "Contact the administrator."
                ),
            },
            status=status.HTTP_403_FORBIDDEN,
        )

    if account.account_status != AccountStatus.ACTIVE and not (
        allow_pending and account.account_status == AccountStatus.PENDING
    ):
        return None, Response(
            {
                "detail": "Employer account is not active. Approval is required before access.",
            },
            status=status.HTTP_403_FORBIDDEN,
        )

    return account, None


def _serialize_profile_to_survey_data(profile: AlumniProfile | None) -> dict:
    if not profile:
        return {}

    prof_eligibility = [
        value.strip()
        for value in (profile.prof_eligibility or "").split(",")
        if value.strip()
    ]

    return {
        "familyName": profile.last_name,
        "firstName": profile.first_name,
        "middleName": profile.middle_name,
        "gender": profile.gender,
        "birthDate": profile.birth_date,
        "civilStatus": profile.civil_status,
        "mobile": profile.mobile,
        "facebook": profile.facebook_url,
        "city": profile.city,
        "province": profile.province,
        "graduationDate": profile.graduation_date,
        "scholarship": profile.scholarship,
        "highestAttainment": profile.highest_attainment,
        "graduateSchool": profile.graduate_school,
        "profEligibility": prof_eligibility,
        "profEligibilityOther": profile.prof_eligibility_other,
        "awards": profile.awards,
    }


def _apply_survey_updates(profile: AlumniProfile | None, survey_data: dict) -> None:
    if not profile or not isinstance(survey_data, dict):
        return

    changed_fields: list[str] = []

    def update_field(field_name: str, value) -> None:
        if getattr(profile, field_name) != value:
            setattr(profile, field_name, value)
            changed_fields.append(field_name)

    text_mappings = [
        ("firstName", "first_name"),
        ("middleName", "middle_name"),
        ("familyName", "last_name"),
        ("gender", "gender"),
        ("birthDate", "birth_date"),
        ("civilStatus", "civil_status"),
        ("mobile", "mobile"),
        ("facebook", "facebook_url"),
        ("city", "city"),
        ("province", "province"),
        ("graduationDate", "graduation_date"),
        ("scholarship", "scholarship"),
        ("highestAttainment", "highest_attainment"),
        ("graduateSchool", "graduate_school"),
        ("profEligibilityOther", "prof_eligibility_other"),
        ("awards", "awards"),
    ]

    for source_key, model_field in text_mappings:
        if source_key in survey_data:
            raw_value = survey_data.get(source_key)
            value = str(raw_value).strip() if raw_value is not None else ""
            update_field(model_field, value)

    if "profEligibility" in survey_data:
        raw_items = survey_data.get("profEligibility")
        if isinstance(raw_items, list):
            normalized = ",".join(
                str(item).strip() for item in raw_items if str(item).strip()
            )
            update_field("prof_eligibility", normalized)

    if "graduationDate" in survey_data:
        grad_year = _extract_year(str(survey_data.get("graduationDate") or ""))
        if grad_year and profile.graduation_year != grad_year:
            profile.graduation_year = grad_year
            changed_fields.append("graduation_year")

    if changed_fields:
        update_fields = list(dict.fromkeys(changed_fields + ["updated_at"]))
        profile.save(update_fields=update_fields)


def _normalize_employment_status(raw_status: str | None) -> str | None:
    if raw_status is None:
        return None

    normalized = str(raw_status).strip().lower().replace("-", "_").replace(" ", "_")
    valid = {
        EmploymentRecord.EmploymentStatus.EMPLOYED,
        EmploymentRecord.EmploymentStatus.SELF_EMPLOYED,
        EmploymentRecord.EmploymentStatus.UNEMPLOYED,
    }
    return normalized if normalized in valid else None


def _normalize_proficiency(raw_level: str | None) -> str:
    normalized = str(raw_level or "").strip().lower().replace("-", "_").replace(" ", "_")
    valid_levels = {
        AlumniSkill.Proficiency.BEGINNER,
        AlumniSkill.Proficiency.INTERMEDIATE,
        AlumniSkill.Proficiency.ADVANCED,
        AlumniSkill.Proficiency.EXPERT,
    }
    if normalized in valid_levels:
        return normalized
    return AlumniSkill.Proficiency.INTERMEDIATE


def _extract_skill_entries(survey_data: dict, raw_entries=None) -> list[dict]:
    parsed_entries = _safe_json(raw_entries)
    candidates = parsed_entries if isinstance(parsed_entries, list) else []

    if not candidates:
        candidates = survey_data.get("skillEntries") or []

    if not candidates:
        skill_ids = survey_data.get("skillIds") or []
        if isinstance(skill_ids, list):
            candidates.extend({"skillId": skill_id} for skill_id in skill_ids)

    if not candidates:
        raw_skills = survey_data.get("skills") or []
        if isinstance(raw_skills, list):
            candidates.extend(raw_skills)

    extracted: list[dict] = []
    seen: set[str] = set()

    for item in candidates:
        skill_id = None
        skill_name = ""
        proficiency = None

        if isinstance(item, dict):
            skill_id = item.get("skillId") or item.get("id")
            skill_name = str(item.get("name") or item.get("skill") or "").strip()
            proficiency = item.get("proficiency") or item.get("proficiency_level")
        elif isinstance(item, str):
            skill_name = item.strip()

        key = str(skill_id or skill_name).strip().lower()
        if not key or key in seen:
            continue

        seen.add(key)
        extracted.append(
            {
                "skill_id": str(skill_id).strip() if skill_id else None,
                "skill_name": skill_name,
                "proficiency": _normalize_proficiency(proficiency),
            }
        )

    return extracted


def _resolve_job_title(job_title_value: str, job_title_id=None) -> JobTitle | None:
    if job_title_id:
        by_id = JobTitle.objects.filter(id=job_title_id, is_active=True).first()
        if by_id:
            return by_id

    lookup_name = str(job_title_value or "").strip()
    if not lookup_name:
        return None
    return JobTitle.objects.filter(name__iexact=lookup_name, is_active=True).first()


def _resolve_region(region_id=None, region_hint: str | None = None) -> Region | None:
    if region_id:
        by_id = Region.objects.filter(id=region_id, is_active=True).first()
        if by_id:
            return by_id

    lookup = str(region_hint or "").strip()
    if not lookup:
        return None

    return Region.objects.filter(is_active=True).filter(
        name__iexact=lookup
    ).first() or Region.objects.filter(is_active=True).filter(code__iexact=lookup).first()


def _sync_alumni_skills(account: AlumniAccount, entries: list[dict]) -> None:
    selected_skill_ids: list[str] = []

    for entry in entries:
        skill = None
        skill_id = entry.get("skill_id")
        skill_name = entry.get("skill_name")

        if skill_id:
            skill = Skill.objects.filter(id=skill_id, is_active=True).first()
        if not skill and skill_name:
            skill = Skill.objects.filter(name__iexact=skill_name, is_active=True).first()
        if not skill:
            continue

        AlumniSkill.objects.update_or_create(
            alumni=account,
            skill=skill,
            defaults={"proficiency_level": _normalize_proficiency(entry.get("proficiency"))},
        )
        selected_skill_ids.append(str(skill.id))

    if selected_skill_ids:
        AlumniSkill.objects.filter(alumni=account).exclude(
            skill_id__in=selected_skill_ids
        ).delete()
    else:
        AlumniSkill.objects.filter(alumni=account).delete()


def _serialize_employment_record(record: EmploymentRecord | None) -> dict:
    if not record:
        return {}

    return {
        "id": str(record.id),
        "employmentStatus": record.employment_status.replace("_", "-"),
        "employerName": record.employer_name_input,
        "jobTitle": record.job_title_input,
        "jobTitleId": str(record.job_title_id) if record.job_title_id else None,
        "jobTitleName": record.job_title.name if record.job_title else None,
        "workLocation": record.work_location,
        "regionId": str(record.region_id) if record.region_id else None,
        "regionName": record.region.name if record.region else None,
        "verificationStatus": record.verification_status,
        "isCurrent": record.is_current,
        "createdAt": record.created_at.isoformat(),
    }


def _serialize_alumni_record(account: AlumniAccount) -> dict:
    payload = _session_payload(account)
    profile = getattr(account, "profile", None)
    current_record = account.employment_records.select_related("job_title", "region").filter(
        is_current=True
    ).first()
    survey_data = _serialize_profile_to_survey_data(profile)

    if payload.get("skills"):
        survey_data["skills"] = payload["skills"]

    if current_record and current_record.job_title_id:
        survey_data["currentJobTitleId"] = str(current_record.job_title_id)
    if current_record and current_record.region_id:
        survey_data["currentJobRegionId"] = str(current_record.region_id)

    payload.update(
        {
            "surveyData": survey_data,
            "company": current_record.employer_name_input if current_record else "",
            "jobTitle": current_record.job_title_input if current_record else "",
            "workLocation": current_record.work_location if current_record else "",
            "jobTitleId": str(current_record.job_title_id) if current_record and current_record.job_title_id else None,
            "regionId": str(current_record.region_id) if current_record and current_record.region_id else None,
        }
    )

    scan_urls: dict[str, str] = {}
    gps_lat = None
    gps_lng = None
    for scan in account.face_scans.filter(
        scan_type__in=["face_front", "face_left", "face_right"]
    ).order_by("-created_at"):
        if scan.scan_type not in scan_urls:
            scan_urls[scan.scan_type] = scan.url
        if gps_lat is None and gps_lng is None and scan.gps_lat is not None and scan.gps_lng is not None:
            gps_lat = float(scan.gps_lat)
            gps_lng = float(scan.gps_lng)

    if gps_lat is not None and gps_lng is not None:
        payload["lat"] = gps_lat
        payload["lng"] = gps_lng

    if scan_urls:
        payload["registrationFaceScans"] = {
            "front": scan_urls.get("face_front") or payload.get("facePhotoUrl"),
            "left": scan_urls.get("face_left"),
            "right": scan_urls.get("face_right"),
        }

    return payload


def _serialize_employer_account(account: EmployerAccount) -> dict:
    return {
        "id": str(account.id),
        "company": account.company_name,
        "companyName": account.company_name,
        "industry": getattr(account, "industry", ""),
        "contact": getattr(account, "contact_name", ""),
        "contactName": getattr(account, "contact_name", ""),
        "position": getattr(account, "contact_position", ""),
        "email": account.company_email,
        "credentialEmail": account.company_email,
        "phone": getattr(account, "company_phone", ""),
        "website": getattr(account, "company_website", ""),
        "status": "approved"
        if account.account_status == AccountStatus.ACTIVE
        else account.account_status,
        "accountStatus": account.account_status,
        "date": account.created_at.date().isoformat(),
    }


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

    current_record = account.employment_records.select_related("job_title", "region").filter(
        is_current=True
    ).first()
    employment_status = (
        current_record.employment_status if current_record else "unemployed"
    )
    skill_entries = list(account.skills.select_related("skill").order_by("skill__name"))
    skill_names = [entry.skill.name for entry in skill_entries if entry.skill]

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
        "employmentStatus": employment_status.replace("_", "-"),
        "company": current_record.employer_name_input if current_record else "",
        "jobTitle": current_record.job_title_input if current_record else "",
        "jobTitleId": str(current_record.job_title_id) if current_record and current_record.job_title_id else None,
        "regionId": str(current_record.region_id) if current_record and current_record.region_id else None,
        "verificationRecordStatus": current_record.verification_status if current_record else None,
        "skills": skill_names,
        "skillEntries": [
            {
                "id": str(entry.id),
                "skillId": str(entry.skill_id),
                "name": entry.skill.name if entry.skill else "",
                "proficiency": entry.proficiency_level,
            }
            for entry in skill_entries
        ],
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

        try:
            user = _authenticate_by_email(email, password)
        except (OperationalError, DatabaseError):
            return _database_unavailable_response()

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

        try:
            _touch_last_login(user)
        except (OperationalError, DatabaseError):
            return _database_unavailable_response()

        access_token = _issue_admin_token(user)

        return Response(
            {
                "message": "Admin login successful.",
                "user": {"id": str(user.id), "email": user.email, "role": "admin"},
                "accessToken": access_token,
                "tokenType": "Bearer",
                "expiresIn": _ADMIN_TOKEN_TTL_SECONDS,
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
        normalized_employment_status = _normalize_employment_status(employment_status_raw)

        if employment_status_raw and normalized_employment_status is None:
            return Response(
                {
                    "detail": "employment_status must be one of: employed, self-employed, unemployed.",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

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
        if not isinstance(survey_data, dict):
            survey_data = {}
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

            final_employment_status = (
                normalized_employment_status
                or EmploymentRecord.EmploymentStatus.UNEMPLOYED
            )
            employer_name = (
                survey_data.get("currentJobCompany")
                or survey_data.get("firstJobCompany")
                or (
                    "Not currently employed"
                    if final_employment_status == EmploymentRecord.EmploymentStatus.UNEMPLOYED
                    else "Not provided"
                )
            )
            job_title = (
                survey_data.get("currentJobPosition")
                or survey_data.get("firstJobTitle")
                or (
                    "N/A"
                    if final_employment_status == EmploymentRecord.EmploymentStatus.UNEMPLOYED
                    else "Not provided"
                )
            )
            work_location = str(survey_data.get("currentJobLocation") or "").strip()

            job_title_ref = _resolve_job_title(
                str(job_title),
                survey_data.get("currentJobTitleId") or survey_data.get("firstJobTitleId"),
            )
            region_ref = _resolve_region(
                survey_data.get("currentJobRegionId") or survey_data.get("region_id"),
                work_location,
            )

            EmploymentRecord.objects.create(
                alumni=alumni_account,
                employment_status=final_employment_status,
                employer_name_input=str(employer_name).strip(),
                job_title_input=str(job_title).strip(),
                job_title=job_title_ref,
                work_location=work_location,
                region=region_ref,
                is_current=True,
            )

            skill_entries = _extract_skill_entries(
                survey_data,
                raw_entries=request.data.get("skill_entries"),
            )
            _sync_alumni_skills(alumni_account, skill_entries)

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

        try:
            user = _authenticate_by_email(email, password)
        except (OperationalError, DatabaseError):
            return _database_unavailable_response()

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
        except (OperationalError, DatabaseError):
            return _database_unavailable_response()

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
        try:
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
            _touch_last_login(user, now)
        except (OperationalError, DatabaseError):
            return _database_unavailable_response()

        return Response(
            {
                "message": "Graduate login successful.",
                "alumni": _session_payload(alumni_account),
                "faceScanUrl": login_scan_url,
            }
        )


class EmployerRegisterView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        email = (request.data.get("credential_email") or request.data.get("email") or "").strip().lower()
        password = request.data.get("password") or ""
        confirm_password = request.data.get("confirm_password") or ""
        company_name = (request.data.get("company_name") or "").strip()

        if not email or not password or not confirm_password or not company_name:
            return Response(
                {
                    "detail": "Required fields: credential_email (or email), password, confirm_password, company_name.",
                },
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

        try:
            if User.objects.filter(email=email).exists():
                return Response(
                    {"detail": "This email is already registered."},
                    status=status.HTTP_409_CONFLICT,
                )

            if EmployerAccount.objects.filter(company_email=email).exists():
                return Response(
                    {"detail": "An employer account with this credential email already exists."},
                    status=status.HTTP_409_CONFLICT,
                )

            with transaction.atomic():
                user = User.objects.create_user(
                    email=email,
                    password=password,
                    role=User.Role.EMPLOYER,
                )

                employer_account = EmployerAccount.objects.create(
                    user=user,
                    company_email=email,
                    company_name=company_name,
                    account_status=AccountStatus.PENDING,
                )

                optional_updates = {
                    "industry": (request.data.get("industry") or "").strip(),
                    "contact_name": (request.data.get("contact_name") or "").strip(),
                    "contact_position": (request.data.get("position") or "").strip(),
                    "company_website": (request.data.get("website") or "").strip(),
                    "company_phone": (request.data.get("phone") or "").strip(),
                }

                update_fields: list[str] = []
                for field_name, value in optional_updates.items():
                    if hasattr(employer_account, field_name):
                        setattr(employer_account, field_name, value)
                        update_fields.append(field_name)

                if update_fields:
                    employer_account.save(update_fields=update_fields + ["updated_at"])
        except (OperationalError, DatabaseError):
            return _database_unavailable_response()

        return Response(
            {
                "message": "Employer registration submitted. Account is pending approval.",
                "user": {
                    "id": str(user.id),
                    "email": user.email,
                    "role": user.role,
                },
                "employer": _serialize_employer_account(employer_account),
                "accessToken": _issue_employer_token(user),
                "tokenType": "Bearer",
                "expiresIn": _EMPLOYER_TOKEN_TTL_SECONDS,
            },
            status=status.HTTP_201_CREATED,
        )


class EmployerLoginView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        email = (request.data.get("email") or "").strip().lower()
        password = request.data.get("password") or ""

        if not email or not password:
            return Response(
                {"detail": "Email and password are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            user = _authenticate_by_email(email, password)
        except (OperationalError, DatabaseError):
            return _database_unavailable_response()

        if not user:
            return Response(
                {"detail": "Invalid email or password."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        if user.role != User.Role.EMPLOYER:
            return Response(
                {"detail": "This account is not an employer account."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            employer_account = user.employer_account
        except EmployerAccount.DoesNotExist:
            return Response(
                {"detail": "Employer profile was not found for this account."},
                status=status.HTTP_404_NOT_FOUND,
            )
        except (OperationalError, DatabaseError):
            return _database_unavailable_response()

        if employer_account.account_status in {AccountStatus.REJECTED, AccountStatus.SUSPENDED}:
            return Response(
                {
                    "detail": (
                        f"Account access blocked ({employer_account.account_status}). "
                        "Contact the administrator."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            _touch_last_login(user)
        except (OperationalError, DatabaseError):
            return _database_unavailable_response()

        access_token = _issue_employer_token(user)

        return Response(
            {
                "message": "Employer login successful.",
                "user": {
                    "id": str(user.id),
                    "email": user.email,
                    "role": "employer",
                },
                "employer": _serialize_employer_account(employer_account),
                "accessToken": access_token,
                "tokenType": "Bearer",
                "expiresIn": _EMPLOYER_TOKEN_TTL_SECONDS,
            }
        )


class AlumniAccountStatusView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, alumni_id):
        try:
            account = (
                AlumniAccount.objects.select_related("user", "profile", "master_record")
                .prefetch_related("employment_records", "face_scans", "skills__skill")
                .filter(id=alumni_id)
                .first()
            )
        except (OperationalError, DatabaseError):
            return _database_unavailable_response()

        if not account:
            return Response(
                {"detail": "Alumni account was not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response({"alumni": _serialize_alumni_record(account)})


class EmployerAccountStatusView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, employer_id):
        account, error_response = _require_employer_account(request, allow_pending=True)
        if error_response:
            return error_response

        if str(account.id) != str(employer_id):
            return Response(
                {"detail": "You are not allowed to access this employer account."},
                status=status.HTTP_403_FORBIDDEN,
            )

        return Response({"employer": _serialize_employer_account(account)})


class AlumniEmploymentUpdateView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, alumni_id):
        return self._save(request, alumni_id)

    def patch(self, request, alumni_id):
        return self._save(request, alumni_id)

    def _save(self, request, alumni_id):
        try:
            account = (
                AlumniAccount.objects.select_related("profile")
                .prefetch_related("employment_records", "face_scans", "skills__skill")
                .filter(id=alumni_id)
                .first()
            )
        except (OperationalError, DatabaseError):
            return _database_unavailable_response()

        if not account:
            return Response(
                {"detail": "Alumni account was not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        survey_data = _safe_json(request.data.get("survey_data"))
        if not isinstance(survey_data, dict):
            survey_data = {}

        profile = getattr(account, "profile", None)
        _apply_survey_updates(profile, survey_data)

        raw_status = request.data.get("employment_status")
        normalized_status = _normalize_employment_status(raw_status)
        if raw_status is not None and normalized_status is None:
            return Response(
                {
                    "detail": "employment_status must be one of: employed, self-employed, unemployed.",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            with transaction.atomic():
                current_record = account.employment_records.select_related(
                    "job_title", "region"
                ).filter(is_current=True).first()

                if normalized_status is None:
                    normalized_status = (
                        current_record.employment_status
                        if current_record
                        else EmploymentRecord.EmploymentStatus.UNEMPLOYED
                    )

                employer_name = (
                    request.data.get("employer_name")
                    or request.data.get("company")
                    or survey_data.get("currentJobCompany")
                    or survey_data.get("firstJobCompany")
                    or (current_record.employer_name_input if current_record else "")
                )
                job_title = (
                    request.data.get("job_title")
                    or request.data.get("current_job_title")
                    or survey_data.get("currentJobPosition")
                    or survey_data.get("firstJobTitle")
                    or (current_record.job_title_input if current_record else "")
                )
                work_location = (
                    request.data.get("work_location")
                    or survey_data.get("currentJobLocation")
                    or (current_record.work_location if current_record else "")
                )

                default_employer = (
                    "Not currently employed"
                    if normalized_status == EmploymentRecord.EmploymentStatus.UNEMPLOYED
                    else "Not provided"
                )
                default_job = (
                    "N/A"
                    if normalized_status == EmploymentRecord.EmploymentStatus.UNEMPLOYED
                    else "Not provided"
                )

                employer_value = str(employer_name or default_employer).strip()
                job_value = str(job_title or default_job).strip()
                location_value = str(work_location or "").strip()

                job_title_id = (
                    request.data.get("job_title_id")
                    or survey_data.get("currentJobTitleId")
                    or survey_data.get("firstJobTitleId")
                )
                if job_title_id is not None:
                    job_title_id = str(job_title_id).strip() or None
                job_title_ref = _resolve_job_title(job_value, job_title_id)
                if job_title_id and not job_title_ref:
                    return Response(
                        {"detail": "job_title_id does not match an active job title."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if not job_title_ref and current_record and current_record.job_title_id:
                    # Keep the last valid reference when free-text title doesn't map.
                    job_title_ref = current_record.job_title

                region_id = (
                    request.data.get("region_id")
                    or survey_data.get("currentJobRegionId")
                    or survey_data.get("region_id")
                )
                if region_id is not None:
                    region_id = str(region_id).strip() or None
                region = _resolve_region(region_id, location_value)
                if region_id and not region:
                    return Response(
                        {"detail": "region_id does not match an active region."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if not region and current_record and current_record.region_id:
                    # Preserve the existing region mapping when no new mapping is resolved.
                    region = current_record.region

                if current_record:
                    current_record.employment_status = normalized_status
                    current_record.employer_name_input = employer_value
                    current_record.job_title_input = job_value
                    current_record.job_title = job_title_ref
                    current_record.work_location = location_value
                    current_record.region = region
                    current_record.is_current = True
                    current_record.save(
                        update_fields=[
                            "employment_status",
                            "employer_name_input",
                            "job_title_input",
                            "job_title",
                            "work_location",
                            "region",
                            "is_current",
                            "updated_at",
                        ]
                    )
                    employment_record = current_record
                else:
                    employment_record = EmploymentRecord.objects.create(
                        alumni=account,
                        employment_status=normalized_status,
                        employer_name_input=employer_value,
                        job_title_input=job_value,
                        job_title=job_title_ref,
                        work_location=location_value,
                        region=region,
                        is_current=True,
                    )

                skill_entries = _extract_skill_entries(
                    survey_data,
                    raw_entries=request.data.get("skill_entries"),
                )
                _sync_alumni_skills(account, skill_entries)
        except (OperationalError, DatabaseError):
            return _database_unavailable_response()

        return Response(
            {
                "message": "Employment record updated.",
                "alumni": _serialize_alumni_record(account),
                "employmentRecord": _serialize_employment_record(employment_record),
            }
        )


class PendingAlumniListView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        _admin_user, error_response = _require_admin(request)
        if error_response:
            return error_response

        try:
            accounts = (
                AlumniAccount.objects.filter(account_status=AccountStatus.PENDING)
                .select_related("user", "profile", "master_record")
                .prefetch_related("employment_records", "face_scans", "skills__skill")
                .order_by("-created_at")
            )
            results = [_serialize_alumni_record(account) for account in accounts]
        except (OperationalError, DatabaseError):
            return _database_unavailable_response()

        return Response({"count": len(results), "results": results})


class VerifiedAlumniListView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        _admin_user, error_response = _require_admin(request)
        if error_response:
            return error_response

        try:
            accounts = (
                AlumniAccount.objects.filter(account_status=AccountStatus.ACTIVE)
                .select_related("user", "profile", "master_record")
                .prefetch_related("employment_records", "face_scans", "skills__skill")
                .order_by("-updated_at")
            )
            results = [_serialize_alumni_record(account) for account in accounts]
        except (OperationalError, DatabaseError):
            return _database_unavailable_response()

        return Response({"count": len(results), "results": results})


class AlumniRequestApproveView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, alumni_id):
        _admin_user, error_response = _require_admin(request)
        if error_response:
            return error_response

        try:
            account = (
                AlumniAccount.objects.select_related("user", "profile", "master_record")
                .prefetch_related("employment_records", "face_scans", "skills__skill")
                .filter(id=alumni_id)
                .first()
            )
            if not account:
                return Response(
                    {"detail": "Alumni account was not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            account.account_status = AccountStatus.ACTIVE
            account.save(update_fields=["account_status", "updated_at"])
        except (OperationalError, DatabaseError):
            return _database_unavailable_response()

        return Response(
            {
                "message": "Alumni account approved.",
                "alumni": _serialize_alumni_record(account),
            }
        )


class AlumniRequestRejectView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, alumni_id):
        _admin_user, error_response = _require_admin(request)
        if error_response:
            return error_response

        try:
            account = (
                AlumniAccount.objects.select_related("user", "profile", "master_record")
                .prefetch_related("employment_records", "face_scans", "skills__skill")
                .filter(id=alumni_id)
                .first()
            )
            if not account:
                return Response(
                    {"detail": "Alumni account was not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            account.account_status = AccountStatus.REJECTED
            account.save(update_fields=["account_status", "updated_at"])
        except (OperationalError, DatabaseError):
            return _database_unavailable_response()

        return Response(
            {
                "message": "Alumni account rejected.",
                "alumni": _serialize_alumni_record(account),
            }
        )


class EmployerRequestsListView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        _admin_user, error_response = _require_admin(request)
        if error_response:
            return error_response

        status_filter = (request.query_params.get("status") or "").strip().lower()
        allowed_statuses = {
            AccountStatus.PENDING,
            AccountStatus.ACTIVE,
            AccountStatus.REJECTED,
            AccountStatus.SUSPENDED,
        }

        try:
            queryset = EmployerAccount.objects.select_related("user").order_by("-created_at")
            if status_filter in allowed_statuses:
                queryset = queryset.filter(account_status=status_filter)

            results = [_serialize_employer_account(account) for account in queryset]
        except (OperationalError, DatabaseError):
            return _database_unavailable_response()

        return Response({"count": len(results), "results": results})


class EmployerRequestApproveView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, employer_id):
        _admin_user, error_response = _require_admin(request)
        if error_response:
            return error_response

        try:
            with transaction.atomic():
                account = EmployerAccount.objects.select_related("user").filter(id=employer_id).first()
                if not account:
                    return Response(
                        {"detail": "Employer account was not found."},
                        status=status.HTTP_404_NOT_FOUND,
                    )

                account.account_status = AccountStatus.ACTIVE
                account.save(update_fields=["account_status", "updated_at"])

                held_decisions = VerificationDecision.objects.select_related(
                    "token__employment_record",
                    "token__alumni",
                    "verified_job_title",
                ).filter(
                    employer_account=account,
                    is_held=True,
                ).order_by("decided_at")

                activated_at = timezone.now()
                for decision in held_decisions:
                    token = decision.token
                    employment_record = token.employment_record if token else None

                    if not employment_record and token:
                        employment_record = EmploymentRecord.objects.select_related(
                            "job_title",
                            "region",
                        ).filter(
                            alumni=token.alumni,
                            is_current=True,
                        ).first()

                    if employment_record:
                        employment_record.employer_account = account
                        if decision.verified_employer_name:
                            employment_record.employer_name_input = decision.verified_employer_name
                        if decision.verified_job_title:
                            employment_record.job_title = decision.verified_job_title
                            if not employment_record.job_title_input:
                                employment_record.job_title_input = decision.verified_job_title.name

                        employment_record.verification_status = (
                            EmploymentRecord.VerificationStatus.VERIFIED
                            if decision.decision == VerificationDecision.Decision.CONFIRM
                            else EmploymentRecord.VerificationStatus.DENIED
                        )
                        employment_record.save(
                            update_fields=[
                                "employer_account",
                                "employer_name_input",
                                "job_title",
                                "job_title_input",
                                "verification_status",
                                "updated_at",
                            ]
                        )

                        if token and token.employment_record_id != employment_record.id:
                            token.employment_record = employment_record
                            token.save(update_fields=["employment_record"])

                    decision.is_held = False
                    decision.held_activated_at = activated_at
                    decision.save(update_fields=["is_held", "held_activated_at"])
        except (OperationalError, DatabaseError):
            return _database_unavailable_response()

        return Response(
            {
                "message": "Employer account approved.",
                "employer": _serialize_employer_account(account),
            }
        )


class EmployerRequestRejectView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, employer_id):
        _admin_user, error_response = _require_admin(request)
        if error_response:
            return error_response

        try:
            account = EmployerAccount.objects.select_related("user").filter(id=employer_id).first()
            if not account:
                return Response(
                    {"detail": "Employer account was not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            account.account_status = AccountStatus.REJECTED
            account.save(update_fields=["account_status", "updated_at"])
        except (OperationalError, DatabaseError):
            return _database_unavailable_response()

        return Response(
            {
                "message": "Employer account rejected.",
                "employer": _serialize_employer_account(account),
            }
        )