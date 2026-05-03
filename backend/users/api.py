import json
import logging
from datetime import date
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from django.core import signing
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import DatabaseError, OperationalError, transaction
from django.db.models import Prefetch
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    AccountStatus, AdminCredential, AlumniAccount, AlumniProfile,
    EmployerAccount, FaceScan, GraduateMasterRecord, User,
)
from .supabase_storage import SupabaseStorageError, upload_image_bytes
from tracer.models import (
    AlumniSkill, CompetencyProfile, EmploymentProfile,
    Skill, SkillCategory, WorkAddress,
)

try:
    import cv2
except Exception:  # pragma: no cover - optional dependency guard
    cv2 = None

try:
    import numpy as np
except Exception:  # pragma: no cover - optional dependency guard
    np = None


FACE_MATCH_THRESHOLD = 0.5
MIN_FACE_SIZE_PX = 72
MIN_FACE_AREA_RATIO = 0.045
FACE_DESCRIPTOR_LENGTH = 128
FACE_DESCRIPTOR_SIMILARITY_SCALE = 1.5
FACE_DESCRIPTOR_MIN_SIMILARITY = 0.5
FACE_DESCRIPTOR_DISTANCE_THRESHOLD = (1.0 - FACE_DESCRIPTOR_MIN_SIMILARITY) * FACE_DESCRIPTOR_SIMILARITY_SCALE

# Employer authentication token constants
_EMPLOYER_TOKEN_SALT = "users.employer.access"
_EMPLOYER_TOKEN_TTL_SECONDS = 60 * 60 * 8  # 8 hours


logger = logging.getLogger(__name__)


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


def _normalize_employment_status(value: str | None, fallback: str = "unemployed") -> str:
    normalized = (value or "").strip().lower().replace("_", "-")
    if not normalized:
        return fallback

    status_map = {
        "yes": "employed",
        "employed": "employed",
        "currently employed": "employed",
        "no": "unemployed",
        "unemployed": "unemployed",
        "not employed": "unemployed",
        "never employed": "unemployed",
        "self-employed": "self-employed",
        "self employed": "self-employed",
        "freelance": "self-employed",
        "entrepreneurial": "self-employed",
        "entrepreneur": "self-employed",
    }
    return status_map.get(normalized, fallback)


def _is_self_employment_label(value: str | None) -> bool:
    normalized = (value or "").strip().lower().replace("_", "-")
    if not normalized:
        return False
    return any(
        token in normalized
        for token in (
            "self-employed",
            "self employed",
            "freelance",
            "entrepreneurial",
            "entrepreneur",
        )
    )


def _derive_employment_status_from_survey(survey_data, fallback: str = "unemployed") -> str:
    if not isinstance(survey_data, dict):
        return fallback

    q1_status = survey_data.get("employmentStatus")
    normalized_status = _normalize_employment_status(q1_status, fallback=fallback)

    if normalized_status == "employed":
        if _is_self_employment_label(survey_data.get("currentJobSector")) or _is_self_employment_label(
            survey_data.get("firstJobSector")
        ):
            return "self-employed"

    return normalized_status


def _temporary_admin_data_unavailable_response(resource_name: str):
    logger.warning("Transient database error while loading %s data.", resource_name, exc_info=True)
    return Response(
        {
            "detail": f"{resource_name} data is temporarily unavailable. Please retry in a few seconds.",
            "retryable": True,
        },
        status=status.HTTP_503_SERVICE_UNAVAILABLE,
    )


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
    family_name: str,
    first_name: str,
    graduation_year: int | None = None,
) -> GraduateMasterRecord | None:
    if not family_name or not first_name:
        return None

    qs = GraduateMasterRecord.objects.filter(
        last_name__iexact=family_name,
        full_name__icontains=first_name,
        is_active=True,
    )
    if graduation_year:
        qs = qs.filter(batch_year=graduation_year)
    return qs.first()


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


def _parse_face_descriptor(raw_value) -> list[float] | None:
    payload = _safe_json_loads(raw_value)
    if not isinstance(payload, list):
        return None

    parsed: list[float] = []
    for item in payload:
        try:
            parsed.append(float(item))
        except (TypeError, ValueError):
            return None

    if len(parsed) != FACE_DESCRIPTOR_LENGTH:
        return None
    return parsed


def _parse_face_descriptor_samples(raw_value) -> list[list[float]]:
    payload = _safe_json_loads(raw_value)
    if not isinstance(payload, list):
        return []

    parsed_samples: list[list[float]] = []
    for sample in payload:
        if not isinstance(sample, list):
            continue

        parsed_sample: list[float] = []
        invalid_sample = False
        for item in sample:
            try:
                parsed_sample.append(float(item))
            except (TypeError, ValueError):
                invalid_sample = True
                break

        if invalid_sample or len(parsed_sample) != FACE_DESCRIPTOR_LENGTH:
            continue
        parsed_samples.append(parsed_sample)

    return parsed_samples


def _average_face_descriptors(descriptors: list[list[float]]) -> list[float] | None:
    if np is None or not descriptors:
        return None

    matrix = np.asarray(descriptors, dtype=np.float32)
    if matrix.ndim != 2 or matrix.shape[1] != FACE_DESCRIPTOR_LENGTH:
        return None

    averaged = np.mean(matrix, axis=0)
    return [float(value) for value in averaged.tolist()]


