import json
from datetime import date
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import AccountStatus, AlumniAccount, EmployerAccount, GraduateMasterRecord, User
from .supabase_storage import SupabaseStorageError, upload_image_bytes

try:
    import cv2
except Exception:  # pragma: no cover - optional dependency guard
    cv2 = None

try:
    import numpy as np
except Exception:  # pragma: no cover - optional dependency guard
    np = None


FACE_MATCH_THRESHOLD = 0.82
MIN_FACE_SIZE_PX = 72
MIN_FACE_AREA_RATIO = 0.045


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


def _download_image_bytes(url: str) -> bytes | None:
    if not url:
        return None
    try:
        with urlopen(url, timeout=15) as response:
            return response.read()
    except (HTTPError, URLError, TimeoutError):
        return None


def _extract_registration_front_scan_url(account: AlumniAccount) -> str | None:
    template = _safe_json_loads(account.biometric_template)
    if isinstance(template, dict):
        scans_raw = template.get("registration_face_scans", {})
        if isinstance(scans_raw, dict):
            for key in ("face_front", "front"):
                value = scans_raw.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()

    if account.face_photo_url:
        return account.face_photo_url.strip()
    return None


def _decode_image_for_cv(image_bytes: bytes):
    if cv2 is None or np is None or not image_bytes:
        return None
    buffer = np.frombuffer(image_bytes, dtype=np.uint8)
    if buffer.size == 0:
        return None
    return cv2.imdecode(buffer, cv2.IMREAD_COLOR)


def _extract_primary_face(image):
    if cv2 is None or image is None:
        return None

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    cascade = cv2.CascadeClassifier(f"{cv2.data.haarcascades}haarcascade_frontalface_default.xml")
    if cascade.empty():
        return None

    faces = cascade.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=6,
        minSize=(MIN_FACE_SIZE_PX, MIN_FACE_SIZE_PX),
    )
    if faces is None or len(faces) == 0:
        return None

    x, y, w, h = max(faces, key=lambda item: item[2] * item[3])
    image_area = max(int(image.shape[0]) * int(image.shape[1]), 1)
    if (w * h) / image_area < MIN_FACE_AREA_RATIO:
        return None

    face_gray = gray[y : y + h, x : x + w]
    if face_gray.size == 0:
        return None

    normalized = cv2.resize(face_gray, (160, 160), interpolation=cv2.INTER_AREA)
    normalized = cv2.equalizeHist(normalized)
    return normalized


def _face_similarity_score(reference_face, login_face) -> float:
    if cv2 is None or np is None:
        return 0.0

    ref_vector = reference_face.astype("float32").reshape(-1)
    login_vector = login_face.astype("float32").reshape(-1)

    ref_norm = float(np.linalg.norm(ref_vector))
    login_norm = float(np.linalg.norm(login_vector))
    if ref_norm == 0 or login_norm == 0:
        return 0.0

    cosine_score = float(np.dot(ref_vector, login_vector) / (ref_norm * login_norm))

    ref_hist = cv2.calcHist([reference_face], [0], None, [64], [0, 256])
    login_hist = cv2.calcHist([login_face], [0], None, [64], [0, 256])
    ref_hist = cv2.normalize(ref_hist, None)
    login_hist = cv2.normalize(login_hist, None)
    histogram_score = float(cv2.compareHist(ref_hist, login_hist, cv2.HISTCMP_CORREL))

    combined_score = (cosine_score * 0.65) + (histogram_score * 0.35)
    return max(0.0, min(combined_score, 1.0))


def _verify_login_face(reference_url: str, login_scan_bytes: bytes) -> tuple[bool, str, float]:
    if cv2 is None or np is None:
        return False, "Face verification service is unavailable. Please contact support.", 0.0

    reference_bytes = _download_image_bytes(reference_url)
    if not reference_bytes:
        return False, "Unable to load enrolled biometric reference. Please contact support.", 0.0

    reference_image = _decode_image_for_cv(reference_bytes)
    login_image = _decode_image_for_cv(login_scan_bytes)
    if reference_image is None or login_image is None:
        return False, "Face scan image could not be processed. Please try again.", 0.0

    reference_face = _extract_primary_face(reference_image)
    if reference_face is None:
        return False, "Enrolled biometric photo is invalid. Please contact support.", 0.0

    login_face = _extract_primary_face(login_image)
    if login_face is None:
        return False, "No face was detected in your scan. Keep your face centered and retry.", 0.0

    score = _face_similarity_score(reference_face, login_face)
    if score < FACE_MATCH_THRESHOLD:
        return False, "Face verification failed. The captured face did not match your registered biometrics.", score

    return True, "Face verification passed.", score


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