def _resolve_reference_descriptors(account: AlumniAccount) -> list[list[float]]:
    template = _safe_json_loads(account.biometric_template)
    if not isinstance(template, dict):
        return []

    references: list[list[float]] = []
    samples = _parse_face_descriptor_samples(template.get("face_descriptor_samples"))
    if samples:
        references.extend(samples)

    primary = _parse_face_descriptor(template.get("face_descriptor"))
    if primary:
        references.append(primary)

    # Preserve order and remove duplicate vectors.
    unique: list[list[float]] = []
    seen: set[tuple[float, ...]] = set()
    for descriptor in references:
        key = tuple(descriptor)
        if key in seen:
            continue
        seen.add(key)
        unique.append(descriptor)
    return unique


def _descriptor_distance(reference_descriptor: list[float], login_descriptor: list[float]) -> float:
    if np is None:
        return 999.0

    reference = np.asarray(reference_descriptor, dtype=np.float32)
    login = np.asarray(login_descriptor, dtype=np.float32)
    if reference.shape != login.shape or reference.size != FACE_DESCRIPTOR_LENGTH:
        return 999.0

    return float(np.linalg.norm(reference - login))


def _descriptor_similarity(distance: float) -> float:
    similarity = 1.0 - (distance / FACE_DESCRIPTOR_SIMILARITY_SCALE)
    return max(0.0, min(1.0, similarity))


def _verify_descriptor_match(
    login_descriptor: list[float],
    reference_descriptors: list[list[float]],
) -> tuple[bool, float, float]:
    if np is None or not login_descriptor or not reference_descriptors:
        return False, 999.0, 0.0

    distances = [_descriptor_distance(reference, login_descriptor) for reference in reference_descriptors]
    best_distance = min(distances) if distances else 999.0
    best_similarity = _descriptor_similarity(best_distance)
    is_match = best_similarity >= FACE_DESCRIPTOR_MIN_SIMILARITY
    return is_match, best_distance, best_similarity


def _extract_registration_scan_urls(account: AlumniAccount) -> list[str]:
    urls: list[str] = []

    template = _safe_json_loads(account.biometric_template)
    if isinstance(template, dict):
        scans_raw = template.get("registration_face_scans", {})
        if isinstance(scans_raw, dict):
            for key in ("face_front", "front", "face_left", "left", "face_right", "right"):
                value = scans_raw.get(key)
                if isinstance(value, str) and value.strip():
                    urls.append(value.strip())

    if account.face_photo_url:
        urls.append(account.face_photo_url.strip())

    # Preserve first-seen order while removing duplicates.
    return list(dict.fromkeys(urls))


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

    template_matrix = cv2.matchTemplate(reference_face, login_face, cv2.TM_CCOEFF_NORMED)
    template_score = float(template_matrix[0][0])

    combined_score = (cosine_score * 0.45) + (histogram_score * 0.25) + (template_score * 0.30)
    return max(0.0, min(combined_score, 1.0))


def _verify_login_face(reference_urls: list[str], login_scan_bytes: bytes) -> tuple[bool, str, float]:
    if cv2 is None or np is None:
        return False, "Face verification service is unavailable. Please contact support.", 0.0

    login_image = _decode_image_for_cv(login_scan_bytes)
    if login_image is None:
        return False, "Face scan image could not be processed. Please try again.", 0.0

    login_face = _extract_primary_face(login_image)
    if login_face is None:
        return False, "No face was detected in your scan. Keep your face centered and retry.", 0.0

    best_score = 0.0
    valid_references = 0
    for reference_url in reference_urls:
        reference_bytes = _download_image_bytes(reference_url)
        if not reference_bytes:
            continue

        reference_image = _decode_image_for_cv(reference_bytes)
        if reference_image is None:
            continue

        reference_face = _extract_primary_face(reference_image)
        if reference_face is None:
            continue

        valid_references += 1
        score = _face_similarity_score(reference_face, login_face)
        if score > best_score:
            best_score = score

    if valid_references == 0:
        return False, "Enrolled biometric photo is invalid. Please contact support.", 0.0

    if best_score < FACE_MATCH_THRESHOLD:
        return False, "Face verification failed. The captured face did not match your registered biometrics.", best_score

    return True, "Face verification passed.", best_score


_SECTOR_LABELS = {
    "government": "Government",
    "private": "Private",
    "entrepreneurial": "Entrepreneurial / Freelance / Self-Employed",
}


def _alumni_dashboard_queryset(qs):
    """Apply the prefetches needed by ``_admin_alumni_payload`` /
    ``_session_payload_from_alumni`` so the normalized-table reads collapse
    from N+1 queries (one per related table per alumni) to a constant 4
    additional queries regardless of result-set size.
    """
    from tracer.models import CompetencyProfile, EmploymentProfile, WorkAddress

    return qs.select_related("user", "master_record", "profile").prefetch_related(
        Prefetch(
            "employment_profiles",
            queryset=EmploymentProfile.objects.order_by("-updated_at"),
            to_attr="_prefetched_emp",
        ),
        Prefetch(
            "work_addresses",
            queryset=WorkAddress.objects.filter(is_current=True).order_by("-created_at"),
            to_attr="_prefetched_addr",
        ),
        Prefetch(
            "competency_profiles",
            queryset=CompetencyProfile.objects.order_by("-assessment_date"),
            to_attr="_prefetched_comp",
        ),
    )


def _first_prefetched(account, attr):
    """Return ``account._prefetched_<attr>[0]`` if available, falling back to
    a single query when the manager wasn't prefetched."""
    cached = getattr(account, attr, None)
    if isinstance(cached, list):
        return cached[0] if cached else None
    return None


def _normalized_view_from_tables(account: AlumniAccount) -> dict:
    """Read EmploymentProfile / CompetencyProfile / WorkAddress / EmploymentRecord
    rows for this alumni and return values formatted in the camelCase shape used
    by the rest of the payload helpers. Returns an empty dict when no rows exist.

    The keys here intentionally mirror the survey_data blob keys so callers can
    overlay this dict onto the JSON blob and not have to change downstream code.
    """
    view: dict = {}
    emp = _first_prefetched(account, "_prefetched_emp")
    if emp is None:
        try:
            emp = account.employment_profiles.order_by("-updated_at").first()
        except Exception:
            emp = None
    if emp is not None:
        if emp.current_job_title:
            view["currentJobPosition"] = emp.current_job_title
        if emp.first_job_title:
            view["firstJobTitle"] = emp.first_job_title
        if emp.current_job_company:
            view["currentJobCompany"] = emp.current_job_company
        if emp.current_job_sector:
            view["currentJobSector"] = _SECTOR_LABELS.get(
                emp.current_job_sector, emp.current_job_sector
            )
        if emp.first_job_sector:
            view["firstJobSector"] = _SECTOR_LABELS.get(
                emp.first_job_sector, emp.first_job_sector
            )
        if emp.employment_status:
            view["employment_status"] = emp.employment_status
        if emp.time_to_hire_raw:
            view["timeToHire"] = emp.time_to_hire_raw
        if emp.location_type is not None:
            view["currentJobLocation"] = (
                "Local (Philippines)" if emp.location_type
                else "Abroad / Remote Foreign Employer"
            )
        if emp.current_job_related_to_bsis is True:
            view["currentJobRelated"] = "Yes, directly related (IT/IS role)"
        elif emp.current_job_related_to_bsis is False:
            view["currentJobRelated"] = "Not related (different field)"

    addr = _first_prefetched(account, "_prefetched_addr")
    if addr is None:
        try:
            addr = account.work_addresses.filter(is_current=True).order_by("-created_at").first()
        except Exception:
            addr = None
    if addr is not None:
        view["city_municipality"] = addr.city_municipality
        view["country_address"] = addr.country
        view["region_address"] = addr.region
        if addr.barangay:
            view["barangay"] = addr.barangay
        if addr.zip_code:
            view["zip_code"] = addr.zip_code
        if addr.street_address:
            view["street_address"] = addr.street_address
        # Surface the work-location label using city + country (used by admin map)
        if not view.get("currentJobLocation"):
            view["currentJobLocation"] = (
                "Abroad / Remote Foreign Employer"
                if (addr.country and addr.country.lower() not in {"philippines", "ph"})
                else "Local (Philippines)"
            )

    comp = _first_prefetched(account, "_prefetched_comp")
    if comp is None:
        try:
            comp = account.competency_profiles.order_by("-assessment_date").first()
        except Exception:
            comp = None
    if comp is not None:
        tech = [s.get("name") for s in (comp.technical_skills or []) if isinstance(s, dict) and s.get("selected")]
        soft = [s.get("name") for s in (comp.soft_skills or []) if isinstance(s, dict) and s.get("selected")]
        if tech:
            view["technical_skills"] = tech
        if soft:
            view["soft_skills"] = soft
        if tech or soft:
            view["skills"] = (tech or []) + (soft or [])

    return view


def _merge_survey_view(survey_data: dict, account: AlumniAccount) -> dict:
    """Overlay normalized-table values on top of the legacy JSON blob.

    Tables win whenever they have a value; otherwise blob values are preserved
    so alumni who haven't re-saved since the dual-write rollout still render."""
    base = dict(survey_data) if isinstance(survey_data, dict) else {}
    overlay = _normalized_view_from_tables(account)
    for key, value in overlay.items():
        if value not in (None, "", []):
            base[key] = value
    return base