def _admin_alumni_payload(account: AlumniAccount) -> dict:
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

    if account.account_status == AccountStatus.ACTIVE:
        verification_status = "verified"
    elif account.account_status == AccountStatus.REJECTED:
        verification_status = "rejected"
    else:
        verification_status = "pending"

    return {
        "id": str(account.id),
        "name": name,
        "email": account.user.email,
        "graduationYear": graduation_year,
        "verificationStatus": verification_status,
        "accountStatus": account.account_status,
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


def _pending_alumni_payload(account: AlumniAccount) -> dict:
    return _admin_alumni_payload(account)


def _employer_request_payload(account: EmployerAccount) -> dict:
    profile = _safe_json_loads(account.profile_json)
    if not isinstance(profile, dict):
        profile = {}

    status_value = account.account_status
    if status_value == AccountStatus.ACTIVE:
        status_label = "approved"
    elif status_value == AccountStatus.REJECTED:
        status_label = "rejected"
    else:
        status_label = "pending"

    return {
        "id": str(account.id),
        "company": account.company_name,
        "industry": profile.get("industry") or "",
        "contact": profile.get("contact_name") or "",
        "position": profile.get("position") or "",
        "email": account.company_email,
        "credentialEmail": account.company_email,
        "phone": profile.get("phone") or "",
        "website": profile.get("website") or "",
        "status": status_label,
        "accountStatus": status_value,
        "date": account.created_at.date().isoformat(),
        "dateUpdated": account.updated_at.date().isoformat(),
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


class EmployerRegisterView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        company_name = (request.data.get("company_name") or request.data.get("companyName") or "").strip()
        industry = (request.data.get("industry") or "").strip()
        website = (request.data.get("website") or "").strip()
        contact_name = (request.data.get("contact_name") or request.data.get("contactName") or "").strip()
        position = (request.data.get("position") or "").strip()
        credential_email = (
            request.data.get("credential_email")
            or request.data.get("credentialEmail")
            or request.data.get("email")
            or ""
        ).strip().lower()
        phone = (request.data.get("phone") or "").strip()
        password = request.data.get("password") or ""
        confirm_password = request.data.get("confirm_password") or request.data.get("confirmPassword") or ""

        missing = []
        for field_name, value in {
            "company_name": company_name,
            "industry": industry,
            "contact_name": contact_name,
            "credential_email": credential_email,
            "password": password,
            "confirm_password": confirm_password,
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

        if User.objects.filter(email__iexact=credential_email).exists() or EmployerAccount.objects.filter(
            company_email__iexact=credential_email
        ).exists():
            return Response(
                {"detail": "This credential email is already registered."},
                status=status.HTTP_409_CONFLICT,
            )

        profile_data = {
            "industry": industry,
            "website": website,
            "contact_name": contact_name,
            "position": position,
            "phone": phone,
        }

        with transaction.atomic():
            user = User.objects.create_user(
                email=credential_email,
                password=password,
                role=User.Role.EMPLOYER,
            )
            employer_account = EmployerAccount.objects.create(
                user=user,
                company_email=credential_email,
                company_name=company_name,
                profile_json=json.dumps(profile_data),
                account_status=AccountStatus.PENDING,
            )

        return Response(
            {
                "message": "Employer registration submitted. Account is pending admin approval.",
                "user": {
                    "id": str(user.id),
                    "email": user.email,
                    "role": user.role,
                },
                "employer": _employer_request_payload(employer_account),
            },
            status=status.HTTP_201_CREATED,
        )


class EmployerLoginView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        credential_email = (
            request.data.get("credential_email")
            or request.data.get("credentialEmail")
            or request.data.get("email")
            or ""
        ).strip().lower()
        password = request.data.get("password") or ""

        if not credential_email or not password:
            return Response(
                {"detail": "Credential email and password are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = _authenticate_by_email(email=credential_email, password=password)
        if not user:
            return Response(
                {"detail": "Invalid credential email or password."},
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

        if employer_account.account_status in {AccountStatus.REJECTED, AccountStatus.SUSPENDED}:
            return Response(
                {"detail": f"Account access blocked ({employer_account.account_status}). Contact the administrator."},
                status=status.HTTP_403_FORBIDDEN,
            )

        return Response(
            {
                "message": "Employer login successful.",
                "user": {
                    "id": str(user.id),
                    "email": user.email,
                    "role": user.role,
                },
                "employer": _employer_request_payload(employer_account),
            },
            status=status.HTTP_200_OK,
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

        reference_scan_url = _extract_registration_front_scan_url(alumni_account)
        if not reference_scan_url:
            return Response(
                {"detail": "No enrolled biometric reference is available for this account."},
                status=status.HTTP_403_FORBIDDEN,
            )

        login_scan_bytes = face_scan.read()
        if not login_scan_bytes:
            return Response(
                {"detail": "Face scan image is empty. Please retry."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        is_match, verification_message, similarity_score = _verify_login_face(
            reference_url=reference_scan_url,
            login_scan_bytes=login_scan_bytes,
        )
        if not is_match:
            return Response(
                {
                    "detail": verification_message,
                    "similarityScore": round(similarity_score, 4),
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        scan_timestamp = timezone.now().strftime("%Y%m%d%H%M%S%f")
        storage_key_basis = alumni_account.master_record.full_name if alumni_account.master_record else alumni_account.user.email
        object_path = f"face-login/{_normalize_storage_key(storage_key_basis)}/{scan_timestamp}.jpg"

        try:
            login_scan_url = upload_image_bytes(
                file_bytes=login_scan_bytes,
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
                "similarity_score": round(similarity_score, 4),
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


class AlumniAccountStatusView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, alumni_id):
        alumni_account = AlumniAccount.objects.select_related("user", "master_record").filter(id=alumni_id).first()
        if not alumni_account:
            return Response(
                {"detail": "Graduate account was not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(
            {
                "alumni": _session_payload_from_alumni(alumni_account),
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


class VerifiedAlumniListView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        verified_accounts = AlumniAccount.objects.select_related("user", "master_record").filter(
            account_status=AccountStatus.ACTIVE
        ).order_by("-updated_at")

        return Response(
            {
                "count": verified_accounts.count(),
                "results": [_admin_alumni_payload(account) for account in verified_accounts],
            },
            status=status.HTTP_200_OK,
        )


class AlumniRequestApproveView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, alumni_id):
        alumni_account = AlumniAccount.objects.select_related("user", "master_record").filter(id=alumni_id).first()
        if not alumni_account:
            return Response(
                {"detail": "Graduate request was not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        alumni_account.account_status = AccountStatus.ACTIVE
        alumni_account.save(update_fields=["account_status", "updated_at"])

        return Response(
            {
                "message": "Graduate request approved.",
                "alumni": _admin_alumni_payload(alumni_account),
            },
            status=status.HTTP_200_OK,
        )


class AlumniRequestRejectView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, alumni_id):
        alumni_account = AlumniAccount.objects.select_related("user", "master_record").filter(id=alumni_id).first()
        if not alumni_account:
            return Response(
                {"detail": "Graduate request was not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        alumni_account.account_status = AccountStatus.REJECTED
        alumni_account.save(update_fields=["account_status", "updated_at"])

        return Response(
            {
                "message": "Graduate request rejected.",
                "alumni": _admin_alumni_payload(alumni_account),
            },
            status=status.HTTP_200_OK,
        )


class EmployerRequestsListView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        employer_accounts = EmployerAccount.objects.select_related("user").order_by("-created_at")

        return Response(
            {
                "count": employer_accounts.count(),
                "results": [_employer_request_payload(account) for account in employer_accounts],
            },
            status=status.HTTP_200_OK,
        )


class EmployerRequestApproveView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, employer_id):
        employer_account = EmployerAccount.objects.select_related("user").filter(id=employer_id).first()
        if not employer_account:
            return Response(
                {"detail": "Employer request was not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        employer_account.account_status = AccountStatus.ACTIVE
        employer_account.save(update_fields=["account_status", "updated_at"])

        return Response(
            {
                "message": "Employer request approved.",
                "employer": _employer_request_payload(employer_account),
            },
            status=status.HTTP_200_OK,
        )


class EmployerRequestRejectView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, employer_id):
        employer_account = EmployerAccount.objects.select_related("user").filter(id=employer_id).first()
        if not employer_account:
            return Response(
                {"detail": "Employer request was not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        employer_account.account_status = AccountStatus.REJECTED
        employer_account.save(update_fields=["account_status", "updated_at"])

        return Response(
            {
                "message": "Employer request rejected.",
                "employer": _employer_request_payload(employer_account),
            },
            status=status.HTTP_200_OK,
        )