def _session_payload_from_alumni(account: AlumniAccount) -> dict:
    template = _safe_json_loads(account.biometric_template)
    profile = template.get("profile", {}) if isinstance(template, dict) else {}
    survey_data_blob = profile.get("survey_data", {}) if isinstance(profile, dict) else {}
    if not isinstance(survey_data_blob, dict):
        survey_data_blob = {}
    # Tables are now the source of truth — overlay them on the legacy blob.
    survey_data = _merge_survey_view(survey_data_blob, account)

    graduation_year = profile.get("graduation_year") or (
        account.master_record.batch_year if account.master_record else date.today().year
    )

    # Prioritize reading name from AlumniProfile table
    name = None
    try:
        if hasattr(account, "profile") and account.profile:
            name_parts = [account.profile.first_name, account.profile.middle_name, account.profile.last_name]
            name = " ".join(part.strip() for part in name_parts if part and part.strip())
    except Exception:
        pass

    # Fallback chain if AlumniProfile name not available
    if not name:
        name = profile.get("name")
    if not name and account.master_record:
        name = account.master_record.full_name
    if not name:
        name = account.user.email.split("@")[0]

    verification_status = "verified" if account.account_status == AccountStatus.ACTIVE else "pending"
    employment_status = _normalize_employment_status(profile.get("employment_status"), fallback="unemployed")
    employment_status = _derive_employment_status_from_survey(survey_data, fallback=employment_status)
    student_identifier = profile.get("student_number")
    if not student_identifier and account.master_record_id:
        student_identifier = f"GMR-{str(account.master_record_id)[:8].upper()}"
    if not student_identifier:
        student_identifier = f"ALUM-{str(account.id)[:8].upper()}"

    skills = survey_data.get("skills") if isinstance(survey_data.get("skills"), list) else []

    updated_date = timezone.localtime(account.updated_at).date().isoformat() if account.updated_at else timezone.localdate().isoformat()

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
        "jobTitle": survey_data.get("currentJobPosition") or survey_data.get("firstJobTitle") or "",
        "company": survey_data.get("currentJobCompany") or "",
        "industry": survey_data.get("currentJobSector") or survey_data.get("firstJobSector") or "",
        "workLocation": survey_data.get("currentJobLocation") or "",
        "unemploymentReason": survey_data.get("unemploymentReason") or "",
        "dateUpdated": updated_date,
        "biometricCaptured": bool(account.face_photo_url),
        "biometricDate": timezone.localdate().isoformat() if account.face_photo_url else None,
        "facePhotoUrl": account.face_photo_url,
        "accountStatus": account.account_status,
        "surveyData": survey_data,
        "skills": skills,
    }


def _admin_alumni_payload(account: AlumniAccount) -> dict:
    template = _safe_json_loads(account.biometric_template)
    profile = template.get("profile", {}) if isinstance(template, dict) else {}
    survey_data_blob = profile.get("survey_data", {}) if isinstance(profile, dict) else {}
    if not isinstance(survey_data_blob, dict):
        survey_data_blob = {}
    # Tables are now the source of truth — overlay them on the legacy blob.
    survey_data = _merge_survey_view(survey_data_blob, account)
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
    if not primary_face_url:
        try:
            face_scan_obj = (
                account.face_scans
                .filter(scan_type="face_front")
                .order_by("-captured_at")
                .first()
            )
            if face_scan_obj:
                primary_face_url = face_scan_obj.url
        except Exception:
            pass
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

    employment_status = _normalize_employment_status(profile.get("employment_status"), fallback="unemployed")
    employment_status = _derive_employment_status_from_survey(survey_data, fallback=employment_status)
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

    # Prefer the WorkAddress lat/lng (entered/saved per Part VII of the survey)
    # over the GPS capture meta from registration.
    addr_row = _first_prefetched(account, "_prefetched_addr")
    if addr_row is None:
        try:
            addr_row = account.work_addresses.filter(is_current=True).order_by("-created_at").first()
        except Exception:
            addr_row = None
    if addr_row is not None:
        if addr_row.latitude is not None:
            lat = addr_row.latitude
        if addr_row.longitude is not None:
            lng = addr_row.longitude

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
        "workCity": addr_row.city_municipality if addr_row is not None else "",
        "unemploymentReason": survey_data.get("unemploymentReason") or "",
        "dateUpdated": timezone.localtime(account.updated_at).date().isoformat() if account.updated_at else timezone.localdate().isoformat(),
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
        "industry": account.industry,
        "contact": account.contact_name,
        "position": account.contact_position,
        "email": account.company_email,
        "credentialEmail": account.company_email,
        "phone": account.company_phone,
        "website": account.company_website,
        "address": account.company_address,
        "status": status_label,
        "accountStatus": status_value,
        "date": account.created_at.date().isoformat(),
        "dateUpdated": account.updated_at.date().isoformat(),
    }


def _generate_employer_access_token(user_id: str) -> str:
    """Generate a signed access token for employer authentication."""
    payload = {"uid": str(user_id)}
    return signing.dumps(
        payload,
        salt=_EMPLOYER_TOKEN_SALT,
        compress=True,
    )


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


def _admin_credential_payload(cred: AdminCredential) -> dict:
    return {
        "id": str(cred.id),
        "user_id": str(cred.user_id),
        "email": cred.admin_email,
        "is_active": cred.is_active,
        "created_at": cred.created_at.isoformat(),
        "updated_at": cred.updated_at.isoformat(),
    }


def _normalize_admin_email(raw: object) -> str:
    if not isinstance(raw, str):
        return ""
    return raw.strip().lower()


class AdminListCreateView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        creds = AdminCredential.objects.select_related("user").order_by("created_at")
        return Response(
            [_admin_credential_payload(c) for c in creds],
            status=status.HTTP_200_OK,
        )

    def post(self, request):
        email = _normalize_admin_email(request.data.get("email"))
        password = request.data.get("password") or ""
        is_active_raw = request.data.get("is_active", True)
        is_active = bool(is_active_raw) if not isinstance(is_active_raw, str) else is_active_raw.lower() != "false"

        if not email or not password:
            return Response(
                {"detail": "Email and password are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            validate_email(email)
        except DjangoValidationError:
            return Response(
                {"detail": "Email is not valid."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(password) < 8:
            return Response(
                {"detail": "Password must be at least 8 characters."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if User.objects.filter(email__iexact=email).exists():
            return Response(
                {"detail": "An account with this email already exists."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if AdminCredential.objects.filter(admin_email__iexact=email).exists():
            return Response(
                {"detail": "An admin with this email already exists."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            with transaction.atomic():
                user = User(email=email, role=User.Role.ADMIN, is_staff=True)
                user.set_password(password)
                user.save()
                cred = AdminCredential.objects.create(
                    user=user,
                    admin_email=email,
                    is_active=is_active,
                )
        except (DatabaseError, OperationalError) as exc:
            logger.exception("Failed to create admin: %s", exc)
            return Response(
                {"detail": "Could not create admin. Please try again."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(_admin_credential_payload(cred), status=status.HTTP_201_CREATED)


class AdminDetailView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def _get_credential(self, admin_id):
        return (
            AdminCredential.objects.select_related("user")
            .filter(id=admin_id)
            .first()
        )

    def patch(self, request, admin_id):
        cred = self._get_credential(admin_id)
        if not cred:
            return Response(
                {"detail": "Admin not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        new_email = request.data.get("email", None)
        new_password = request.data.get("password", None)
        new_is_active = request.data.get("is_active", None)

        try:
            with transaction.atomic():
                if new_email is not None:
                    normalized = _normalize_admin_email(new_email)
                    if not normalized:
                        return Response(
                            {"detail": "Email cannot be empty."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    try:
                        validate_email(normalized)
                    except DjangoValidationError:
                        return Response(
                            {"detail": "Email is not valid."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    if (
                        User.objects.filter(email__iexact=normalized)
                        .exclude(pk=cred.user_id)
                        .exists()
                    ):
                        return Response(
                            {"detail": "Another account already uses this email."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    if (
                        AdminCredential.objects.filter(admin_email__iexact=normalized)
                        .exclude(pk=cred.id)
                        .exists()
                    ):
                        return Response(
                            {"detail": "Another admin already uses this email."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    cred.admin_email = normalized
                    cred.user.email = normalized
                    cred.user.save(update_fields=["email"])

                if new_password is not None:
                    if not isinstance(new_password, str) or len(new_password) < 8:
                        return Response(
                            {"detail": "Password must be at least 8 characters."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    cred.user.set_password(new_password)
                    cred.user.save(update_fields=["password"])

                if new_is_active is not None:
                    cred.is_active = bool(new_is_active)

                cred.save()
        except (DatabaseError, OperationalError) as exc:
            logger.exception("Failed to update admin %s: %s", admin_id, exc)
            return Response(
                {"detail": "Could not update admin. Please try again."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        cred.refresh_from_db()
        return Response(_admin_credential_payload(cred), status=status.HTTP_200_OK)

    def delete(self, request, admin_id):
        # TODO: backend self-delete check once admin auth is per-request.
        cred = self._get_credential(admin_id)
        if not cred:
            return Response(
                {"detail": "Admin not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        cred.user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def _extract_alumni_profile_data(survey_data: dict, personal_data: dict) -> dict:
    """
    Extract fields for AlumniProfile from survey_data + personal form data.

    Maps:
    - Personal info (request.data) → AlumniProfile fields
    - Academic info (survey_data) → AlumniProfile fields
    - Pre-employment info (survey_data) → AlumniProfile fields

    Returns dict ready for AlumniProfile.objects.create(**dict)
    """
    return {
        # Personal info (from form, not survey)
        "first_name": personal_data.get("first_name", "").strip(),
        "middle_name": personal_data.get("middle_name", "").strip(),
        "last_name": personal_data.get("family_name", "").strip(),
        "gender": personal_data.get("gender", ""),
        "birth_date": personal_data.get("birth_date", ""),
        "civil_status": personal_data.get("civil_status", ""),
        "mobile": personal_data.get("mobile", ""),
        "facebook_url": personal_data.get("facebook_url", ""),
        "city": personal_data.get("city", ""),
        "province": personal_data.get("province", ""),

        # Academic info (from form, not survey)
        "graduation_date": personal_data.get("graduation_date", ""),
        "graduation_year": personal_data.get("graduation_year"),
        "scholarship": personal_data.get("scholarship", ""),
        "highest_attainment": personal_data.get("highest_attainment", ""),
        "graduate_school": personal_data.get("graduate_school", ""),
        "prof_eligibility": personal_data.get("prof_eligibility", ""),
        "prof_eligibility_other": personal_data.get("prof_eligibility_other", ""),

        # Academic Profile (from survey_data - Section 3)
        "general_average_range": survey_data.get("general_average_range"),
        "academic_honors": survey_data.get("academic_honors"),
        "prior_work_experience": survey_data.get("prior_work_experience", False),
        "ojt_relevance": survey_data.get("ojt_relevance"),
        "has_portfolio": survey_data.get("has_portfolio", False),
        "english_proficiency": survey_data.get("english_proficiency"),

        # Skill counts (denormalized for ML regression model)
        "technical_skill_count": len(survey_data.get("technical_skills", [])),
        "soft_skill_count": len(survey_data.get("soft_skills", [])),
        "professional_certifications": survey_data.get("professional_certifications", []),
    }


def _extract_employment_profile_data(survey_data: dict) -> dict:
    """
    Extract fields for EmploymentProfile from survey_data.

    Maps employment survey sections (5-7):
    - Employment status
    - First job details (sector, title, BSIS-related, source, applications)
    - Current job details (sector, title, company, BSIS-related)

    Returns dict ready for EmploymentProfile.objects.create(**dict)
    """
    return {
        # Employment Status (Section 5)
        "employment_status": survey_data.get("employment_status"),

        # First Job Details (Section 6)
        "time_to_hire_raw": survey_data.get("time_to_hire_raw"),
        "time_to_hire_months": survey_data.get("time_to_hire_months"),
        "first_job_sector": survey_data.get("first_job_sector"),
        "first_job_status": survey_data.get("first_job_status"),
        "first_job_title": survey_data.get("first_job_title"),
        "first_job_related_to_bsis": survey_data.get("first_job_related_to_bsis"),
        "first_job_unrelated_reason": survey_data.get("first_job_unrelated_reason"),
        "first_job_duration_months": survey_data.get("first_job_duration_months"),
        "first_job_applications_count": survey_data.get("first_job_applications_count"),
        "first_job_source": survey_data.get("first_job_source"),

        # Current Job Details (Section 7)
        "current_job_sector": survey_data.get("current_job_sector"),
        "current_job_title": survey_data.get("current_job_title"),
        "current_job_company": survey_data.get("current_job_company"),
        "current_job_related_to_bsis": survey_data.get("current_job_related_to_bsis"),
        "location_type": survey_data.get("location_type"),

        # Completion status
        "survey_completion_status": "completed" if survey_data else "pending",
    }


def _extract_work_address_data(survey_data: dict) -> dict:
    """
    Extract fields for WorkAddress from survey_data.

    Maps work location data:
    - Street address, barangay, city, province, region, country, zip
    - Latitude/longitude for mapping

    Returns dict ready for WorkAddress.objects.create(**dict)
    """
    return {
        "street_address": survey_data.get("street_address", "").strip(),
        "barangay": survey_data.get("barangay", "").strip(),
        "city_municipality": survey_data.get("city_municipality", "").strip(),
        "province": survey_data.get("province", "").strip(),
        "region": survey_data.get("region"),
        "zip_code": survey_data.get("zip_code", "").strip(),
        "country": survey_data.get("country", "Philippines"),
        "latitude": survey_data.get("latitude"),
        "longitude": survey_data.get("longitude"),
    }


def _create_alumni_skills(alumni_account, survey_data: dict) -> int:
    """
    Create AlumniSkill entries from technical_skills[] and soft_skills[].

    Process:
    1. Extract technical_skills and soft_skills arrays from survey_data
    2. For each skill name:
       a. Get or create Skill record (lookup by name)
       b. Get or create SkillCategory ("Technical" or "Soft")
       c. Create AlumniSkill entry linking alumni → skill

    Returns count of newly created AlumniSkill entries
    """
    technical_skills = survey_data.get("technical_skills", [])
    soft_skills = survey_data.get("soft_skills", [])

    # Default proficiency for registration submissions
    default_proficiency = AlumniSkill.Proficiency.INTERMEDIATE

    all_skills = [
        (skill_name, "technical", default_proficiency)
        for skill_name in technical_skills
    ] + [
        (skill_name, "soft", default_proficiency)
        for skill_name in soft_skills
    ]

    created_count = 0
    for skill_name, skill_type, proficiency in all_skills:
        if not skill_name or not skill_name.strip():
            continue

        # Get or create SkillCategory
        category_name = "Technical" if skill_type == "technical" else "Soft"
        category, _ = SkillCategory.objects.get_or_create(name=category_name)

        # Get or create Skill record
        skill_obj, _ = Skill.objects.get_or_create(
            name=skill_name.strip(),
            defaults={"category": category}
        )

        # Create AlumniSkill entry (ignore duplicates)
        _, created = AlumniSkill.objects.get_or_create(
            alumni=alumni_account,
            skill=skill_obj,
            defaults={"proficiency_level": proficiency}
        )
        if created:
            created_count += 1

    return created_count


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
            family_name=family_name,
            first_name=first_name,
            graduation_year=graduation_year,
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

        normalized_employment_status = _normalize_employment_status(employment_status)
        normalized_employment_status = _derive_employment_status_from_survey(
            survey_data,
            fallback=normalized_employment_status,
        )

        profile_data = {
            "name": profile_name,
            "graduation_year": graduation_year or (master_record.batch_year if master_record else date.today().year),
            "employment_status": normalized_employment_status,
            "survey_data": survey_data,
        }

        capture_meta = {
            "captured_at": request.data.get("capture_time") or timezone.now().isoformat(),
            "gps": {
                "lat": request.data.get("gps_lat"),
                "lng": request.data.get("gps_lng"),
            },
        }

        face_descriptor = _parse_face_descriptor(request.data.get("face_descriptor"))
        face_descriptor_samples = _parse_face_descriptor_samples(request.data.get("face_descriptor_samples"))
        if not face_descriptor and face_descriptor_samples:
            face_descriptor = _average_face_descriptors(face_descriptor_samples)
        if face_descriptor and not face_descriptor_samples:
            face_descriptor_samples = [face_descriptor]

        with transaction.atomic():
            # 1. Create User
            user = User.objects.create_user(
                email=email,
                password=password,
                role=User.Role.ALUMNI,
            )

            # 2. Create AlumniAccount (simplified biometric_template - only biometric data, no survey)
            match_status = AlumniAccount.MatchStatus.MATCHED if master_record else AlumniAccount.MatchStatus.UNMATCHED
            alumni_account = AlumniAccount.objects.create(
                user=user,
                master_record=master_record,
                match_status=match_status,
                matched_at=timezone.now() if master_record else None,
                face_photo_url=face_scan_urls["face_front"],
                biometric_template=json.dumps({
                    # Only biometric data, NOT survey_data
                    "registration_face_scans": face_scan_urls,
                    "capture_meta": capture_meta,
                    "face_descriptor": face_descriptor,
                    "face_descriptor_samples": face_descriptor_samples,
                }),
                account_status=AccountStatus.PENDING,
            )

            # 2b. Create FaceScan DB records for all three registration angles
            _captured_at = timezone.now()
            for _scan_key in ["face_front", "face_left", "face_right"]:
                _url = face_scan_urls.get(_scan_key)
                if _url:
                    FaceScan.objects.create(
                        alumni=alumni_account,
                        scan_type=_scan_key,
                        url=_url,
                        captured_at=_captured_at,
                    )

            # 3. Create AlumniProfile (personal + academic + pre-employment info)
            profile_dict = _extract_alumni_profile_data(survey_data, request.data)
            profile = AlumniProfile.objects.create(
                alumni=alumni_account,
                **profile_dict
            )

            # 4. Create EmploymentProfile (if survey data submitted)
            employment_profile = None
            if survey_data:
                emp_dict = _extract_employment_profile_data(survey_data)
                employment_profile = EmploymentProfile.objects.create(
                    alumni=alumni_account,
                    **emp_dict
                )

            # 5. Create WorkAddress (if employment profile exists and address fields present)
            if employment_profile and any([survey_data.get("city_municipality"), survey_data.get("region")]):
                work_addr_dict = _extract_work_address_data(survey_data)
                WorkAddress.objects.create(
                    alumni=alumni_account,
                    employment_profile=employment_profile,
                    **work_addr_dict
                )

            # 6. Create AlumniSkill entries (if technical or soft skills submitted)
            if survey_data and (survey_data.get("technical_skills") or survey_data.get("soft_skills")):
                _create_alumni_skills(alumni_account, survey_data)

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
        company_address = (request.data.get("address") or request.data.get("company_address") or "").strip()
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
                industry=industry,
                contact_name=contact_name,
                contact_position=position,
                company_website=website,
                company_phone=phone,
                company_address=company_address,
                account_status=AccountStatus.PENDING,
            )

        access_token = _generate_employer_access_token(user.id)

        return Response(
            {
                "message": "Employer registration submitted. Account is pending admin approval.",
                "accessToken": access_token,
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

        access_token = _generate_employer_access_token(user.id)

        return Response(
            {
                "message": "Employer login successful.",
                "accessToken": access_token,
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

        reference_scan_urls = _extract_registration_scan_urls(alumni_account)
        reference_descriptors = _resolve_reference_descriptors(alumni_account)
        if not reference_scan_urls and not reference_descriptors:
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

        login_descriptor = _parse_face_descriptor(request.data.get("face_descriptor"))
        descriptor_distance = None
        similarity_score = 0.0

        if login_descriptor and reference_descriptors:
            descriptor_match, descriptor_distance, descriptor_similarity = _verify_descriptor_match(
                login_descriptor=login_descriptor,
                reference_descriptors=reference_descriptors,
            )
            if not descriptor_match:
                return Response(
                    {
                        "detail": "Face verification failed. The captured face did not match your registered biometrics.",
                        "descriptorDistance": round(descriptor_distance, 4),
                        "similarityScore": round(descriptor_similarity, 4),
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

            similarity_score = descriptor_similarity
        else:
            if not reference_scan_urls:
                return Response(
                    {"detail": "No enrolled biometric photo reference is available for fallback verification."},
                    status=status.HTTP_403_FORBIDDEN,
                )

            is_match, verification_message, similarity_score = _verify_login_face(
                reference_urls=reference_scan_urls,
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
                "descriptor_distance": round(descriptor_distance, 4) if descriptor_distance is not None else None,
            }
        )
        login_audit = login_audit[-5:]

        if not isinstance(template, dict):
            template = {}
        template["login_audit"] = login_audit
        template["last_login_scan_url"] = login_scan_url
        if login_descriptor and not reference_descriptors:
            template["face_descriptor"] = login_descriptor
            template["face_descriptor_samples"] = [login_descriptor]

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


class AlumniEmploymentUpdateView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, alumni_id):
        alumni_account = AlumniAccount.objects.select_related("user", "master_record").filter(id=alumni_id).first()
        if not alumni_account:
            return Response(
                {"detail": "Graduate account was not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        template = _safe_json_loads(alumni_account.biometric_template)
        if not isinstance(template, dict):
            template = {}

        profile = template.get("profile", {})
        if not isinstance(profile, dict):
            profile = {}

        existing_survey_data = profile.get("survey_data", {})
        if not isinstance(existing_survey_data, dict):
            existing_survey_data = {}

        incoming_survey_data = request.data.get("survey_data")
        if isinstance(incoming_survey_data, str):
            incoming_survey_data = _safe_json_loads(incoming_survey_data)
        if incoming_survey_data is None:
            incoming_survey_data = {}
        if not isinstance(incoming_survey_data, dict):
            return Response(
                {"detail": "survey_data must be a JSON object."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        merged_survey_data = {
            **existing_survey_data,
            **incoming_survey_data,
        }

        stored_status = _normalize_employment_status(profile.get("employment_status"), fallback="unemployed")
        incoming_status = request.data.get("employment_status")
        if incoming_status not in (None, ""):
            stored_status = _normalize_employment_status(incoming_status, fallback=stored_status)

        normalized_status = _derive_employment_status_from_survey(
            merged_survey_data,
            fallback=stored_status,
        )

        profile["employment_status"] = normalized_status
        profile["survey_data"] = merged_survey_data
        template["profile"] = profile

        alumni_account.biometric_template = json.dumps(template)
        alumni_account.save(update_fields=["biometric_template", "updated_at"])

        # Mirror the blob into the normalized tables so analytics, reports,
        # and admin dashboards can query them directly. JSON blob remains for
        # backwards compatibility but the tables are the source of truth.
        try:
            from .survey_translator import apply_survey_data_to_normalized_tables
            apply_survey_data_to_normalized_tables(alumni_account, merged_survey_data)
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception(
                "survey_translator failed for alumni %s: %s", alumni_account.id, exc
            )

        return Response(
            {
                "message": "Graduate employment details updated.",
                "alumni": _session_payload_from_alumni(alumni_account),
            },
            status=status.HTTP_200_OK,
        )

    def patch(self, request, alumni_id):
        return self.post(request, alumni_id)


class EmployerAccountStatusView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, employer_id):
        employer_account = EmployerAccount.objects.select_related("user").filter(id=employer_id).first()
        if not employer_account:
            return Response(
                {"detail": "Employer account was not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(
            {
                "employer": _employer_request_payload(employer_account),
            },
            status=status.HTTP_200_OK,
        )


class PendingAlumniListView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        try:
            pending_accounts = _alumni_dashboard_queryset(
                AlumniAccount.objects.filter(account_status=AccountStatus.PENDING)
            ).order_by("-created_at")
            results = [_pending_alumni_payload(account) for account in pending_accounts]
        except (OperationalError, DatabaseError):
            return _temporary_admin_data_unavailable_response("Pending alumni")

        return Response(
            {
                "count": len(results),
                "results": results,
            },
            status=status.HTTP_200_OK,
        )


class VerifiedAlumniListView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        try:
            verified_accounts = _alumni_dashboard_queryset(
                AlumniAccount.objects.filter(account_status=AccountStatus.ACTIVE)
            ).order_by("-updated_at")
            results = [_admin_alumni_payload(account) for account in verified_accounts]
        except (OperationalError, DatabaseError):
            return _temporary_admin_data_unavailable_response("Verified alumni")

        return Response(
            {
                "count": len(results),
                "results": results,
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
        try:
            employer_accounts = EmployerAccount.objects.select_related("user").order_by("-created_at")
            results = [_employer_request_payload(account) for account in employer_accounts]
        except (OperationalError, DatabaseError):
            return _temporary_admin_data_unavailable_response("Employer request")

        return Response(
            {
                "count": len(results),
                "results": results,
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


class MasterlistCheckView(APIView):
    """Public: real-time check whether a name + graduation year exists in the masterlist."""
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        first_name = (request.query_params.get("first_name") or "").strip()
        last_name  = (request.query_params.get("last_name")  or "").strip()
        grad_year  = request.query_params.get("graduation_year")
        if not first_name or not last_name:
            return Response({"matched": False})
        year = int(grad_year) if grad_year and str(grad_year).isdigit() else None
        record = _find_master_record(last_name, first_name, year)
        return Response({
            "matched": record is not None,
            "name": record.full_name if record else None,
        })


class MasterlistBulkCreateView(APIView):
    """Admin-only: bulk create GraduateMasterRecord entries from the batch-upload UI."""
    authentication_classes = []
    permission_classes = [AllowAny]  # TODO: restrict to admin once token auth is wired

    def post(self, request):
        entries = request.data.get("entries", [])
        if not isinstance(entries, list) or not entries:
            return Response({"detail": "entries list is required."}, status=status.HTTP_400_BAD_REQUEST)
        created = []
        for entry in entries:
            name = (entry.get("name") or "").strip()
            year = entry.get("graduation_year") or entry.get("graduationYear")
            if not name or not year:
                continue
            try:
                year_int = int(year)
            except (TypeError, ValueError):
                continue
            parts = name.split()
            last = parts[-1] if len(parts) > 1 else name
            obj, was_created = GraduateMasterRecord.objects.get_or_create(
                full_name__iexact=name,
                batch_year=year_int,
                defaults={"full_name": name, "last_name": last, "batch_year": year_int},
            )
            if was_created:
                created.append({"id": str(obj.id), "name": obj.full_name, "batch_year": obj.batch_year})
        return Response({"created": len(created), "entries": created}, status=status.HTTP_201_CREATED)
