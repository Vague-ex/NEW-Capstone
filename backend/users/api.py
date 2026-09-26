from decimal import Decimal
import json
import logging
import os
import re
from datetime import date
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import urlopen

from django.core import signing
from django.core.signing import BadSignature, SignatureExpired
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import DatabaseError, OperationalError, transaction
from django.db.models import JSONField, Prefetch, Q
from django.db.models.expressions import RawSQL
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .auth import (
    ADMIN_TOKEN_TTL_SECONDS as _ADMIN_TOKEN_TTL_SECONDS,
    ALUMNI_TOKEN_TTL_SECONDS as _ALUMNI_TOKEN_TTL_SECONDS,
    generate_admin_access_token as _generate_admin_access_token,
    generate_alumni_access_token as _generate_alumni_access_token,
    require_admin as _require_admin,
    require_alumni as _require_alumni,
)
from .names import derive_last_name, names_match
from .retracking import (
    RETRACKING_THRESHOLD_DAYS, employment_snapshot, graduate_first_name, last_retraced_at as _last_retraced_at,
    log_retracking_event, mark_retraced, needs_retracking, retracking_status, send_retracking_email,
)
from .models import (
    AccountStatus, AdminCredential, AlumniAccount, AlumniProfile,
    EmployerAccount, FaceScan, GraduateMasterRecord, LoginAudit, User,
)
from .supabase_storage import SupabaseStorageError, upload_image_bytes
from .throttling import (
    ip_is_locked_out as throttle_ip_is_locked_out,
    is_locked_out as throttle_is_locked_out,
    make_identifier as throttle_identifier,
    register_failed_attempt as throttle_register_fail,
    register_ip_failure as throttle_ip_fail,
    reset_attempts as throttle_reset,
)
from tracer.text_quality import first_link_field
from tracer.validators import graduation_date_problem, validate_registration_payload
from tracer.models import (
    AlumniSkill, CompetencyProfile, EmploymentProfile, EmploymentRecord,
    Skill, SkillCategory, VerificationDecision, VerificationToken, WorkAddress,
)

try:
    import cv2
except Exception:  # pragma: no cover - optional dependency guard
    cv2 = None

try:
    import numpy as np
except Exception:  # pragma: no cover - optional dependency guard
    np = None

FACE_MATCH_THRESHOLD = 0.42
MIN_FACE_SIZE_PX = 72
MIN_FACE_AREA_RATIO = 0.045
FACE_DESCRIPTOR_LENGTH = 128

# Display-only mapping from euclidean distance to a 0..1 "similarity" shown in
# API responses. It does NOT decide a match — the distance threshold below does.
FACE_DESCRIPTOR_SIMILARITY_SCALE = 1.5

# face-api.js FaceRecognitionNet emits 128-d embeddings where euclidean distance
# is the identity metric. Reference points from dlib/face-api:
#
#   same person, good capture        0.30 - 0.45
#   same person, poor light/angle    0.45 - 0.60
#   DIFFERENT people                 0.60 - 1.00+
#   face-api.js documented default   0.60
#
# This was previously derived as (1 - 0.42) * 1.5 = 0.87, which sits well inside
# the different-person band and let unrelated faces authenticate. 0.55 keeps a
# margin below the 0.60 crossover; raise it toward 0.60 if legitimate users are
# being rejected, but never past it.
FACE_DESCRIPTOR_DISTANCE_THRESHOLD = float(
    os.getenv("FACE_DESCRIPTOR_DISTANCE_THRESHOLD", "0.55")
)
FACE_DESCRIPTOR_MIN_SIMILARITY = max(
    0.0, 1.0 - (FACE_DESCRIPTOR_DISTANCE_THRESHOLD / FACE_DESCRIPTOR_SIMILARITY_SCALE)
)

# Employer authentication token constants

from . import face_engines
from .face_engines import get_engine, resolve_stored_engine

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

def _safe_int(value):
    """Coerce form values to int; return None for empty / non-numeric input."""
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None

def _mark_logged_in(user) -> None:
    """
    Stamp User.last_login on a successful sign-in.

    These views authenticate with `_authenticate_by_email` rather than
    `django.contrib.auth.login()`, so the `user_logged_in` signal that normally
    maintains this column never fires — it stayed NULL for every account and
    every role. Best-effort: a failed stamp must never block a valid login.
    """
    if user is None:
        return
    try:
        user.last_login = timezone.now()
        user.save(update_fields=["last_login"])
    except (OperationalError, DatabaseError, AttributeError):  # pragma: no cover
        # AttributeError guards callers holding a stand-in rather than a real
        # User. Stamping the audit column is best-effort and must never be the
        # reason a valid sign-in fails.
        pass

def _as_bool(value) -> bool:
    """
    Coerce a multipart form value to a bool.

    Consent fields arrive as the strings "true"/"false" over FormData, where a
    naive truth test would read "false" as True. Anything not explicitly
    affirmative is treated as no consent — the safe default for a privacy opt-in.
    """
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in ("true", "1", "yes", "on")

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
        # Fine-grained survey values (underscores already converted to hyphens).
        "employed-full-time": "employed",
        "employed full-time": "employed",
        "employed-part-time": "employed",
        "employed part-time": "employed",
        "no": "unemployed",
        "unemployed": "unemployed",
        "not employed": "unemployed",
        "never employed": "unemployed",
        "never-employed": "unemployed",
        "seeking": "unemployed",
        "not-seeking": "unemployed",
        "not seeking": "unemployed",
        "self-employed": "self-employed",
        "self employed": "self-employed",
        "self-employed-freelance": "self-employed",
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

    # The normalized-table overlay writes "employment_status" (snake_case);
    q1_status = survey_data.get("employment_status") or survey_data.get("employmentStatus")
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

def _authenticate_by_email_specific(email: str, password: str) -> tuple[User | None, str | None]:
    """Like _authenticate_by_email but returns a specific error string on failure."""
    if not email or not password:
        return None, "Email and password are required."
    # One message for every failure, so the login form cannot be used to
    # find out which emails have accounts.
    user = User.objects.filter(email__iexact=email.strip()).first()
    if not user:
        # Hash anyway, as Django's ModelBackend does, so a missing account
        # does not answer measurably faster than a wrong password.
        User().set_password(password)
        return None, "Invalid email or password."
    if not user.is_active or not user.check_password(password):
        return None, "Invalid email or password."
    return user, None

def _find_master_record(
    family_name: str,
    first_name: str,
    graduation_year: int | None = None,
) -> GraduateMasterRecord | None:
    if not family_name or not first_name:
        return None

    # Compared in Python rather than with iexact/icontains: accents, stray
    # punctuation or a badly derived stored last_name would otherwise leave a
    # graduate who IS on the masterlist unmatched. A batch is a few hundred
    # rows, so scanning it is cheap.
    qs = GraduateMasterRecord.objects.filter(is_active=True)
    if graduation_year:
        qs = qs.filter(batch_year=graduation_year)
    for record in qs.order_by("created_at").only("id", "full_name", "last_name", "batch_year"):
        if names_match(record.full_name, record.last_name, family_name, first_name):
            return record
    return None


def _refresh_master_match(account: AlumniAccount, *, relink: bool = False) -> bool:
    """Re-run the masterlist lookup for an existing account.

    Registration only matches once, so an account stays "unmatched" when its
    masterlist row is uploaded later or its name/batch is corrected afterwards.
    Only unmatched accounts are touched unless relink is set (a name or batch
    edit), in which case a stale link is also replaced or cleared. A pending
    graduate who now matches is activated and emailed, the same as a matched
    registration, and waits in Profile Review for the admin's check. Clearing
    a link never deactivates an account. Returns True when the link changed.
    """
    if account.master_record_id and not relink:
        return False
    profile = AlumniProfile.objects.filter(alumni=account).only(
        "first_name", "last_name", "graduation_year",
    ).first()
    if not profile:
        return False
    record = _find_master_record(profile.last_name, profile.first_name, profile.graduation_year)
    if (record.id if record else None) == account.master_record_id:
        return False
    account.master_record = record
    account.match_status = (
        AlumniAccount.MatchStatus.MATCHED if record else AlumniAccount.MatchStatus.UNMATCHED
    )
    account.matched_at = timezone.now() if record else None
    update_fields = ["master_record", "match_status", "matched_at", "updated_at"]
    activated = bool(record) and account.account_status == AccountStatus.PENDING
    if activated:
        account.account_status = AccountStatus.ACTIVE
        update_fields.append("account_status")
    account.save(update_fields=update_fields)
    if activated:
        _send_approval_email(
            to_email=account.user.email if account.user else "",
            recipient_name=" ".join(
                part.strip() for part in (profile.first_name, profile.last_name) if part and part.strip()
            ),
            is_employer=False,
        )
    return True

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

def _parse_face_descriptor(raw_value, expected_length: int | None = None) -> list[float] | None:
    # Length belongs to the active engine: face-api emits 128 floats, ArcFace
    # 512. Hardcoding 128 would silently reject every valid embedding the
    # moment the engine changed.
    expected_length = expected_length if expected_length is not None else get_engine().dimensions
    # Accept an already-decoded list as well as a JSON string. Descriptors
    # arrive as JSON on the request, but come back as real lists once
    # biometric_template has been decoded — and _safe_json_loads returns {} for
    # a list, so routing everything through it silently rejected every stored
    # descriptor and disabled descriptor matching for all accounts.
    payload = raw_value if isinstance(raw_value, list) else _safe_json_loads(raw_value)
    if not isinstance(payload, list):
        return None

    parsed: list[float] = []
    for item in payload:
        try:
            parsed.append(float(item))
        except (TypeError, ValueError):
            return None

    if len(parsed) != expected_length:
        return None
    return parsed

def _parse_face_descriptor_samples(raw_value, expected_length: int | None = None) -> list[list[float]]:
    expected_length = expected_length if expected_length is not None else get_engine().dimensions
    # Same already-decoded-list handling as _parse_face_descriptor above.
    payload = raw_value if isinstance(raw_value, list) else _safe_json_loads(raw_value)
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

        if invalid_sample or len(parsed_sample) != expected_length:
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

def _stored_template_engine(account: AlumniAccount) -> str:
    """Which engine produced this account's enrolled template.

    Rows enrolled before the engine seam existed carry no marker, and every one
    of those was face-api, so an absent value means faceapi rather than unknown.
    """
    template = _safe_json_loads(account.biometric_template)
    if not isinstance(template, dict):
        return resolve_stored_engine(None)
    return resolve_stored_engine(template.get("engine"))


def _has_face_enrolment(account: AlumniAccount) -> bool:
    """
    Does this account hold a face template at all, under ANY engine?

    Distinct from _resolve_reference_descriptors, which answers the narrower
    question of whether there is one usable by the ACTIVE engine. The
    difference decides what login should do: an account with no template needs
    to enrol, while one holding another engine's template needs to re-enrol.
    Both end at the same screen, but conflating them with "no reference
    available" produced a dead end the graduate could not act on.
    """
    template = _safe_json_loads(account.biometric_template)
    if not isinstance(template, dict):
        return False

    engines = template.get("engines")
    if isinstance(engines, dict):
        for stored in engines.values():
            if isinstance(stored, dict) and (
                stored.get("face_descriptor") or stored.get("face_descriptor_samples")
            ):
                return True

    # Legacy flat shape, which is how every pre-seam row is stored.
    return bool(
        template.get("face_descriptor") or template.get("face_descriptor_samples")
    )


def _resolve_reference_descriptors(account: AlumniAccount) -> list[list[float]]:
    template = _safe_json_loads(account.biometric_template)
    if not isinstance(template, dict):
        return []

    # Refuse to compare across engines. A 128-d face-api vector measured against
    # a 512-d ArcFace probe does not yield a wrong distance, it yields a
    # meaningless one that the threshold then accepts or rejects at random.
    # Returning no references fails the login closed, which is the safe outcome;
    # the caller reports it using _stored_template_engine.
    active = get_engine()
    stored_engine = resolve_stored_engine(template.get("engine"))
    if stored_engine != active.name:
        logger.warning(
            "Face template engine mismatch for alumni %s: stored=%s active=%s. "
            "The account must re-enrol before it can authenticate.",
            account.id,
            stored_engine,
            active.name,
        )
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

# biometric_template minus the face descriptors. Registration and login save
# the template as a JSON string inside the jsonb column, so it is parsed first;
# anything unparseable reads as {} instead of failing the whole list.
_LIST_TEMPLATE = RawSQL(
    """(SELECT CASE WHEN jsonb_typeof(t) = 'object'
                    THEN t - 'face_descriptor_samples' - 'face_descriptor' - 'engines'
                    ELSE '{}'::jsonb END
        FROM (SELECT CASE WHEN jsonb_typeof(b) = 'string' AND pg_input_is_valid(b #>> '{}', 'jsonb')
                          THEN (b #>> '{}')::jsonb ELSE b END AS t
              FROM (SELECT "users_alumni_accounts"."biometric_template" AS b) AS raw) AS parsed)""",
    [],
    output_field=JSONField(),
)


def _template_of(account) -> dict:
    """The account's biometric_template: the trimmed copy on list querysets,
    otherwise the full column."""
    trimmed = getattr(account, "_list_template", None)
    return _safe_json_loads(trimmed if trimmed is not None else account.biometric_template)


def _alumni_dashboard_queryset(qs):
    """Apply the prefetches needed by ``_admin_alumni_payload`` /
    ``_session_payload_from_alumni`` so the normalized-table reads collapse
    from N+1 queries (one per related table per alumni) to a constant 4
    additional queries regardless of result-set size.
    """
    from tracer.models import AlumniSkill, CompetencyProfile, EmploymentProfile, WorkAddress
    from .models import FaceScan

    # The face descriptors are ~95% of biometric_template (40-80 KB per
    # graduate) and no list page uses them, yet every load of these lists used
    # to download them for every graduate: Supabase counts that as egress. The
    # column is deferred and a copy without them is read via _template_of().
    qs = qs.defer("biometric_template").annotate(_list_template=_LIST_TEMPLATE)
    return qs.select_related("user", "master_record", "profile").prefetch_related(
        Prefetch(
            "skills",
            queryset=AlumniSkill.objects.select_related("skill__category"),
            to_attr="_prefetched_skills",
        ),
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
        # Front face scan for the primary-photo fallback in _admin_alumni_payload.
        # Without this, accounts whose photo URL isn't on the JSON blob (e.g. the
        # seeded samples) trigger one extra query each — an N+1 across the list.
        Prefetch(
            "face_scans",
            queryset=FaceScan.objects.filter(scan_type="face_front").order_by("-captured_at"),
            to_attr="_prefetched_scans",
        ),
    )

def _first_prefetched(account, attr):
    """Return ``account._prefetched_<attr>[0]`` if available, falling back to
    a single query when the manager wasn't prefetched."""
    cached = getattr(account, attr, None)
    if isinstance(cached, list):
        return cached[0] if cached else None
    return None

def _first_related(account, attr, query):
    """First row of a prefetched list, or ``query()`` when nothing was prefetched.

    A prefetched EMPTY list means "this graduate has none". Treating it like
    "not prefetched" re-queried once per graduate without, e.g., a work
    address: about a thousand extra Supabase round trips for 500 graduates on
    the verified list, geomap and dashboard.
    """
    cached = getattr(account, attr, None)
    if isinstance(cached, list):
        return cached[0] if cached else None
    try:
        return query()
    except Exception:
        return None

def _normalized_view_from_tables(account: AlumniAccount) -> dict:
    """Read AlumniProfile / EmploymentProfile / WorkAddress / AlumniSkill rows for
    this alumni and return values in the camelCase shape the frontend expects.
    Keys mirror the survey_data blob so callers can overlay without changing
    downstream code."""
    view: dict = {}

    # ── AlumniProfile (personal + academic) ───────────────────────────────────
    prof = None
    try:
        prof = account.profile  # select_related covers this in prefetched querysets
    except Exception:
        prof = None
    if prof is not None:
        if prof.first_name:
            view["firstName"] = prof.first_name
        if prof.middle_name:
            view["middleName"] = prof.middle_name
        if prof.last_name:
            view["familyName"] = prof.last_name
        if prof.gender:
            view["gender"] = prof.gender
        if prof.birth_date:
            view["birthDate"] = prof.birth_date
        if prof.civil_status:
            view["civilStatus"] = prof.civil_status
        if prof.mobile:
            view["mobile"] = prof.mobile
        if prof.facebook_url:
            view["facebook"] = prof.facebook_url
        if prof.city:
            view["city"] = prof.city
        if prof.province:
            view["province"] = prof.province
        if prof.graduation_date:
            view["graduationDate"] = prof.graduation_date
        if prof.graduation_year:
            view["graduationYear"] = prof.graduation_year
        if prof.scholarship:
            view["scholarship"] = prof.scholarship
        if prof.highest_attainment:
            view["highestAttainment"] = prof.highest_attainment
        if prof.graduate_school:
            view["graduateSchool"] = prof.graduate_school
        if prof.prof_eligibility:
            view["profEligibility"] = [e.strip() for e in prof.prof_eligibility.split(",") if e.strip()]
        if prof.prof_eligibility_other:
            view["profEligibilityOther"] = prof.prof_eligibility_other
        if prof.general_average_range is not None:
            view["general_average_range"] = prof.general_average_range
        if prof.academic_honors:
            view["academic_honors"] = prof.academic_honors
        if prof.prior_work_experience is not None:
            view["prior_work_experience"] = prof.prior_work_experience
        if prof.ojt_relevance:
            view["ojt_relevance"] = prof.ojt_relevance
        if prof.has_portfolio is not None:
            view["has_portfolio"] = prof.has_portfolio

    # ── EmploymentProfile ──────────────────────────────────────────────────────
    emp = _first_related(account, "_prefetched_emp", lambda: account.employment_profiles.order_by("-updated_at").first())
    if emp is not None:
        if emp.employment_status:
            view["employment_status"] = emp.employment_status
        if emp.time_to_hire_raw:
            view["timeToHire"] = emp.time_to_hire_raw
        if emp.first_job_title:
            view["firstJobTitle"] = emp.first_job_title
        if emp.first_job_company:
            view["firstJobCompany"] = emp.first_job_company
        if emp.first_job_sector:
            view["firstJobSector"] = _SECTOR_LABELS.get(emp.first_job_sector, emp.first_job_sector)
        if emp.first_job_status:
            view["firstJobStatus"] = emp.first_job_status
        if emp.first_job_related_to_bsis is True:
            view["firstJobRelated"] = "Yes"
        elif emp.first_job_related_to_bsis is False:
            view["firstJobRelated"] = "No"
        if emp.first_job_unrelated_reason:
            view["firstJobUnrelatedReason"] = emp.first_job_unrelated_reason
        if emp.first_job_duration_months is not None:
            view["jobRetention"] = str(emp.first_job_duration_months)
        if emp.first_job_applications_count is not None:
            view["jobApplications"] = str(emp.first_job_applications_count)
        if emp.first_job_source:
            view["jobSource"] = emp.first_job_source
        if emp.current_job_title:
            view["currentJobPosition"] = emp.current_job_title
        if emp.current_job_company:
            view["currentJobCompany"] = emp.current_job_company
        if emp.current_job_sector:
            view["currentJobSector"] = _SECTOR_LABELS.get(emp.current_job_sector, emp.current_job_sector)
        if emp.current_job_related_to_bsis is True:
            view["currentJobRelated"] = "Yes"
        elif emp.current_job_related_to_bsis is False:
            view["currentJobRelated"] = "No"
        if emp.location_type is not None:
            view["currentJobLocation"] = (
                "Local (Philippines)" if emp.location_type
                else "Abroad / Remote Foreign Employer"
            )

    # ── WorkAddress ───────────────────────────────────────────────────────────
    addr = _first_related(
        account, "_prefetched_addr",
        lambda: account.work_addresses.filter(is_current=True).order_by("-created_at").first(),
    )
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
        if not view.get("currentJobLocation"):
            view["currentJobLocation"] = (
                "Abroad / Remote Foreign Employer"
                if (addr.country and addr.country.lower() not in {"philippines", "ph"})
                else "Local (Philippines)"
            )

    # ── Skills: AlumniSkill table (primary) then CompetencyProfile (legacy) ──
    tech: list[str] = []
    soft: list[str] = []
    try:
        prefetched_skills = getattr(account, "_prefetched_skills", None)
        alumni_skills = (
            prefetched_skills if isinstance(prefetched_skills, list)
            else list(account.skills.select_related("skill", "skill__category").all())
        )
        # Admin categories (Web Development, Database, ...) are technical too;
        # only "Soft" is soft.
        soft = [s.skill.name for s in alumni_skills if s.skill.category and s.skill.category.name == "Soft"]
        tech = [s.skill.name for s in alumni_skills if not (s.skill.category and s.skill.category.name == "Soft")]
    except Exception:
        alumni_skills = []

    if not tech and not soft:
        comp = _first_related(
            account, "_prefetched_comp",
            lambda: account.competency_profiles.order_by("-assessment_date").first(),
        )
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

# Stored value -> the exact option label the graduate's Employment Details page
# (alumni-employment.tsx) matches its radios against. The tables hold encoded
# values (ints, booleans, enum codes), so without this the page loads blank even
# though the answers are in the database.
_ACADEMIC_HONORS_LABELS = {4: "Summa Cum Laude", 3: "Magna Cum Laude", 2: "Cum Laude", 1: "No Academic Honors"}
_OJT_RELEVANCE_LABELS = {
    3: "Yes, directly related",
    2: "Somewhat related",
    1: "Not related",
    0: "Have not secured a job yet / Not applicable",
}
_TIME_TO_HIRE_LABELS = {
    1.0: "Within 1 month",
    3.0: "1 - 3 months",
    4.5: "3 - 6 months",
    9.0: "6 months to 1 year",
    18.0: "1 - 2 years",
    30.0: "More than 2 years",
}
_JOB_STATUS_LABELS = {
    "regular": "Regular/Permanent",
    "probationary": "Probationary",
    "contractual": "Contractual/Casual/Job Order",
    "self_employed": "Self-Employed / Freelance",
}
_JOB_RETENTION_LABELS = {
    "2": "Less than 3 months",
    "4": "3 - 6 months",
    "9": "6 months to 1 year",
    "18": "1 - 2 years",
    "30": "More than 2 years",
}
_JOB_APPLICATIONS_LABELS = {
    "1": "1 - 5 applications",
    "2": "6 - 15 applications",
    "3": "16 - 30 applications",
    "4": "31+ applications",
}
_JOB_SOURCE_LABELS = {
    "online_portal": "Online Job Portal (JobStreet, LinkedIn, etc.)",
    "career_fair": "CHMSU Career Orientation / Job Fair",
    "personal_network": "Personal Network / Referral",
    "walk_in": "Company Walk-in / Direct Hire",
    "social_media": "Social media (Facebook groups, etc.)",
    "entrepreneurship": "Started own business / Freelance platform",
    "other": "Others",
}
# Registration's reason codes, mapped onto the closest edit-page option.
_UNRELATED_REASON_LABELS = {
    "higher_pay": "Salary & Benefits",
    "better_opportunity": "Career Challenge/Advancement",
    "location": "Proximity to Residence",
    "family_reasons": "Family/Peer influence",
    "career_change": "Others",
    "other": "Others",
}
_RELATED_LABELS = {"Yes": "Yes, directly related (IT/IS role)", "No": "Not related (different field)"}


def _as_form_labels(survey_data: dict, blob: dict, account: AlumniAccount) -> dict:
    """Rewrite a merged survey view into the label shape the graduate's edit
    form expects. Values that are already labels pass through unchanged.

    Only the graduate's own session payload uses this. Admin pages read the
    raw shape ('Yes'/'No', numbers, booleans) and must not change."""
    sd = dict(survey_data)

    honors = sd.get("academic_honors")
    if isinstance(honors, int) and not isinstance(honors, bool):
        sd["academic_honors"] = _ACADEMIC_HONORS_LABELS.get(honors, "")
    ojt = sd.get("ojt_relevance")
    if isinstance(ojt, int) and not isinstance(ojt, bool):
        sd["ojt_relevance"] = _OJT_RELEVANCE_LABELS.get(ojt, "")
    for key in ("prior_work_experience", "has_portfolio"):
        if isinstance(sd.get(key), bool):
            sd[key] = "Yes" if sd[key] else "No"

    tth = sd.get("timeToHire")
    if tth:
        from .survey_translator import _TIME_TO_HIRE_MONTHS, _norm
        months = _TIME_TO_HIRE_MONTHS.get(_norm(tth))
        if months in _TIME_TO_HIRE_LABELS:
            sd["timeToHire"] = _TIME_TO_HIRE_LABELS[months]

    lookups = (
        ("firstJobStatus", _JOB_STATUS_LABELS),
        ("jobRetention", _JOB_RETENTION_LABELS),
        ("jobApplications", _JOB_APPLICATIONS_LABELS),
        ("jobSource", _JOB_SOURCE_LABELS),
        ("firstJobUnrelatedReason", _UNRELATED_REASON_LABELS),
    )
    for key, labels in lookups:
        value = sd.get(key)
        if value not in (None, "") and str(value) in labels:
            sd[key] = labels[str(value)]

    # The tables store relatedness as a boolean, so "Somewhat related" comes
    # back as "Yes". Keep the graduate's original answer when it agrees.
    from .survey_translator import _related_to_bsis
    for key in ("firstJobRelated", "currentJobRelated"):
        value = sd.get(key)
        if value not in _RELATED_LABELS:
            continue
        original = blob.get(key)
        if original and _related_to_bsis(original) == (value == "Yes"):
            sd[key] = original
        else:
            sd[key] = _RELATED_LABELS[value]

    # Work address: the tables keep region/province/city as names, but the
    # form's selects need reference-table ids.
    addr = _first_related(
        account, "_prefetched_addr",
        lambda: account.work_addresses.filter(is_current=True).order_by("-created_at").first(),
    )
    if addr is not None:
        if addr.province and addr.province != "—" and not sd.get("province_address"):
            sd["province_address"] = addr.province
        if addr.latitude is not None and sd.get("work_latitude") in (None, ""):
            sd["work_latitude"] = addr.latitude
        if addr.longitude is not None and sd.get("work_longitude") in (None, ""):
            sd["work_longitude"] = addr.longitude
    if not sd.get("currentJobRegionId") and sd.get("region_address") and sd.get("region_address") != "Abroad":
        sd.update(_location_ids_for(sd.get("region_address"), sd.get("province_address"), sd.get("city_municipality")))
    return sd


def _location_ids_for(region_value, province_name, city_name) -> dict:
    """Resolve stored region/province/city names to the PSGC reference ids the
    Region -> Province -> City selects use. Missing matches are left out."""
    from django.db.models import Q
    from tracer.models import CityMunicipality, Province, Region

    ids: dict = {}
    try:
        region = (
            Region.objects.filter(is_active=True)
            .exclude(psgc_id="")
            .filter(Q(code__iexact=region_value) | Q(name__iexact=region_value) | Q(name__istartswith=f"{region_value} ("))
            .first()
        )
        if region is None:
            return ids
        ids["currentJobRegionId"] = str(region.id)

        province = None
        if province_name and province_name != "—":
            province = Province.objects.filter(region=region, name__iexact=province_name).first()
            if province:
                ids["currentJobProvinceId"] = str(province.id)

        if city_name:
            # PSGC names cities "City of X" while typed/geocoded ones say "X"
            # or "X City", so try each spelling.
            bare = re.sub(r"^city of\s+|\s+city$", "", city_name.strip(), flags=re.IGNORECASE)
            spellings = Q(name__iexact=city_name) | Q(name__iexact=f"City of {bare}") | Q(name__iexact=f"{bare} City")
            cities = CityMunicipality.objects.filter(spellings, region=region)
            # Independent cities (e.g. Davao City) sit outside their province.
            city = (cities.filter(province=province).first() if province else None) or cities.first()
            if city:
                ids["currentJobCityId"] = str(city.id)
                # The province select must hold the city's own province, or the
                # city list it loads won't contain the city.
                if city.province_id:
                    ids["currentJobProvinceId"] = str(city.province_id)
    except Exception:  # pragma: no cover - a lookup miss must never break login
        pass
    return ids

def _needs_employer_invite(account: AlumniAccount) -> bool:
    """True when the graduate has a current job at a named company but has never
    created a verification link for it. Drives the dashboard prompt that asks
    them to send their employer the link; once any token exists for the record
    (used, expired or still pending) the prompt stops. A company or title change
    makes a fresh EmploymentRecord, so a new job starts the prompt again."""
    try:
        record = (
            EmploymentRecord.objects
            .filter(alumni=account, is_current=True)
            .only("id", "employer_name_input", "employment_status", "verification_status")
            .first()
        )
        if record is None or not (record.employer_name_input or "").strip():
            return False
        if record.employment_status == EmploymentRecord.EmploymentStatus.UNEMPLOYED:
            return False
        if record.verification_status != EmploymentRecord.VerificationStatus.PENDING:
            return False
        return not VerificationToken.objects.filter(employment_record=record).exists()
    except Exception:  # pragma: no cover - defensive
        return False

def _needs_retracking(account: AlumniAccount) -> bool:
    """True when the graduate last confirmed their employment record over two years ago."""
    try:
        return needs_retracking(account)
    except Exception:  # pragma: no cover - defensive
        return False

def _admin_retracking_fields(account: AlumniAccount) -> dict:
    """Retracking badge data for the admin lists: how stale the record is and
    when the graduate was last reminded."""
    try:
        fields = retracking_status(account)
    except Exception:  # pragma: no cover - defensive
        fields = {"requiresRetracking": False, "lastRetracedAt": None, "daysSinceRetrace": None,
                  "retrackingDueAt": None, "retrackingOverdueDays": 0}
    reminded = getattr(getattr(account, "profile", None), "last_retracking_reminder_at", None)
    fields["lastRetrackingReminderAt"] = reminded.isoformat() if reminded else None
    return fields

def _to_float(value):
    """Coerce a form value to float, or None when absent / non-numeric."""
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None

def _extract_login_gps(request) -> tuple[float | None, float | None, float | None]:
    """Pull gps_lat / gps_lng / gps_accuracy_m from the login request.

    Out-of-range or non-numeric values are silently coerced to None — a corrupt
    GPS reading must never block an otherwise valid login.
    """
    lat = _to_float(request.data.get("gps_lat"))
    lng = _to_float(request.data.get("gps_lng"))
    accuracy = _to_float(request.data.get("gps_accuracy_m"))

    if lat is not None and not (-90.0 <= lat <= 90.0):
        lat = None
    if lng is not None and not (-180.0 <= lng <= 180.0):
        lng = None
    if accuracy is not None and accuracy < 0:
        accuracy = None

    return lat, lng, accuracy

def _session_payload_from_alumni(account: AlumniAccount) -> dict:
    template = _template_of(account)
    profile = template.get("profile", {}) if isinstance(template, dict) else {}
    survey_data_blob = profile.get("survey_data", {}) if isinstance(profile, dict) else {}
    if not isinstance(survey_data_blob, dict):
        survey_data_blob = {}
    # Tables are now the source of truth — overlay them on the legacy blob.
    survey_data = _as_form_labels(_merge_survey_view(survey_data_blob, account), survey_data_blob, account)

    graduation_year = None
    try:
        if account.profile:
            graduation_year = account.profile.graduation_year
    except Exception:
        pass
    if not graduation_year:
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
        "requiresRetracking": _needs_retracking(account),
        "needsEmployerInvite": _needs_employer_invite(account),
        "geomapConsent": bool(getattr(_profile_or_none(account), "geomap_consent", False)),
        "homeAddress": _home_address_payload(account),
        "employerVerification": _employer_verification_payload(account),
    }


def _profile_or_none(account):
    try:
        return account.profile
    except Exception:
        return None


def _home_address_payload(account) -> dict:
    """The graduate's home address as the Personal & Education page edits it."""
    profile = _profile_or_none(account)
    if profile is None:
        return {}
    return {
        "region": profile.home_region or "",
        "province": profile.province or "",
        "city": profile.city or "",
        "barangay": profile.home_barangay or "",
        "latitude": _to_float(profile.home_latitude),
        "longitude": _to_float(profile.home_longitude),
    }


def _employer_verification_payload(account) -> dict | None:
    """Where the employer check of the current job stands, for the graduate.

    status: verified / denied when the employer answered, pending while a
    link is out, none when no link has been sent for the current job.
    """
    from tracer.models import EmploymentRecord, VerificationToken

    record = EmploymentRecord.objects.filter(alumni=account, is_current=True).first()
    if record is None:
        return None
    if record.verification_status in (
        EmploymentRecord.VerificationStatus.VERIFIED, EmploymentRecord.VerificationStatus.DENIED,
    ):
        return {"status": record.verification_status, "invitedEmail": "", "sentAt": None}
    token = (
        VerificationToken.objects
        .filter(employment_record=record, status=VerificationToken.Status.PENDING, expires_at__gt=timezone.now())
        .order_by("-created_at")
        .first()
    )
    if token is None:
        return {"status": "none", "invitedEmail": "", "sentAt": None}
    return {"status": "pending", "invitedEmail": token.invited_email or "", "sentAt": token.created_at.isoformat()}

def _admin_alumni_payload(account: AlumniAccount) -> dict:
    template = _template_of(account)
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
            # Use the prefetched front-scan list when present (list endpoints),
            # otherwise fall back to a direct query (single-record callers).
            scans = getattr(account, "_prefetched_scans", None)
            if scans is not None:
                face_scan_obj = scans[0] if scans else None
            else:
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
    if not graduation_year:
        # Prefer the AlumniProfile table (the JSON blob is empty for
        # self-registered + seeded accounts).
        try:
            if account.profile and account.profile.graduation_year:
                graduation_year = account.profile.graduation_year
        except Exception:
            pass
    if not graduation_year and account.master_record:
        graduation_year = account.master_record.batch_year
    if not graduation_year:
        graduation_year = date.today().year

    # Prefer the structured AlumniProfile name (first/middle/last) — the JSON
    # blob "name" is usually empty for self-registered graduates, which made
    # the admin pending-verification modal fall through to the email prefix.
    name = ""
    try:
        prof = account.profile
        if prof:
            name = " ".join(
                p.strip()
                for p in [prof.first_name, prof.middle_name, prof.last_name]
                if p and p.strip()
            )
    except Exception:
        name = ""
    if not name:
        name = profile.get("name") or ""
    if not name and account.master_record:
        name = account.master_record.full_name
    if not name:
        name = account.user.email.split("@")[0]

    employment_status = _normalize_employment_status(profile.get("employment_status"), fallback="unemployed")
    employment_status = _derive_employment_status_from_survey(survey_data, fallback=employment_status)
    job_related = survey_data.get("currentJobRelated") or survey_data.get("firstJobRelated")
    job_alignment = None
    if isinstance(job_related, str):
        _jr = job_related.strip().lower()
        if _jr.startswith("yes"):
            job_alignment = "related"
        elif _jr.startswith("no") or _jr.startswith("not"):
            job_alignment = "not-related"

    skills = survey_data.get("skills") if isinstance(survey_data, dict) else []
    if not isinstance(skills, list):
        skills = []

    lat_raw = gps.get("lat") if isinstance(gps, dict) else None
    lng_raw = gps.get("lng") if isinstance(gps, dict) else None
    lat = _to_float(lat_raw)
    lng = _to_float(lng_raw)

    # Fall back to the FaceScan row's own coordinates. The scan row is the
    # queryable audit record and may carry a fix the JSON blob does not —
    # registrations before the GPS capture fix wrote neither, but seeded and
    # admin-corrected rows can have one.
    if lat is None or lng is None:
        try:
            _scans = getattr(account, "_prefetched_scans", None)
            _scan = (
                (_scans[0] if _scans else None)
                if _scans is not None
                else account.face_scans.filter(scan_type="face_front").order_by("-captured_at").first()
            )
            if _scan is not None:
                lat = lat if lat is not None else _to_float(_scan.gps_lat)
                lng = lng if lng is not None else _to_float(_scan.gps_lng)
        except (OperationalError, DatabaseError):
            pass

    # Where the graduate is plotted, most precise source first:
    #   work             - a pin on their workplace (WorkAddress)
    #   home             - the exact home location set with "Use my current location"
    #   registration_gps - the GPS stamp taken during the face scan
    location_source = "registration_gps" if lat is not None and lng is not None else None
    home_lat = home_lng = None
    try:
        _home_profile = account.profile
    except Exception:
        _home_profile = None
    if _home_profile is not None:
        home_lat = _to_float(_home_profile.home_latitude)
        home_lng = _to_float(_home_profile.home_longitude)
    if home_lat is not None and home_lng is not None:
        lat, lng, location_source = home_lat, home_lng, "home"

    addr_row = _first_related(
        account, "_prefetched_addr",
        lambda: account.work_addresses.filter(is_current=True).order_by("-created_at").first(),
    )
    if addr_row is not None and addr_row.latitude is not None and addr_row.longitude is not None:
        lat, lng, location_source = addr_row.latitude, addr_row.longitude, "work"

    if account.account_status == AccountStatus.ACTIVE:
        verification_status = "verified"
    elif account.account_status == AccountStatus.REJECTED:
        verification_status = "rejected"
    else:
        verification_status = "pending"

    # The enrolment sweep. Kept apart from registrationFaceScans, whose
    # front/left/right shape the list views and older records still rely on.
    # Each pose is paired with the angle the browser measured for it, so a
    # reviewer can see the turn actually covered both sides.
    pose_scans_raw = template.get("registration_pose_scans", {}) if isinstance(template, dict) else {}
    sample_meta = template.get("sample_meta", []) if isinstance(template, dict) else []
    if not isinstance(sample_meta, list):
        sample_meta = []
    registration_pose_scans = []
    if isinstance(pose_scans_raw, dict):
        for pose_key, pose_url in pose_scans_raw.items():
            if not (isinstance(pose_url, str) and pose_url.strip()):
                continue
            try:
                pose_index = int(str(pose_key).rsplit("_", 1)[-1])
            except ValueError:
                pose_index = -1
            meta = (
                sample_meta[pose_index]
                if 0 <= pose_index < len(sample_meta) and isinstance(sample_meta[pose_index], dict)
                else {}
            )
            registration_pose_scans.append({
                "key": pose_key,
                "url": pose_url.strip(),
                "target": _to_float(meta.get("target")),
                "yaw": _to_float(meta.get("yaw")),
            })
    capture_summary = {
        "engine": template.get("engine") if isinstance(template, dict) else None,
        "frames": capture_meta.get("frames") if isinstance(capture_meta, dict) else None,
        "samples": capture_meta.get("samples") if isinstance(capture_meta, dict) else None,
    }

    return {
        "id": str(account.id),
        "name": name,
        "email": account.user.email,
        "registrationPoseScans": registration_pose_scans,
        "locationSource": location_source,
        "homeLat": home_lat,
        "homeLng": home_lng,
        "homeBarangay": getattr(_home_profile, "home_barangay", "") if _home_profile is not None else "",
        "captureSummary": capture_summary,
        "graduationYear": graduation_year,
        "verificationStatus": verification_status,
        "accountStatus": account.account_status,
        "rejectionReason": account.rejection_reason or "",
        "isSample": bool(isinstance(template, dict) and template.get("is_sample")),
        # Whether registration found this graduate on the masterlist. Matching is
        # exact on surname and batch year, so "unmatched" often means the batch
        # was never uploaded rather than that the person is not a graduate — the
        # reviewer needs to see it before approving, not be blocked by it.
        "matchStatus": account.match_status,
        "profileReviewedAt": account.profile_reviewed_at.isoformat() if account.profile_reviewed_at else None,
        "masterRecordName": account.master_record.full_name if account.master_record else None,
        "masterRecordBatch": account.master_record.batch_year if account.master_record else None,
        "employmentStatus": employment_status,
        "jobTitle": survey_data.get("currentJobPosition") or survey_data.get("firstJobTitle") or "",
        "company": survey_data.get("currentJobCompany") or "",
        "industry": survey_data.get("currentJobSector") or survey_data.get("firstJobSector") or "",
        "jobAlignment": job_alignment,
        "workLocation": survey_data.get("currentJobLocation") or "",
        "workCity": addr_row.city_municipality if addr_row is not None else "",
        "workRegion": (addr_row.region or "") if addr_row is not None else "",
        "unemploymentReason": survey_data.get("unemploymentReason") or "",
        "dateUpdated": timezone.localtime(account.updated_at).date().isoformat() if account.updated_at else timezone.localdate().isoformat(),
        **_admin_retracking_fields(account),
        "biometricCaptured": has_biometric_capture,
        "biometricDate": timezone.localdate().isoformat() if has_biometric_capture else None,
        "facePhotoUrl": primary_face_url,
        "registrationFaceScans": registration_face_scans,
        "captureTime": capture_meta.get("captured_at") if isinstance(capture_meta, dict) else None,
        "skills": skills,
        "lat": lat,
        "lng": lng,
        "workLat": addr_row.latitude if addr_row is not None else None,
        "workLng": addr_row.longitude if addr_row is not None else None,
        # Whether this graduate agreed to be plotted on the geomap. Alumni who
        # registered before the consent gate existed default to False, so the
        # map treats "never asked" as "not consented".
        "geomapConsent": bool(getattr(getattr(account, "profile", None), "geomap_consent", False)),
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

    try:
        desired_skills = [
            {
                "id": str(s.id),
                "name": s.name,
                "category": s.category.name if s.category_id else None,
            }
            for s in account.desired_skills.select_related("category").filter(is_active=True)
        ]
    except Exception:  # pragma: no cover — defensive against missing M2M table during migration
        desired_skills = []

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
        "rejectionReason": account.rejection_reason or "",
        "date": account.created_at.date().isoformat(),
        "dateUpdated": account.updated_at.date().isoformat(),
        "desiredSkills": desired_skills,
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

        throttle_id = throttle_identifier("admin", email)
        locked, secs_left = throttle_is_locked_out(throttle_id)
        if not locked:
            locked, secs_left = throttle_ip_is_locked_out(request)
        if locked:
            return Response(
                {"detail": "Too many failed attempts. Try again later.",
                 "lockout_seconds": secs_left},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        try:
            user, auth_error = _authenticate_by_email_specific(email=email, password=password)
        except (OperationalError, DatabaseError):
            # A database outage must read as "retry shortly", not as bad
            # credentials — otherwise an outage looks like a wrong password.
            return _temporary_admin_data_unavailable_response("Authentication")
        if not user:
            throttle_ip_fail(request)
            now_locked, lockout_secs = throttle_register_fail(throttle_id, "admin")
            payload = {"detail": auth_error}
            if now_locked:
                payload["lockout_seconds"] = lockout_secs
                return Response(payload, status=status.HTTP_429_TOO_MANY_REQUESTS)
            return Response(payload, status=status.HTTP_401_UNAUTHORIZED)

        if not (user.role == User.Role.ADMIN or user.is_staff):
            # Graduates (and employers) hit this endpoint first during login;
            # the frontend uses this 403 to fall through to the face-scan flow,
            # so it is an expected, benign outcome - not a security event.
            # Mark the response as already logged so Django's base handler
            # skips its noisy "Forbidden: /api/auth/admin/login/" warning.
            response = Response(
                {"detail": "This account is not allowed to access the admin portal."},
                status=status.HTTP_403_FORBIDDEN,
            )
            response._has_been_logged = True
            return response

        _mark_logged_in(user)
        throttle_reset(throttle_id)
        return Response(
            {
                "message": "Admin login successful.",
                "user": {
                    "id": str(user.id),
                    "email": user.email,
                    "role": "admin",
                },
                # The frontend already stores this (login-page.tsx) and already
                # sends it via withAdminAuthHeaders(); until now the field was
                # never emitted, so every admin request went out unauthenticated.
                "accessToken": _generate_admin_access_token(user.id),
                "tokenType": "Bearer",
                "expiresIn": _ADMIN_TOKEN_TTL_SECONDS,
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
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
        # Every admin-role / staff user should appear in (and be manageable
        # from) the user-management UI. Some admins - e.g. created via
        # `createsuperuser` or data seeding - predate the AdminCredential flow
        # and have no credential row. Back-fill those lazily so the list is
        # complete and they become editable like any other admin.
        admin_users = User.objects.filter(Q(role=User.Role.ADMIN) | Q(is_staff=True))
        credentialed_user_ids = set(
            AdminCredential.objects.filter(user__in=admin_users).values_list("user_id", flat=True)
        )
        missing = [u for u in admin_users if u.id not in credentialed_user_ids]
        if missing:
            AdminCredential.objects.bulk_create(
                [
                    AdminCredential(user=u, admin_email=u.email, is_active=u.is_active)
                    for u in missing
                ],
                ignore_conflicts=True,
            )

        creds = AdminCredential.objects.select_related("user").order_by("created_at")
        return Response(
            [_admin_credential_payload(c) for c in creds],
            status=status.HTTP_200_OK,
        )

    def post(self, request):
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
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
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
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
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
        # TODO: backend self-delete check once admin auth is per-request.
        cred = self._get_credential(admin_id)
        if not cred:
            return Response(
                {"detail": "Admin not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        cred.user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

_FACEBOOK_HOSTS = frozenset({
    "facebook.com",
    "www.facebook.com",
    "m.facebook.com",
    "web.facebook.com",
    "l.facebook.com",
    "fb.com",
    "www.fb.com",
    "fb.me",
})

def _sanitize_facebook_url(raw: object) -> str:
    """Return a validated Facebook profile URL, or "" when the input is empty
    or not a Facebook link.

    The field is optional, but it must not become a vector for storing an
    arbitrary (potentially malicious) URL. The frontend already enforces this,
    but a direct API call bypasses the frontend - so we re-validate here against
    the same host allow-list and reject any non-http(s) scheme.
    """
    if not isinstance(raw, str):
        return ""
    trimmed = raw.strip()
    if not trimmed:
        return ""
    # Tolerate users pasting "facebook.com/foo" without a scheme.
    candidate = trimmed if re.match(r"^https?://", trimmed, re.IGNORECASE) else f"https://{trimmed}"
    try:
        parsed = urlparse(candidate)
    except ValueError:
        return ""
    if parsed.scheme not in ("http", "https"):
        return ""
    if (parsed.hostname or "").lower() not in _FACEBOOK_HOSTS:
        return ""
    return candidate

# The only fields allowed to hold a link: the Facebook profile, which
# _sanitize_facebook_url checks against its own allow-list, and the login email.
_LINK_ALLOWED_FIELDS = frozenset({"facebook", "facebook_url", "facebookUrl", "email"})

def _link_error(field: str) -> str:
    label = re.sub(r"([a-z])([A-Z])", r"\1 \2", field).replace("_", " ").lower()
    return f"Links are not allowed. Remove the link from {label}."

def _coordinate(value, limit: float):
    """A latitude/longitude from the request as a 6-dp Decimal, or None if absent or out of range."""
    number = _to_float(value)
    if number is None or number != number or not (-limit <= number <= limit):
        return None
    return Decimal(f"{number:.6f}")

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
        "facebook_url": _sanitize_facebook_url(personal_data.get("facebook_url", "")),
        "city": personal_data.get("city", ""),
        "province": personal_data.get("province", ""),
        "home_region": (personal_data.get("region") or "").strip()[:120],
        "home_barangay": (personal_data.get("barangay") or "").strip()[:160],
        "home_country": (personal_data.get("home_country") or "").strip()[:120],
        "home_is_abroad": _as_bool(personal_data.get("home_is_abroad")),
        # Only present when the graduate used "Use my current location".
        "home_latitude": _coordinate(personal_data.get("home_latitude"), 90),
        "home_longitude": _coordinate(personal_data.get("home_longitude"), 180),
        "home_location_accuracy_m": _to_float(personal_data.get("home_location_accuracy_m")),

        # Academic info (from form, not survey)
        "graduation_date": personal_data.get("graduation_date", ""),
        "graduation_year": personal_data.get("graduation_year"),
        "scholarship": personal_data.get("scholarship", ""),
        "highest_attainment": personal_data.get("highest_attainment", ""),
        "graduate_school": personal_data.get("graduate_school", ""),
        "further_studies_status": personal_data.get("further_studies_status", "none") or "none",
        "postgrad_program": personal_data.get("postgrad_program", ""),
        "postgrad_field": personal_data.get("postgrad_field", ""),
        "postgrad_school": personal_data.get("postgrad_school", "") or personal_data.get("graduate_school", ""),
        "postgrad_year_started": _safe_int(personal_data.get("postgrad_year_started")),
        "postgrad_year_completed": _safe_int(personal_data.get("postgrad_year_completed")),
        "prof_eligibility": personal_data.get("prof_eligibility", ""),
        "prof_eligibility_other": personal_data.get("prof_eligibility_other", ""),

        # Consent. terms_accepted_at is stamped server-side so the record
        # reflects when the server actually received the agreement rather than
        # a client-supplied timestamp.
        "terms_accepted_at": timezone.now() if _as_bool(personal_data.get("terms_accepted")) else None,
        "geomap_consent": _as_bool(personal_data.get("geomap_consent")),
        # Registering is the first employment confirmation; retracking is due
        # two years from here.
        "last_retraced_at": timezone.now(),

        # Academic Profile (from survey_data - Section 3).
        # general_average_range is intentionally absent: the form stopped
        # collecting it in the 2026 revision, so reading it here only ever wrote
        # None. The column remains for historical rows.
        "academic_honors": survey_data.get("academic_honors"),
        "prior_work_experience": survey_data.get("prior_work_experience", False),
        "ojt_relevance": survey_data.get("ojt_relevance"),
        "has_portfolio": survey_data.get("has_portfolio", False),

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
        "first_job_company": (survey_data.get("first_job_company") or "").strip()[:200] or None,
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
        # The registration form names this field province_work.
        "province": (survey_data.get("province_work") or survey_data.get("province") or "").strip(),
        "region": survey_data.get("region"),
        "zip_code": survey_data.get("zip_code", "").strip(),
        "country": survey_data.get("country", "Philippines"),
        "latitude": survey_data.get("latitude"),
        "longitude": survey_data.get("longitude"),
    }

def _create_registration_employment_record(alumni_account, survey_data: dict):
    """Current-job EmploymentRecord from the registration survey, or None when
    the graduate isn't employed or left the company or title blank."""
    from tracer.models import JobTitle

    status_value = survey_data.get("employment_status")
    if status_value == "self_employed":
        record_status = EmploymentRecord.EmploymentStatus.SELF_EMPLOYED
    elif status_value in {"employed_full_time", "employed_part_time"}:
        record_status = EmploymentRecord.EmploymentStatus.EMPLOYED
    else:
        return None

    company = (survey_data.get("current_job_company") or "").strip()
    title = (survey_data.get("current_job_title") or "").strip()
    if not company or not title:
        return None

    if survey_data.get("location_type") is False:
        work_location = "Abroad / Remote"
    else:
        work_location = (survey_data.get("city_municipality") or "").strip() or "Philippines"

    return EmploymentRecord.objects.create(
        alumni=alumni_account,
        employer_account=EmployerAccount.objects.filter(company_name__iexact=company).first(),
        employer_name_input=company[:255],
        job_title_input=title[:255],
        job_title=JobTitle.objects.filter(name__iexact=title, is_active=True).first(),
        employment_status=record_status,
        work_location=work_location[:255],
        is_current=True,
        verification_status=EmploymentRecord.VerificationStatus.PENDING,
    )

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

# Upper bound on sweep frames per registration. The client sends five; the cap
# only exists so a hostile request cannot queue unbounded uploads and inferences.
_MAX_REGISTRATION_POSE_FRAMES = 8


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

        # A rejected registration does not lock its address: registering again
        # replaces it (inside the transaction below, once this one is valid).
        existing_user = User.objects.filter(email=email).first()
        rejected_user = None
        if existing_user:
            existing_account = AlumniAccount.objects.filter(user=existing_user).first()
            if existing_account is None or existing_account.account_status != AccountStatus.REJECTED:
                return Response(
                    {"detail": "This email is already registered."},
                    status=status.HTTP_409_CONFLICT,
                )
            rejected_user = existing_user

        # Registration stores ONE frontal photo. The blink and head-turn stages
        # prove liveness but deliberately save no image: face-api's recogniser
        # is only reliable near-frontal, so turned frames were never usable for
        # matching anyway. face_left / face_right stay accepted-but-optional so
        # older clients mid-upgrade keep working.
        required_files = ["face_front"]
        optional_files = ["face_left", "face_right"]
        missing_files = [name for name in required_files if name not in request.FILES]
        if missing_files:
            return Response(
                {"detail": f"Missing biometric images: {', '.join(missing_files)}."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        upload_files = required_files + [n for n in optional_files if n in request.FILES]
        # The enrolment sweep: extra frames at several head angles. Optional, so
        # a client that predates the sweep still registers with face_front
        # alone. Capped because each frame is a Supabase upload and, under a
        # server-side engine, a model inference on a small VPS.
        pose_files = request.FILES.getlist("face_images")[:_MAX_REGISTRATION_POSE_FRAMES]

        graduation_year = _extract_year(graduation_date)

        # ── Clean-data gate ──────────────────────────────────────────────────
        # Run BEFORE the Supabase upload and before any row is written, so a
        # rejection leaves no orphaned image and no partial account.
        #
        # Registration posts a flat payload while the validator expects the
        # portal's sectioned shape, so it goes through the adapter — handing the
        # flat dict straight to SurveyDataValidator raises AttributeError,
        # because 'employment_status' is both a section name and a field name.
        _survey_for_validation = _safe_json_loads(request.data.get("survey_data"))
        link_field = first_link_field(request.data, skip=_LINK_ALLOWED_FIELDS | {"password", "confirm_password", "survey_data"})
        link_step = "personal"
        if not link_field and isinstance(_survey_for_validation, dict):
            link_field, link_step = first_link_field(_survey_for_validation, skip=_LINK_ALLOWED_FIELDS), "employment"
        if link_field:
            return Response(
                {"detail": _link_error(link_field), "field_errors": {link_field: _link_error(link_field)}, "step": link_step},
                status=status.HTTP_400_BAD_REQUEST,
            )
        _validation = validate_registration_payload(
            _survey_for_validation,
            {
                "first_name": first_name,
                "middle_name": request.data.get("middle_name") or request.data.get("middleName") or "",
                "last_name": family_name,
                "gender": request.data.get("gender"),
                "birth_date": request.data.get("birth_date"),
                "mobile": request.data.get("mobile"),
                "city": request.data.get("city"),
                "province": request.data.get("province"),
                "graduation_date": graduation_date,
                "graduation_year": graduation_year,
            },
        )
        if not _validation["is_valid"]:
            # Only values that are present-but-impossible reach here. `step`
            # lets the client return the graduate to the form that owns the
            # problem instead of restarting registration.
            return Response(
                {
                    "detail": "Some answers could not be accepted. Please correct them and submit again.",
                    "field_errors": _validation["field_errors"],
                    "step": _validation["step"],
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        master_record = _find_master_record(
            family_name=family_name,
            first_name=first_name,
            graduation_year=graduation_year,
        )

        storage_key_basis = email.split("@")[0]
        if master_record:
            storage_key_basis = master_record.full_name
        storage_key = _normalize_storage_key(storage_key_basis)

        face_scan_urls: dict[str, str] = {}
        timestamp = timezone.now().strftime("%Y%m%d%H%M%S%f")
        # Kept because a server-side engine has to embed the frontal image
        # itself. scan_file.read() drains the upload, so the bytes have to be
        # held here rather than re-read further down.
        registration_front_bytes: bytes | None = None
        pose_bytes: list[bytes] = []
        # Pose frames are kept apart from face_scan_urls on purpose. That dict
        # feeds the FaceScan rows, and admin review picks the newest face_front
        # row as the primary photo -- a turned frame must never become the face
        # a reviewer verifies against.
        pose_scan_urls: dict[str, str] = {}

        try:
            for scan_key in upload_files:
                scan_file = request.FILES[scan_key]
                file_bytes = scan_file.read()
                if scan_key == "face_front":
                    registration_front_bytes = file_bytes
                object_path = f"face-registration/{storage_key}/{timestamp}_{scan_key}.jpg"
                face_scan_urls[scan_key] = upload_image_bytes(
                    file_bytes=file_bytes,
                    object_path=object_path,
                    content_type=scan_file.content_type or "image/jpeg",
                )
            for index, pose_file in enumerate(pose_files):
                file_bytes = pose_file.read()
                pose_bytes.append(file_bytes)
                pose_key = f"face_pose_{index}"
                pose_scan_urls[pose_key] = upload_image_bytes(
                    file_bytes=file_bytes,
                    object_path=f"face-registration/{storage_key}/{timestamp}_{pose_key}.jpg",
                    content_type=pose_file.content_type or "image/jpeg",
                )
        except SupabaseStorageError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        profile_name = _build_profile_name(first_name, middle_name, family_name)
        survey_data = _safe_json_loads(request.data.get("survey_data"))

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

        # Parsed once so both the JSON blob and the FaceScan rows carry the same
        # location, and so a malformed value degrades to NULL instead of raising.
        _capture_gps_lat = _to_float(request.data.get("gps_lat"))
        _capture_gps_lng = _to_float(request.data.get("gps_lng"))

        capture_meta = {
            "captured_at": request.data.get("capture_time") or timezone.now().isoformat(),
            "gps": {
                "lat": request.data.get("gps_lat"),
                "lng": request.data.get("gps_lng"),
            },
        }

        # The active engine decides where the embedding comes from. face-api
        # runs in the browser and sends one; InsightFace and CompreFace ignore
        # whatever the client sent and embed the uploaded image themselves, so a
        # face-api vector can never be enrolled under a 512-d engine by accident.
        _active_engine = get_engine()
        if _active_engine.requires_client_descriptor:
            # The browser already chose which frames to describe. face-api's
            # recogniser is only reliable near-frontal, so the client sends
            # descriptors for its frontal frames and none for the turned ones.
            face_descriptor_samples = _parse_face_descriptor_samples(
                request.data.get("face_descriptor_samples")
            )
            face_descriptor = _active_engine.embed(
                image_bytes=registration_front_bytes,
                client_descriptor=_parse_face_descriptor(request.data.get("face_descriptor")),
            )
            if not face_descriptor and face_descriptor_samples:
                face_descriptor = _active_engine.average(face_descriptor_samples)
        else:
            # A server-side engine embeds every frame itself: the frontal photo
            # plus each sweep pose. Frames the detector cannot use are skipped
            # rather than failing registration -- the extreme angles of a sweep
            # are exactly where that happens.
            #
            # Poses are only trusted RELATIVE to the frontal photo, which is the
            # image an admin verifies. A pose that is not the same person is
            # dropped, so nobody can lean into frame mid-sweep and enrol their
            # own face on this account. If the frontal photo itself cannot be
            # read there is nothing to check poses against, so nothing is
            # enrolled -- the same outcome as before the sweep existed.
            face_descriptor_samples = []
            front_embedding = (
                _active_engine.embed(image_bytes=registration_front_bytes)
                if registration_front_bytes
                else None
            )
            if front_embedding:
                face_descriptor_samples.append(front_embedding)
                for blob in pose_bytes:
                    embedding = _active_engine.embed(image_bytes=blob)
                    if embedding and _active_engine.is_match(
                        _active_engine.distance(front_embedding, embedding)
                    ):
                        face_descriptor_samples.append(embedding)
            face_descriptor = (
                _active_engine.average(face_descriptor_samples)
                if face_descriptor_samples
                else None
            )
        if face_descriptor and not face_descriptor_samples:
            face_descriptor_samples = [face_descriptor]

        capture_meta["frames"] = 1 + len(pose_bytes)
        capture_meta["samples"] = len(face_descriptor_samples)

        # Liveness signals are client-attested per-slot measurements (MAR + yaw)
        # produced by the 3-challenge capture. Stored as-is for forensic audit;
        # server-side recomputation is deferred.
        liveness_signals_raw = request.data.get("liveness_signals")
        liveness_signals: dict | None = None
        if liveness_signals_raw:
            try:
                parsed = json.loads(liveness_signals_raw) if isinstance(liveness_signals_raw, str) else liveness_signals_raw
                if isinstance(parsed, dict):
                    liveness_signals = parsed
            except (ValueError, TypeError):
                liveness_signals = None

        with transaction.atomic():
            if rejected_user is not None:
                rejected_user.delete()
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
                    "registration_pose_scans": pose_scan_urls,
                    # Client-measured yaw per pose, for auditing which angles a
                    # template was actually built from.
                    "sample_meta": _safe_json_loads(request.data.get("face_images_meta")) or [],
                    "capture_meta": capture_meta,
                    "face_descriptor": face_descriptor,
                    "face_descriptor_samples": face_descriptor_samples,
                    "liveness_signals": liveness_signals,
                    # Provenance. Embeddings from different engines are not
                    # comparable -- different dimensionality, different metric --
                    # so every template records which one produced it and
                    # _resolve_reference_descriptors refuses to mix them.
                    "engine": _active_engine.name,
                    "engine_dim": _active_engine.dimensions,
                }),
                # A masterlist match is enough to let the graduate in. The admin
                # still checks the person is real from the Profile Review list,
                # and rejecting there deletes the account. Anyone not on the
                # masterlist waits in Pending Verification as before.
                account_status=AccountStatus.ACTIVE if master_record else AccountStatus.PENDING,
            )

            # 2b. Create FaceScan DB records for whichever angles were uploaded
            # (normally just face_front).
            _captured_at = timezone.now()
            for _scan_key in ["face_front", "face_left", "face_right"]:
                _url = face_scan_urls.get(_scan_key)
                if _url:
                    FaceScan.objects.create(
                        alumni=alumni_account,
                        scan_type=_scan_key,
                        url=_url,
                        captured_at=_captured_at,
                        # The FaceScan row is the queryable audit record, so the
                        # capture location belongs here too — not only inside
                        # the biometric_template JSON blob.
                        gps_lat=_capture_gps_lat,
                        gps_lng=_capture_gps_lng,
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
                    # Record the soft issues the clean-data gate let through, so
                    # an admin can see which records are dirty rather than
                    # having to trust that everything stored is pristine.
                    validation_result={
                        "status": _validation["status"],
                        "completeness_score": _validation["completeness_score"],
                        "warnings": _validation["warnings"],
                        "sections_validated": _validation["sections_validated"],
                    },
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

            # 5b. Create the current EmploymentRecord for an employed graduate.
            # The employer-invite prompt on first login keys off this row
            # (_needs_employer_invite); registration used to skip it, so the
            # prompt only ever appeared after a later save on the edit page.
            if employment_profile:
                _create_registration_employment_record(alumni_account, survey_data)

            # 6. Create AlumniSkill entries (if technical or soft skills submitted)
            if survey_data and (survey_data.get("technical_skills") or survey_data.get("soft_skills")):
                _create_alumni_skills(alumni_account, survey_data)

        # First entry of the retracking history, after the registration commits.
        log_retracking_event(alumni_account, "registered", when=profile.last_retraced_at)

        return Response(
            {
                "message": (
                    "Graduate registration submitted. Account is active."
                    if alumni_account.account_status == AccountStatus.ACTIVE
                    else "Graduate registration submitted. Account is pending verification."
                ),
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

        throttle_id = throttle_identifier("graduate", email)
        locked, secs_left = throttle_is_locked_out(throttle_id)
        if not locked:
            locked, secs_left = throttle_ip_is_locked_out(request)
        if locked:
            return Response(
                {"detail": "Too many failed attempts. Try again later.",
                 "lockout_seconds": secs_left},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        try:
            user, auth_error = _authenticate_by_email_specific(email=email, password=password)
        except (OperationalError, DatabaseError):
            # A database outage must read as "retry shortly", not as bad
            # credentials — otherwise an outage looks like a wrong password.
            return _temporary_admin_data_unavailable_response("Authentication")
        if not user:
            throttle_ip_fail(request)
            now_locked, lockout_secs = throttle_register_fail(throttle_id, "graduate")
            payload = {"detail": auth_error}
            if now_locked:
                payload["lockout_seconds"] = lockout_secs
                return Response(payload, status=status.HTTP_429_TOO_MANY_REQUESTS)
            return Response(payload, status=status.HTTP_401_UNAUTHORIZED)

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
        # Not on the masterlist: held until an admin approves it. The approval
        # email tells the graduate when they can sign in.
        if alumni_account.account_status == AccountStatus.PENDING:
            return Response(
                {
                    "detail": (
                        "Your account is awaiting verification by the BSIS administrator. "
                        "You will receive an email once it is approved."
                    ),
                    "accountStatus": AccountStatus.PENDING,
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        reference_scan_urls = _extract_registration_scan_urls(alumni_account)
        reference_descriptors = _resolve_reference_descriptors(alumni_account)

        # Two situations need the same thing from the graduate -- capture a new
        # face -- so they return one actionable response rather than two dead
        # ends:
        #
        #   not_enrolled    no template at all (new account, or reset by an admin)
        #   engine_changed  a template exists but a different engine produced it
        #
        # An engine change empties reference_descriptors, and without this the
        # request would slide into the image-comparison fallback below, which
        # compares raw pixels and cannot distinguish identity at all. Switching
        # engines must force re-enrolment, never silently downgrade to the
        # weakest check in the system.
        #
        # A token is issued here because the password, the throttle and the
        # account status have ALL already been checked above. That is the same
        # trust registration itself runs on, where the password is set in the
        # same breath as the first face capture -- and it is the only way out,
        # since a face cannot be used to authorise replacing itself.
        _active_engine_name = get_engine().name
        _stored_engine = _stored_template_engine(alumni_account)
        _enrolled = _has_face_enrolment(alumni_account)

        if not _enrolled or _stored_engine != _active_engine_name:
            reason = "not_enrolled" if not _enrolled else "engine_changed"
            detail = (
                "This account has no face enrolled yet. Capture one to finish signing in."
                if not _enrolled
                else (
                    "This account's face was enrolled with a different recognition "
                    "engine. Capture it again to finish signing in."
                )
            )
            throttle_reset(throttle_id)
            return Response(
                {
                    "detail": detail,
                    "faceEnrolmentRequired": True,
                    "reason": reason,
                    "storedEngine": _stored_engine if _enrolled else None,
                    "activeEngine": _active_engine_name,
                    "alumni": _session_payload_from_alumni(alumni_account),
                    "accessToken": _generate_alumni_access_token(alumni_account.user_id),
                    "tokenType": "Bearer",
                    "expiresIn": _ALUMNI_TOKEN_TTL_SECONDS,
                },
                status=status.HTTP_409_CONFLICT,
            )

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

        # Same rule as registration: face-api takes the browser's descriptor,
        # the server-side engines embed the uploaded frame themselves.
        _active_engine = get_engine()
        login_descriptor = _active_engine.embed(
            image_bytes=login_scan_bytes,
            client_descriptor=_parse_face_descriptor(request.data.get("face_descriptor")),
        )
        descriptor_distance = None
        similarity_score = 0.0

        if login_descriptor and reference_descriptors:
            _match = _active_engine.compare(login_descriptor, reference_descriptors)
            descriptor_match = _match.is_match
            descriptor_distance = _match.distance
            descriptor_similarity = _match.similarity
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

        # Liveness signal (client-attested) from the login challenge gate.
        # Recorded for forensic audit; no server-side threshold check yet.
        liveness_signal_raw = request.data.get("liveness_signal")
        liveness_signal_for_audit: dict | None = None
        if liveness_signal_raw:
            try:
                parsed_liveness = json.loads(liveness_signal_raw) if isinstance(liveness_signal_raw, str) else liveness_signal_raw
                if isinstance(parsed_liveness, dict):
                    liveness_signal_for_audit = parsed_liveness
            except (ValueError, TypeError):
                liveness_signal_for_audit = None

        login_audit.append(
            {
                "timestamp": timezone.now().isoformat(),
                "scan_url": login_scan_url,
                "similarity_score": round(similarity_score, 4),
                "descriptor_distance": round(descriptor_distance, 4) if descriptor_distance is not None else None,
                "liveness_signal": liveness_signal_for_audit,
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

        gps_lat, gps_lng, gps_accuracy_m = _extract_login_gps(request)
        try:
            LoginAudit.objects.create(
                alumni=alumni_account,
                timestamp=timezone.now(),
                scan_url=login_scan_url,
                similarity_score=round(similarity_score, 4),
                descriptor_distance=round(descriptor_distance, 4) if descriptor_distance is not None else None,
                status="success",
                gps_lat=gps_lat,
                gps_lng=gps_lng,
                gps_accuracy_m=gps_accuracy_m,
            )
        except (OperationalError, DatabaseError):  # pragma: no cover - audit is best-effort
            pass

        _mark_logged_in(alumni_account.user)
        throttle_reset(throttle_id)
        return Response(
            {
                "message": "Graduate login successful.",
                "alumni": _session_payload_from_alumni(alumni_account),
                "faceScanUrl": login_scan_url,
                "accessToken": _generate_alumni_access_token(alumni_account.user_id),
                "tokenType": "Bearer",
                "expiresIn": _ALUMNI_TOKEN_TTL_SECONDS,
            },
            status=status.HTTP_200_OK,
        )

class AlumniFaceEnrolView(APIView):
    """
    Capture (or re-capture) the face template for the signed-in graduate.

    Reached from login: when an account has no usable template, login verifies
    the password, throttle and account status, then returns 409 with
    faceEnrolmentRequired and an access token. This endpoint spends that token.

    A face cannot authorise replacing itself, so the password is necessarily the
    credential behind this -- which is the same basis registration runs on,
    where the password is set alongside the first capture. It is deliberately
    NOT reachable with a face login alone.

    Accepts a multi-frame sweep. One frontal frame yields one reference vector,
    so a later login at a slightly different angle has nothing close to match
    against; several poses give the comparison something to work with.
    """

    parser_classes = [MultiPartParser, FormParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        account, auth_error = _require_alumni(request)
        if auth_error:
            return auth_error

        if account.account_status in {AccountStatus.REJECTED, AccountStatus.SUSPENDED}:
            return Response(
                {"detail": f"Account access blocked ({account.account_status})."},
                status=status.HTTP_403_FORBIDDEN,
            )

        engine = get_engine()

        image_files = request.FILES.getlist("face_images")
        if not image_files and "face_image" in request.FILES:
            image_files = [request.FILES["face_image"]]
        if not image_files:
            return Response(
                {"detail": "At least one face image is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        image_blobs = [f.read() for f in image_files]

        try:
            if engine.requires_client_descriptor:
                samples = _parse_face_descriptor_samples(
                    request.data.get("face_descriptor_samples"), engine.dimensions
                )
                single = _parse_face_descriptor(
                    request.data.get("face_descriptor"), engine.dimensions
                )
                if single and single not in samples:
                    samples.append(single)
            else:
                # A sweep always contains some angles the detector cannot use.
                # Skipping those beats failing the whole enrolment over one bad
                # frame.
                samples = []
                for blob in image_blobs:
                    embedding = engine.embed(image_bytes=blob)
                    if embedding:
                        samples.append(embedding)
        except RuntimeError as exc:
            return Response(
                {"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE
            )

        descriptor = engine.average(samples) if samples else None
        if descriptor is None:
            return Response(
                {
                    "detail": (
                        f"No usable face could be read from the {len(image_blobs)} frame(s) "
                        "sent. Move further from the camera so your whole head fits with "
                        "room around it, and make sure the light is on your face."
                    ),
                    "framesSupplied": len(image_blobs),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Keep the frames. Beyond the audit trail the PRD requires, an engine
        # change invalidates every embedding, and holding the originals means a
        # future switch can be done offline instead of asking every graduate to
        # come back.
        storage_key_basis = (
            account.master_record.full_name
            if account.master_record
            else (account.user.email or "").split("@")[0]
        )
        storage_key = _normalize_storage_key(storage_key_basis)
        timestamp = timezone.now().strftime("%Y%m%d%H%M%S%f")
        scan_urls: dict[str, str] = {}
        try:
            for index, blob in enumerate(image_blobs):
                key = "face_front" if index == 0 else f"face_pose_{index}"
                scan_urls[key] = upload_image_bytes(
                    file_bytes=blob,
                    object_path=f"face-enrolment/{storage_key}/{timestamp}_{key}.jpg",
                    content_type="image/jpeg",
                )
        except SupabaseStorageError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        template = _safe_json_loads(account.biometric_template)
        if not isinstance(template, dict):
            template = {}
        template.update(
            {
                "face_descriptor": descriptor,
                "face_descriptor_samples": samples,
                "registration_face_scans": scan_urls,
                "engine": engine.name,
                "engine_dim": engine.dimensions,
                "capture_meta": {
                    "captured_at": timezone.now().isoformat(),
                    "gps": _extract_login_gps(request),
                    "frames": len(image_blobs),
                    "samples": len(samples),
                    "re_enrolled": True,
                },
                "sample_meta": _safe_json_loads(request.data.get("sample_meta")) or [],
            }
        )
        # A template from the previous engine would otherwise sit alongside the
        # new one and be picked up again if the engine were switched back to a
        # face the graduate has since replaced.
        template.pop("engines", None)

        account.biometric_template = json.dumps(template)
        account.face_photo_url = scan_urls.get("face_front", account.face_photo_url)
        account.save(update_fields=["biometric_template", "face_photo_url"])

        for key, url in scan_urls.items():
            FaceScan.objects.create(
                alumni=account,
                scan_type="face_front" if key == "face_front" else "face_front",
                url=url,
                captured_at=timezone.now(),
            )

        return Response(
            {
                "message": "Face enrolled.",
                "engine": engine.name,
                "dimensions": engine.dimensions,
                "framesSupplied": len(image_blobs),
                "samples": len(samples),
                "alumni": _session_payload_from_alumni(account),
            },
            status=status.HTTP_200_OK,
        )


class AlumniAccountStatusView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, alumni_id):
        # This returns _session_payload_from_alumni — the same object handed out
        # on login, including the graduate's name and their entire survey_data.
        # It was previously unauthenticated, so anyone holding an alumni UUID
        # could read that record without signing in. The POST below has always
        # been guarded; the GET simply never was.
        _alumni_account, _auth_error = _require_alumni(request, alumni_id=alumni_id)
        if _auth_error:
            return _auth_error

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
        _alumni_account, _auth_error = _require_alumni(request, alumni_id=alumni_id)
        if _auth_error:
            return _auth_error
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

        # Same clean-data rules as registration. This endpoint writes straight to
        # the normalized tables (Employment and Personal & Education pages), so
        # it refuses bad values itself instead of trusting the browser.
        from tracer.text_quality import job_text_problem, person_name_problem, ph_mobile_problem

        field_rules = (
            ("firstJobTitle", "First job title", job_text_problem),
            ("currentJobPosition", "Job title", job_text_problem),
            ("currentJobCompany", "Company name", job_text_problem),
            ("firstName", "First name", person_name_problem),
            ("first_name", "First name", person_name_problem),
            ("middleName", "Middle name", person_name_problem),
            ("middle_name", "Middle name", person_name_problem),
            ("familyName", "Family name", person_name_problem),
            ("last_name", "Family name", person_name_problem),
            ("mobile", "Mobile number", ph_mobile_problem),
        )
        field_errors = {}
        for key, label, rule in field_rules:
            value = incoming_survey_data.get(key)
            if isinstance(value, str) and (problem := rule(value)):
                field_errors[key] = f"{label} {problem}."
        # Same rule as registration, but only for a changed date: this page
        # re-sends the saved one on every save, and a graduate already on file
        # must still be able to edit the rest of their profile.
        graduation_value = incoming_survey_data.get("graduationDate", incoming_survey_data.get("graduation_date"))
        stored_graduation = getattr(getattr(alumni_account, "profile", None), "graduation_date", "") or ""
        if isinstance(graduation_value, str) and graduation_value.strip() != stored_graduation:
            if problem := graduation_date_problem(graduation_value):
                field_errors["graduationDate"] = problem
        # No links except Facebook, and only for changed values, for the same
        # reason: an old answer on file must not lock the graduate out of saving.
        changed = {k: v for k, v in incoming_survey_data.items() if v != existing_survey_data.get(k)}
        if link_field := first_link_field(changed, skip=_LINK_ALLOWED_FIELDS):
            field_errors[link_field] = _link_error(link_field)
        for key in ("facebook", "facebook_url", "facebookUrl"):
            value = changed.get(key)
            if isinstance(value, str) and value.strip():
                if clean_url := _sanitize_facebook_url(value):
                    incoming_survey_data[key] = clean_url
                else:
                    field_errors[key] = "Facebook link must be a facebook.com, fb.com, or fb.me link."
        if field_errors:
            return Response(
                {"detail": " ".join(field_errors.values()), "field_errors": field_errors},
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
        # When the graduate goes through the "same evaluator?" modal (company /
        # title changed), the old evaluator must NOT be auto-emailed: same ->
        # reuse existing, different -> graduate shares an invite link manually.
        # The frontend sends notify_previous_evaluator=false in that case.
        notify_raw = request.data.get("notify_previous_evaluator", True)
        notify_previous_evaluator = (
            notify_raw if isinstance(notify_raw, bool) else str(notify_raw).strip().lower() != "false"
        )
        # Only the Employment page flags a save as a retrace. Personal & Education
        # and Profile saves come through this same endpoint and must not restart
        # the two-year clock. Snapshot first so the history shows what changed.
        is_retrace = str(request.data.get("retrace_submission", "")).strip().lower() in {"true", "1", "yes"}
        before_snapshot = employment_snapshot(alumni_account) if is_retrace else None
        previous_retrace = _last_retraced_at(alumni_account) if is_retrace else None

        try:
            from .survey_translator import apply_survey_data_to_normalized_tables
            apply_survey_data_to_normalized_tables(
                alumni_account,
                merged_survey_data,
                notify_previous_evaluator=notify_previous_evaluator,
            )
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception(
                "survey_translator failed for alumni %s: %s", alumni_account.id, exc
            )

        if is_retrace:
            retraced_at = mark_retraced(alumni_account)
            log_retracking_event(
                alumni_account, "retraced", before=before_snapshot, previous_at=previous_retrace, when=retraced_at,
            )

        return Response(
            {
                "message": "Graduate employment details updated.",
                "alumni": _session_payload_from_alumni(alumni_account),
            },
            status=status.HTTP_200_OK,
        )

    def patch(self, request, alumni_id):
        _alumni_account, _auth_error = _require_alumni(request, alumni_id=alumni_id)
        if _auth_error:
            return _auth_error
        return self.post(request, alumni_id)

class PendingAlumniListView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
        try:
            # Catch up graduates whose masterlist row arrived after they
            # registered. A match activates them, moving them to Profile Review.
            for account in AlumniAccount.objects.select_related("user").filter(
                account_status=AccountStatus.PENDING, master_record__isnull=True,
            ):
                _refresh_master_match(account)
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

class ProfileReviewAlumniListView(APIView):
    """Masterlist-matched graduates who are already active but whose profile an
    admin has not yet checked. Confirm uses the approve endpoint; reject uses
    the usual reject endpoint (email + delete)."""
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
        try:
            accounts = _alumni_dashboard_queryset(
                AlumniAccount.objects.filter(
                    account_status=AccountStatus.ACTIVE,
                    profile_reviewed_at__isnull=True,
                )
            ).order_by("-created_at")
            results = [_admin_alumni_payload(account) for account in accounts]
        except (OperationalError, DatabaseError):
            return _temporary_admin_data_unavailable_response("Profile review")

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
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
        from tracer import employability

        # Seeded simulated graduates (seed_simulated_graduates), both set on
        # /admin/debug/a:
        #   ?purpose=analytics (geomap, dashboard) follows the analytics source,
        #   so it shows real graduates or seeded ones, never a mix;
        #   the Verified Graduates list shows real graduates, plus the seeded
        #   ones only while "show simulated accounts" is on.
        settings = employability.debug_settings()
        active = AlumniAccount.objects.filter(account_status=AccountStatus.ACTIVE)
        if request.query_params.get("purpose") == "analytics":
            active = employability.filter_source(active, settings["source"])
        elif not settings["show_samples_in_verified"]:
            # Demo graduates (/admin/debug/a) stay listed: they exist to show
            # this page's badges and history.
            active = active.filter(~employability.sample_q() | employability.demo_q())
        try:
            verified_accounts = _alumni_dashboard_queryset(active).order_by("-updated_at")
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
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
        alumni_account = AlumniAccount.objects.select_related("user", "master_record").filter(id=alumni_id).first()
        if not alumni_account:
            return Response(
                {"detail": "Graduate request was not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Approving a pending account and confirming an already-active one
        # (Profile Review) both land here, and both tell the graduate by email
        # that their record has been verified.
        was_active = alumni_account.account_status == AccountStatus.ACTIVE
        alumni_account.account_status = AccountStatus.ACTIVE
        alumni_account.profile_reviewed_at = alumni_account.profile_reviewed_at or timezone.now()
        alumni_account.save(update_fields=["account_status", "profile_reviewed_at", "updated_at"])

        payload = _admin_alumni_payload(alumni_account)
        _send_approval_email(
            to_email=alumni_account.user.email if alumni_account.user else "",
            recipient_name=payload.get("name") or "",
            is_employer=False,
        )

        return Response(
            {
                "message": "Graduate profile confirmed." if was_active else "Graduate request approved.",
                "alumni": payload,
            },
            status=status.HTTP_200_OK,
        )

class AlumniRetrackingReminderView(APIView):
    """Admin emails one verified graduate the retracking reminder on demand.

    Sent synchronously so the admin sees whether it actually went out; the
    send_retracking_reminders command stays the automatic path.
    """
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, alumni_id):
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
        alumni_account = (
            AlumniAccount.objects.select_related("user", "profile")
            .filter(id=alumni_id, account_status=AccountStatus.ACTIVE)
            .first()
        )
        if not alumni_account:
            return Response(
                {"detail": "Verified graduate was not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        to_email = alumni_account.user.email if alumni_account.user else ""
        if not to_email:
            return Response(
                {"detail": "This graduate has no email address on file."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            send_retracking_email(to_email=to_email, first_name=graduate_first_name(alumni_account))
        except Exception:
            logger.exception("Retracking reminder failed for alumni %s", alumni_account.id)
            return Response(
                {"detail": "The reminder email could not be sent. Please try again later."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        sent_at = timezone.now()
        AlumniProfile.objects.filter(alumni=alumni_account).update(last_retracking_reminder_at=sent_at)
        log_retracking_event(
            alumni_account, "reminder", sent_by=getattr(_admin_user, "email", "") or "admin", when=sent_at,
        )
        return Response(
            {"message": f"Retracking reminder sent to {to_email}.", "sentAt": sent_at.isoformat()},
            status=status.HTTP_200_OK,
        )


def _serialize_employer_decision(decision) -> dict:
    """One employer decision with its flag reason and evaluation form.

    The history timeline only carries enough to draw a row; this is what an
    admin needs to actually review a flagged answer.
    """
    ratings = [
        {
            "field": field,
            "label": field[len("rating_"):].replace("_", " ").capitalize(),
            "value": getattr(decision, field, "") or "",
            "valueLabel": dict(VerificationDecision.Rating.choices).get(getattr(decision, field, ""), ""),
        }
        for field in VerificationDecision.RATING_FIELDS
        if getattr(decision, field, "")
    ]
    record = decision.token.employment_record if decision.token_id else None
    return {
        "id": str(decision.id),
        "decision": decision.decision,
        "decidedAt": decision.decided_at.isoformat(),
        "comment": decision.comment or "",
        "verifierName": decision.verifier_name or "",
        "verifierEmail": decision.verifier_email or "",
        "verifierPosition": decision.verifier_position or "",
        "invitedEmail": decision.invited_email or "",
        "flaggedForReview": decision.flagged_for_review,
        # Semicolon-joined soft checks recorded when the answer was submitted.
        "flagReasons": [part.strip() for part in (decision.flag_reason or "").split(";") if part.strip()],
        "verifiedEmployerName": decision.verified_employer_name or (record.employer_name_input if record else ""),
        "verifiedJobTitle": (
            decision.verified_job_title.name if decision.verified_job_title_id
            else (record.job_title_input if record else "")
        ),
        "evaluation": {
            "submitted": decision.evaluation_submitted,
            "submittedAt": decision.evaluation_submitted_at.isoformat() if decision.evaluation_submitted_at else None,
            "evaluatorName": decision.evaluator_name or "",
            "employeeStatus": dict(VerificationDecision.EmployeeStatus.choices).get(
                decision.employee_status, decision.employee_status or ""
            ),
            "employeeStatusOther": decision.employee_status_other or "",
            "yearsInCompany": decision.years_in_company,
            "educationalAttainment": decision.educational_attainment or "",
            "typeOfBusiness": decision.type_of_business or "",
            "dateOfEvaluation": decision.date_of_evaluation.isoformat() if decision.date_of_evaluation else None,
            "ratings": ratings,
            "strengths": decision.assessment_strengths or "",
            "improvements": decision.assessment_improvements or "",
        } if decision.evaluation_submitted else None,
    }


class AlumniEmployerDecisionsView(APIView):
    """Admin: every employer decision for one graduate, newest first.

    Backs the "Flagged for review" and "View evaluation" buttons in the history
    timeline. The flag is a soft check recorded at submission (answered from a
    different address than the invite, same device as the link, or within a
    minute of it) — it never blocked the answer, so an admin has to be able to
    read what the employer actually said.
    """
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, alumni_id):
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
        try:
            decisions = (
                VerificationDecision.objects
                .filter(token__alumni_id=alumni_id)
                .select_related("token__employment_record", "verified_job_title")
                .order_by("-decided_at")
            )
            payload = [_serialize_employer_decision(decision) for decision in decisions]
        except (OperationalError, DatabaseError):
            return _temporary_admin_data_unavailable_response("Employer decisions")
        return Response({"decisions": payload}, status=status.HTTP_200_OK)


class AlumniRetrackingHistoryView(APIView):
    """Admin: one graduate's retracking history, newest first.

    Registration, confirmations and reminders come from RetrackingEvent;
    employer confirmations and denials are read from VerificationDecision so
    they are never stored twice.
    """
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, alumni_id):
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
        # No AlumniAccount lookup up front: that row carries the face template
        # and took ~1.7 s of a ~2.7 s response over the Supabase pooler. Every
        # account has at least its registration event, so existence is only
        # checked when nothing is found.
        from tracer.models import EmploymentProfile

        from .models import RetrackingEvent

        status_labels = dict(EmploymentProfile.EmploymentStatusChoices.choices)

        def shown(field, value):
            value = value or ""
            return status_labels.get(value, value) if field == "employment_status" else value

        rows = []
        try:
            for event in RetrackingEvent.objects.filter(alumni_id=alumni_id):
                days = event.days_since_previous
                rows.append((event.occurred_at, {
                    "id": str(event.id),
                    "kind": event.kind,
                    "employmentStatus": shown("employment_status", event.employment_status),
                    "jobTitle": event.job_title,
                    "company": event.company,
                    "changes": [
                        {"field": c.get("field", ""), "from": shown(c.get("field"), c.get("from")), "to": shown(c.get("field"), c.get("to"))}
                        for c in (event.changes or []) if isinstance(c, dict)
                    ],
                    "daysSincePrevious": days,
                    "overdueDays": max(0, days - RETRACKING_THRESHOLD_DAYS) if days is not None else None,
                    "sentBy": event.sent_by,
                    "verifier": "",
                    "flagged": False,
                    "backfilled": event.is_backfilled,
                }))
            # Only the columns the timeline shows: a decision row also carries the
            # 17-field employer evaluation form.
            decisions = (
                VerificationDecision.objects.filter(token__alumni_id=alumni_id)
                .select_related("token__employment_record", "verified_job_title")
                .only(
                    "id", "decision", "decided_at", "verified_employer_name", "verifier_name",
                    "verifier_position", "flagged_for_review",
                    "token", "token__employment_record",
                    "token__employment_record__job_title_input", "token__employment_record__employer_name_input",
                    "verified_job_title", "verified_job_title__name",
                )
            )
            for decision in decisions:
                record = decision.token.employment_record if decision.token_id else None
                rows.append((decision.decided_at, {
                    "id": str(decision.id),
                    "kind": "employer_confirmed" if decision.decision == VerificationDecision.Decision.CONFIRM else "employer_denied",
                    "employmentStatus": "",
                    "jobTitle": (decision.verified_job_title.name if decision.verified_job_title_id else "")
                    or (record.job_title_input if record else ""),
                    "company": decision.verified_employer_name or (record.employer_name_input if record else ""),
                    "changes": [],
                    "daysSincePrevious": None,
                    "overdueDays": None,
                    "sentBy": "",
                    "verifier": ", ".join(filter(None, [decision.verifier_name, decision.verifier_position])),
                    "flagged": decision.flagged_for_review,
                    "backfilled": False,
                }))
            if not rows and not AlumniAccount.objects.filter(id=alumni_id).exists():
                return Response({"detail": "Graduate was not found."}, status=status.HTTP_404_NOT_FOUND)
        except (OperationalError, DatabaseError):
            return _temporary_admin_data_unavailable_response("Retracking history")

        rows.sort(key=lambda row: row[0], reverse=True)
        events = [{**payload, "occurredAt": when.isoformat()} for when, payload in rows]
        return Response(
            {
                "events": events,
                "summary": {
                    "confirmations": sum(1 for e in events if e["kind"] == "retraced"),
                    "lateConfirmations": sum(1 for e in events if e["kind"] == "retraced" and (e["overdueDays"] or 0) > 0),
                    "reminders": sum(1 for e in events if e["kind"] == "reminder"),
                    "employerDecisions": sum(1 for e in events if e["kind"].startswith("employer_")),
                },
            },
            status=status.HTTP_200_OK,
        )

def _send_rejection_email(*, to_email: str, recipient_name: str, reason: str, is_employer: bool, company_name: str = "") -> None:
    """Best-effort branded rejection email, sent in a background thread.

    The send runs off the request thread so the admin's "Reject" action
    returns immediately — important on hosts like Render where outbound SMTP
    is blocked and a synchronous send would otherwise hang for the full
    EMAIL_TIMEOUT before failing. Transport errors are logged and swallowed.
    """
    if not to_email:
        return

    template_base = "employer_rejected" if is_employer else "account_rejected"
    subject = (
        "Your employer registration was not approved"
        if is_employer
        else "Your graduate registration was not approved"
    )
    context = {
        "recipient_name": recipient_name or "",
        "reason": (reason or "").strip(),
        "company_name": company_name or "",
    }

    def _deliver() -> None:
        try:
            from .email_send import send_branded_email

            send_branded_email(
                to_email=to_email,
                subject=subject,
                template_base=template_base,
                context=context,
            )
        except Exception:
            logger.exception("Failed to send rejection email to %s", to_email)

    import threading

    threading.Thread(target=_deliver, daemon=True).start()

def _send_approval_email(*, to_email: str, recipient_name: str, is_employer: bool, company_name: str = "") -> None:
    """Best-effort branded approval email, sent in a background thread so the
    admin's "Approve" action returns immediately."""
    if not to_email:
        return

    template_base = "employer_approved" if is_employer else "account_approved"
    subject = (
        "Your employer account has been approved"
        if is_employer
        else "Your graduate account has been verified"
    )

    def _deliver() -> None:
        try:
            from django.conf import settings
            from .email_send import send_branded_email

            send_branded_email(
                to_email=to_email,
                subject=subject,
                template_base=template_base,
                context={
                    "recipient_name": recipient_name or "",
                    "company_name": company_name or "",
                    "login_url": getattr(settings, "GRADUATE_LOGIN_URL", "") or "",
                },
            )
        except Exception:
            logger.exception("Failed to send approval email to %s", to_email)

    import threading

    threading.Thread(target=_deliver, daemon=True).start()

class AlumniRequestRejectView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, alumni_id):
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
        alumni_account = AlumniAccount.objects.select_related("user", "master_record", "profile").filter(id=alumni_id).first()
        if not alumni_account:
            return Response(
                {"detail": "Graduate request was not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        reason = (request.data.get("reason") or "").strip()
        user = alumni_account.user
        to_email = user.email if user else ""

        # Kept as a rejected record with its reason, so the decision can be
        # audited. The email address is not locked: registering again with it
        # replaces the rejected account (see AlumniRegisterView).
        alumni_account.account_status = AccountStatus.REJECTED
        alumni_account.rejection_reason = reason
        alumni_account.profile_reviewed_at = timezone.now()
        alumni_account.save(update_fields=["account_status", "rejection_reason", "profile_reviewed_at", "updated_at"])
        payload = _admin_alumni_payload(alumni_account)

        _send_rejection_email(
            to_email=to_email,
            recipient_name=payload.get("name") or "",
            reason=reason,
            is_employer=False,
        )

        return Response(
            {
                "message": "Graduate request rejected.",
                "alumni": payload,
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

class MasterlistListView(APIView):
    """Admin: list all GraduateMasterRecord entries with totals + per-batch counts.

    Backs the batch-upload page's "current master list" tiles, which previously
    read a static frontend array and therefore showed 0.
    """
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
        from collections import Counter
        qs = GraduateMasterRecord.objects.all().order_by("batch_year", "full_name")
        # Whether each listed graduate has an account in the system: the
        # registration match (or a later re-match) links the account here.
        linked = dict(
            AlumniAccount.objects.filter(master_record__isnull=False)
            .values_list("master_record_id", "account_status")
        )
        entries = [
            {"id": str(r.id), "name": r.full_name, "graduationYear": r.batch_year,
             "accountStatus": linked.get(r.id), "isActive": r.is_active}
            for r in qs
        ]
        per_batch = Counter(e["graduationYear"] for e in entries if e["graduationYear"] is not None)
        return Response({
            "total": len(entries),
            "perBatch": [{"year": y, "count": c} for y, c in sorted(per_batch.items())],
            "entries": entries,
        })

MASTERLIST_MIN_YEAR = 2000


def _masterlist_max_year() -> int:
    """Next year's batch may be uploaded ahead of graduation."""
    from datetime import date

    return date.today().year + 1


def _looks_like_full_name(name: str) -> bool:
    """At least two words and at least one letter ("Total", "2021" and "(mo)" fail)."""
    import re as _re

    return len(name.split()) >= 2 and _re.search(r"[^\W\d_]", name) is not None


class MasterlistBulkCreateView(APIView):
    """Admin-only: bulk create GraduateMasterRecord entries from the batch-upload UI."""
    authentication_classes = []
    permission_classes = [AllowAny]  # TODO: restrict to admin once token auth is wired

    def post(self, request):
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
        entries = request.data.get("entries", [])
        if not isinstance(entries, list) or not entries:
            return Response({"detail": "entries list is required."}, status=status.HTTP_400_BAD_REQUEST)
        # All or nothing. A report CSV uploaded here by mistake once saved rows
        # such as "Avg Time-to-Hire (mo)" / batch 2 and "2021" / batch 6. Saving
        # the good rows of a file like that still means the file was wrong, so
        # one bad row refuses the whole upload and nothing is written.
        max_year = _masterlist_max_year()
        valid: list[tuple[str, int]] = []
        invalid: list[dict] = []
        seen: set[tuple[str, int]] = set()
        for position, entry in enumerate(entries, start=1):
            if not isinstance(entry, dict):
                invalid.append({"row": position, "name": "", "reason": "row is not an object"})
                continue
            name = " ".join(str(entry.get("name") or "").split())
            year = entry.get("graduation_year") or entry.get("graduationYear")
            if not name or not year:
                invalid.append({"row": position, "name": name, "reason": "missing name or graduation year"})
                continue
            try:
                year_int = int(year)
            except (TypeError, ValueError):
                invalid.append({"row": position, "name": name, "reason": f"invalid graduation year {year!r}"})
                continue
            if not (MASTERLIST_MIN_YEAR <= year_int <= max_year):
                invalid.append({
                    "row": position,
                    "name": name,
                    "reason": f"graduation year {year_int} is outside {MASTERLIST_MIN_YEAR}-{max_year}",
                })
                continue
            if not _looks_like_full_name(name):
                invalid.append({"row": position, "name": name, "reason": "name must be a full name (first and last)"})
                continue
            key = (name.lower(), year_int)
            if key in seen:
                invalid.append({"row": position, "name": name, "reason": "listed twice in this upload"})
                continue
            seen.add(key)
            valid.append((name, year_int))

        if invalid:
            preview = "; ".join(f"row {r['row']}: {r['reason']}" for r in invalid[:3])
            return Response(
                {
                    "detail": f"Upload refused, nothing was saved. {len(invalid)} invalid row(s): {preview}.",
                    "invalid": len(invalid),
                    "invalidRows": invalid[:50],
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        created = []
        duplicates = 0
        with transaction.atomic():
            for name, year_int in valid:
                # Registration matches the graduate's family name against
                # last_name exactly, so a wrong surname locks them out entirely.
                obj, was_created = GraduateMasterRecord.objects.get_or_create(
                    full_name__iexact=name,
                    batch_year=year_int,
                    defaults={"full_name": name, "last_name": derive_last_name(name), "batch_year": year_int},
                )
                if was_created:
                    created.append({"id": str(obj.id), "name": obj.full_name, "batch_year": obj.batch_year})
                else:
                    duplicates += 1
            # Link graduates who registered before these rows existed.
            rematched = 0
            if created:
                # Seeded graduates are skipped: they are fictional, and with the
                # ~500 simulated ones each upload spent ~1,000 pooler round
                # trips re-matching them.
                from tracer.employability import sample_q
                unmatched = AlumniAccount.objects.select_related("user").filter(master_record__isnull=True)
                for account in unmatched.exclude(sample_q()):
                    rematched += _refresh_master_match(account)
        return Response(
            {
                "created": len(created),
                "rematched": rematched,
                "duplicates": duplicates,
                "entries": created,
            },
            status=status.HTTP_201_CREATED,
        )


class MasterlistEntryView(APIView):
    """Admin: correct one masterlist row, retire it, or remove it outright.

    PATCH takes name, graduationYear and/or isActive. A corrected name or year
    changes who the row matches, so the matcher is re-run afterwards: a
    graduate who was waiting for approval can be activated by a fixed typo.

    DELETE only removes a row nothing is linked to. Deleting a linked row would
    set that graduate's master_record to NULL (users/models.py), silently
    turning them back into an unmatched registration, so those are refused and
    the admin is told to retire the row with isActive=false instead.
    """
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def patch(self, request, record_id):
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
        try:
            record = GraduateMasterRecord.objects.get(pk=record_id)
        except GraduateMasterRecord.DoesNotExist:
            return Response({"detail": "Masterlist entry was not found."}, status=status.HTTP_404_NOT_FOUND)

        fields: list[str] = []
        if "name" in request.data:
            name = " ".join(str(request.data.get("name") or "").split())
            if not _looks_like_full_name(name):
                return Response(
                    {"detail": "Name must be a full name (first and last)."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            record.full_name = name
            record.last_name = derive_last_name(name)
            fields += ["full_name", "last_name"]

        year = request.data.get("graduationYear", request.data.get("graduation_year"))
        if year is not None:
            try:
                year_int = int(year)
            except (TypeError, ValueError):
                return Response({"detail": f"Invalid graduation year {year!r}."}, status=status.HTTP_400_BAD_REQUEST)
            max_year = _masterlist_max_year()
            if not (MASTERLIST_MIN_YEAR <= year_int <= max_year):
                return Response(
                    {"detail": f"Graduation year must be between {MASTERLIST_MIN_YEAR} and {max_year}."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            record.batch_year = year_int
            fields.append("batch_year")

        if "isActive" in request.data or "is_active" in request.data:
            record.is_active = bool(request.data.get("isActive", request.data.get("is_active")))
            fields.append("is_active")

        if not fields:
            return Response(
                {"detail": "Send name, graduationYear or isActive."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        duplicate = GraduateMasterRecord.objects.filter(
            full_name__iexact=record.full_name, batch_year=record.batch_year,
        ).exclude(pk=record.pk).exists()
        if duplicate:
            return Response(
                {"detail": "Another masterlist entry already has that name and batch."},
                status=status.HTTP_409_CONFLICT,
            )

        rematched = 0
        with transaction.atomic():
            record.save(update_fields=[*fields, "updated_at"])
            if {"full_name", "batch_year"} & set(fields):
                from tracer.employability import sample_q

                unmatched = AlumniAccount.objects.select_related("user").filter(master_record__isnull=True)
                for account in unmatched.exclude(sample_q()):
                    rematched += _refresh_master_match(account)

        return Response(
            {
                "entry": {
                    "id": str(record.id),
                    "name": record.full_name,
                    "graduationYear": record.batch_year,
                    "isActive": record.is_active,
                },
                "rematched": rematched,
            },
            status=status.HTTP_200_OK,
        )

    def delete(self, request, record_id):
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
        try:
            record = GraduateMasterRecord.objects.get(pk=record_id)
        except GraduateMasterRecord.DoesNotExist:
            return Response({"detail": "Masterlist entry was not found."}, status=status.HTTP_404_NOT_FOUND)

        if AlumniAccount.objects.filter(master_record=record).exists():
            return Response(
                {"detail": "A graduate is registered against this entry. Retire it instead of deleting it."},
                status=status.HTTP_409_CONFLICT,
            )
        record.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

# region DEBUG-ONLY:CurrenChanDebug
# ─────────────────────────────────────────────────────────────────────────────
# DEBUG-ONLY ADMIN ACCOUNT CRUD — CurrenChanDebug
# ─────────────────────────────────────────────────────────────────────────────
# This block is a TEMPORARY admin convenience for debugging seeded data. It is
# NOT part of the product spec. To remove cleanly:
#   grep -RnE 'DEBUG-ONLY:CurrenChanDebug' backend/ frontend/
#   …then delete each fenced region (the matching # endregion line in this
#   file, the matching block in users/urls.py, and the frontend counterpart).
#
# AGENT GUIDANCE: When generating documentation, DFDs, use-case diagrams,
# user manuals, or any system-wide write-up, OMIT this entire block and its
# corresponding endpoints/UI. Treat it as if it does not exist for spec
# purposes — it's a maintenance hatch, not a feature.
# ─────────────────────────────────────────────────────────────────────────────

from .demo_accounts import delete_demo_accounts, demo_accounts_payload, is_demo_account, reset_demo_accounts


class DebugAccountListView(APIView):
    """List all accounts across roles for debug purposes."""
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
        from tracer.employability import is_sample_account

        alumni_rows = []
        accounts = (
            AlumniAccount.objects.select_related("user", "profile", "master_record")
            .prefetch_related(Prefetch(
                "employment_profiles",
                queryset=EmploymentProfile.objects.order_by("-updated_at"),
                to_attr="_prefetched_emp",
            ))
            .order_by("-created_at")
        )
        for acc in accounts:
            profile = getattr(acc, "profile", None)
            full_name = ""
            if profile:
                full_name = " ".join(
                    p for p in [profile.first_name, profile.middle_name, profile.last_name] if p
                ).strip()
            if not full_name and acc.master_record:
                full_name = acc.master_record.full_name or ""
            emp = _first_prefetched(acc, "_prefetched_emp")
            alumni_rows.append({
                "role": "alumni",
                "id": str(acc.id),
                "userId": str(acc.user_id) if acc.user_id else None,
                "email": acc.user.email if acc.user else "",
                "name": full_name,
                "firstName": getattr(profile, "first_name", "") or "",
                "middleName": getattr(profile, "middle_name", "") or "",
                "lastName": getattr(profile, "last_name", "") or "",
                "graduationYear": getattr(profile, "graduation_year", None),
                "employmentStatus": (emp.employment_status if emp else "") or "",
                "isSample": is_sample_account(acc),
                "status": acc.account_status,
                "createdAt": acc.created_at.isoformat() if acc.created_at else None,
            })

        employer_rows = []
        for acc in EmployerAccount.objects.select_related("user").order_by("-created_at"):
            employer_rows.append({
                "role": "employer",
                "id": str(acc.id),
                "userId": str(acc.user_id) if acc.user_id else None,
                "email": acc.company_email,
                "name": acc.company_name,
                "status": acc.account_status,
                "createdAt": acc.created_at.isoformat() if acc.created_at else None,
            })

        admin_rows = []
        for cred in AdminCredential.objects.select_related("user").order_by("-created_at"):
            admin_rows.append({
                "role": "admin",
                "id": str(cred.id),
                "userId": str(cred.user_id) if cred.user_id else None,
                "email": cred.admin_email,
                "name": cred.admin_email,
                "status": "active" if cred.is_active else "inactive",
                "createdAt": cred.created_at.isoformat() if cred.created_at else None,
            })

        return Response({
            "alumni": alumni_rows,
            "employer": employer_rows,
            "admin": admin_rows,
        }, status=status.HTTP_200_OK)

_DEBUG_EMPLOYMENT_STATUSES = {
    "employed_full_time", "employed_part_time", "self_employed", "seeking", "not_seeking", "never_employed",
}


class DebugAlumniUpdateView(APIView):
    """Edit a graduate's name, email, batch, account status or employment
    status from /admin/debug/a. Goes through the same model constraints as the
    real pages; no survey answers are recomputed."""
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def patch(self, request, account_id):
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
        account = AlumniAccount.objects.select_related("user", "profile").filter(id=account_id).first()
        if not account:
            return Response({"detail": "Graduate account not found."}, status=status.HTTP_404_NOT_FOUND)

        data = request.data if isinstance(request.data, dict) else {}
        errors: dict[str, str] = {}
        user_fields: list[str] = []
        account_fields: list[str] = []
        profile_changes: dict = {}

        if "email" in data:
            email = str(data.get("email") or "").strip().lower()
            try:
                validate_email(email)
            except DjangoValidationError:
                errors["email"] = "Enter a valid email address."
            else:
                if User.objects.filter(email__iexact=email).exclude(id=account.user_id).exists():
                    errors["email"] = "Another account already uses this email."
                elif email != account.user.email:
                    account.user.email = email
                    user_fields.append("email")

        if "status" in data:
            value = str(data.get("status") or "")
            if value not in AccountStatus.values:
                errors["status"] = f"Status must be one of {', '.join(AccountStatus.values)}."
            elif value != account.account_status:
                account.account_status = value
                account_fields.append("account_status")

        for key, field in (("firstName", "first_name"), ("middleName", "middle_name"), ("lastName", "last_name")):
            if key in data:
                value = str(data.get(key) or "").strip()
                if any(ch.isdigit() for ch in value):
                    errors[key] = "Names cannot contain numbers."
                elif field != "middle_name" and not value:
                    errors[key] = "Required."
                else:
                    profile_changes[field] = value

        if "graduationYear" in data:
            try:
                year = int(data.get("graduationYear"))
            except (TypeError, ValueError):
                errors["graduationYear"] = "Enter a year."
            else:
                if not 1990 <= year <= timezone.now().year:
                    errors["graduationYear"] = f"Year must be between 1990 and {timezone.now().year}."
                else:
                    profile_changes["graduation_year"] = year

        employment_status = None
        if "employmentStatus" in data:
            employment_status = str(data.get("employmentStatus") or "")
            if employment_status not in _DEBUG_EMPLOYMENT_STATUSES:
                errors["employmentStatus"] = "Unknown employment status."

        if errors:
            return Response({"detail": "Some values were not accepted.", "field_errors": errors},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                if user_fields:
                    account.user.save(update_fields=user_fields)
                if account_fields:
                    account.save(update_fields=[*account_fields, "updated_at"])
                if profile_changes:
                    AlumniProfile.objects.update_or_create(alumni=account, defaults=profile_changes)
                    if {"first_name", "last_name", "graduation_year"} & profile_changes.keys():
                        _refresh_master_match(account, relink=True)
                if employment_status is not None:
                    EmploymentProfile.objects.update_or_create(
                        alumni=account, defaults={"employment_status": employment_status},
                    )
        except (DatabaseError, OperationalError) as exc:
            return Response({"detail": f"Database error: {exc}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        from tracer import employability
        employability.clear_frame_caches()
        return Response({"updated": True, "id": str(account.id)}, status=status.HTTP_200_OK)


class DebugAnalyticsSettingsView(APIView):
    """GET/PUT the analytics source (real or simulated graduates) and whether
    simulated accounts appear in Verified Graduates, with counts and each
    source's active model so the debug page can show what a switch changes."""
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    @staticmethod
    def _payload() -> dict:
        from tracer import employability

        active_accounts = AlumniAccount.objects.filter(account_status=AccountStatus.ACTIVE)
        models = {}
        for source in employability.SOURCES:
            active = employability.load_active_model(source)
            models[source] = (
                {"version": active["version"], "trainedAt": active["meta"].get("trained_at"),
                 "auc": (active["meta"].get("metrics") or {}).get("cv_auc_mean")}
                if active else None
            )
        return {
            **employability.debug_settings(),
            "counts": {
                "real": employability.filter_source(active_accounts, employability.SOURCE_REAL).count(),
                "simulated": employability.filter_source(active_accounts, employability.SOURCE_SIMULATED).count(),
            },
            "models": models,
            "commands": {
                "seed": "python manage.py seed_simulated_graduates --seed 20260918",
                "train": "python manage.py train_employability_model --source simulated-accounts --activate",
            },
        }

    def get(self, request):
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
        return Response(self._payload(), status=status.HTTP_200_OK)

    def put(self, request):
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
        from tracer import employability

        data = request.data if isinstance(request.data, dict) else {}
        changes = {
            k: data[k] for k in ("source", "show_samples_in_verified", "allow_current_year_graduates") if k in data
        }
        try:
            employability.update_debug_settings(**changes)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except OSError as exc:
            return Response({"detail": f"Could not save the setting: {exc}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        employability.clear_frame_caches()
        return Response(self._payload(), status=status.HTTP_200_OK)


class DebugSimulatedAccountsDeleteView(APIView):
    """Delete every seeded simulated graduate (and their users) in one go."""
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
        from tracer import employability

        try:
            with transaction.atomic():
                user_ids = list(
                    AlumniAccount.objects.filter(employability.sample_q())
                    .exclude(employability.demo_q())
                    .values_list("user_id", flat=True)
                )
                User.objects.filter(id__in=user_ids).delete()
        except (DatabaseError, OperationalError) as exc:
            return Response({"detail": f"Database error: {exc}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        employability.clear_frame_caches()
        return Response({"deleted": len(user_ids)}, status=status.HTTP_200_OK)


class DebugDemoAccountsView(APIView):
    """The demo graduates on /admin/debug/a, one per UI state (see
    users/demo_accounts.py). GET lists them, POST recreates all of them in
    their starting state, DELETE removes them."""
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
        return Response({"accounts": demo_accounts_payload()}, status=status.HTTP_200_OK)

    def post(self, request):
        admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
        try:
            reset_demo_accounts(getattr(admin_user, "email", ""))
        except (DatabaseError, OperationalError) as exc:
            return Response({"detail": f"Database error: {exc}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return Response({"accounts": demo_accounts_payload()}, status=status.HTTP_200_OK)

    def delete(self, request):
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
        try:
            deleted = delete_demo_accounts()
        except (DatabaseError, OperationalError) as exc:
            return Response({"detail": f"Database error: {exc}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return Response({"deleted": deleted, "accounts": demo_accounts_payload()}, status=status.HTTP_200_OK)


class DebugDemoOpenView(APIView):
    """Give the admin's browser a graduate session for one demo graduate, to
    show the graduate side of a state. Demo accounts have no password or face,
    so this is their only way in; real graduates are refused."""
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, account_id):
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
        account = _alumni_dashboard_queryset(AlumniAccount.objects.filter(id=account_id)).first()
        if not account or not is_demo_account(account):
            return Response({"detail": "Only demo graduates can be opened."}, status=status.HTTP_404_NOT_FOUND)
        return Response(
            {
                "alumni": _session_payload_from_alumni(account),
                "accessToken": _generate_alumni_access_token(account.user_id),
                "tokenType": "Bearer",
                "expiresIn": _ALUMNI_TOKEN_TTL_SECONDS,
            },
            status=status.HTTP_200_OK,
        )


class DebugAccountDeleteView(APIView):
    """Delete a single account by role + id. Cascades through FK on User."""
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def delete(self, request, role: str, account_id):
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error
        role = (role or "").strip().lower()
        if role not in {"alumni", "employer", "admin"}:
            return Response({"detail": "role must be alumni, employer, or admin."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            if role == "alumni":
                target = AlumniAccount.objects.select_related("user").filter(id=account_id).first()
                if not target:
                    return Response({"detail": "Alumni account not found."}, status=status.HTTP_404_NOT_FOUND)
                user = target.user
                target.delete()
                if user:
                    user.delete()
            elif role == "employer":
                target = EmployerAccount.objects.select_related("user").filter(id=account_id).first()
                if not target:
                    return Response({"detail": "Employer account not found."}, status=status.HTTP_404_NOT_FOUND)
                user = target.user
                target.delete()
                if user:
                    user.delete()
            else:  # admin
                target = AdminCredential.objects.select_related("user").filter(id=account_id).first()
                if not target:
                    return Response({"detail": "Admin credential not found."}, status=status.HTTP_404_NOT_FOUND)
                user = target.user
                target.delete()
                if user and not (user.is_superuser):  # safety: never auto-delete a superuser
                    user.delete()
        except (DatabaseError, OperationalError) as exc:
            return Response({"detail": f"Database error: {exc}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response({"deleted": True, "role": role, "id": str(account_id)}, status=status.HTTP_200_OK)


# ─────────────────────────────────────────────────────────────────────────────
# FACE / LIVENESS DEBUG HARNESS — CurrenChanDebug
# ─────────────────────────────────────────────────────────────────────────────
# Backs /admin/debug/face. Lets a maintainer enrol a throwaway face and measure
# a real match distance without pushing a fake graduate through the whole
# registration survey.
#
# Deliberately reuses _resolve_reference_descriptors and _verify_descriptor_match
# — the exact functions AlumniLoginView calls — so the number this reports is
# the number production would compute. A separate comparison path here would
# make the tool actively misleading.
# ─────────────────────────────────────────────────────────────────────────────

DEBUG_FACE_EMAIL_DOMAIN = "debug.local"
DEBUG_FACE_PASSWORD = "DebugFace123!"


def _is_debug_face_account(account: AlumniAccount) -> bool:
    """Both markers must agree before anything here will touch a row."""
    template = _safe_json_loads(account.biometric_template)
    email = (getattr(account.user, "email", "") or "").lower()
    return bool(template.get("is_debug")) and email.endswith(f"@{DEBUG_FACE_EMAIL_DOMAIN}")


class DebugFaceAccountView(APIView):
    """Create a throwaway graduate to enrol a face against, or purge them all."""

    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error

        stamp = timezone.now().strftime("%Y%m%d%H%M%S")
        email = f"facetest+{stamp}@{DEBUG_FACE_EMAIL_DOMAIN}"
        try:
            user = User.objects.create_user(
                email=email, password=DEBUG_FACE_PASSWORD, role=User.Role.ALUMNI,
            )
            account = AlumniAccount.objects.create(
                user=user,
                # ACTIVE so the login path is reachable; PENDING would bail out
                # before the face comparison and defeat the purpose.
                account_status=AccountStatus.ACTIVE,
                # Not a real graduate, so keep it out of Profile Review.
                profile_reviewed_at=timezone.now(),
                biometric_template=json.dumps({"is_debug": True}),
            )
        except (DatabaseError, OperationalError) as exc:
            return Response({"detail": f"Database error: {exc}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(
            {
                "id": str(account.id),
                "email": email,
                "password": DEBUG_FACE_PASSWORD,
                "status": account.account_status,
            },
            status=status.HTTP_201_CREATED,
        )

    def delete(self, request):
        """Purge every debug face account. Requires BOTH markers to match."""
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error

        removed = 0
        try:
            for account in AlumniAccount.objects.select_related("user").all():
                if not _is_debug_face_account(account):
                    continue
                user = account.user
                account.delete()
                if user and not user.is_superuser:
                    user.delete()
                removed += 1
        except (DatabaseError, OperationalError) as exc:
            return Response({"detail": f"Database error: {exc}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response({"deleted": removed}, status=status.HTTP_200_OK)


class DebugFaceEnginesView(APIView):
    """What engines this build can actually run, for the debug page selector."""

    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error

        rows = []
        for name in ("faceapi", "insightface", "compreface"):
            engine = face_engines.engine_for(name)
            available, reason = _debug_engine_availability(engine)
            rows.append(
                {
                    "name": engine.name,
                    "dimensions": engine.dimensions,
                    "threshold": engine.distance_threshold,
                    "metric": "euclidean" if engine.name == "faceapi" else "cosine",
                    "runsInBrowser": engine.requires_client_descriptor,
                    "available": available,
                    "reason": reason,
                }
            )
        return Response(
            {"engines": rows, "serverDefault": get_engine().name},
            status=status.HTTP_200_OK,
        )


def _debug_engine_availability(engine) -> tuple[bool, str]:
    """
    Can this engine be used right now, without actually invoking it.

    Cheap checks only -- the selector is rendered on page load and must not
    block on a model download or a request to a CompreFace container that may
    not be running.
    """
    if engine.name == "faceapi":
        return True, "Runs in the browser; always available."
    if engine.name == "insightface":
        try:
            import insightface  # noqa: F401
        except ImportError:
            return False, "pip install -r requirements-insightface.txt"
        return True, "Installed. First use downloads the model pack."
    if engine.name == "compreface":
        if not getattr(engine, "api_key", ""):
            return False, "Set COMPREFACE_RECOGNITION_KEY (local only)."
        return True, f"Will call {engine.base_url}"
    return False, "Unknown engine."


def _debug_engine_from_request(request):
    """
    Engine for THIS request, chosen by the debug page rather than the server
    default. The whole point of the page is comparing engines against the same
    face, which an env var and a container restart cannot do.
    """
    requested = (request.data.get("engine") or "").strip().lower()
    if not requested:
        return get_engine()
    return face_engines.engine_for(requested)


def _debug_engine_templates(account: AlumniAccount) -> dict:
    template = _safe_json_loads(account.biometric_template)
    engines = template.get("engines") if isinstance(template, dict) else None
    return engines if isinstance(engines, dict) else {}


class DebugFaceEnrolView(APIView):
    """
    Enrol a face under ONE named engine.

    Templates are stored per engine, so the same face can be enrolled under all
    three and their distances compared directly. That is the comparison this
    page exists to make, and it is why enrolment here does not overwrite a
    single shared descriptor the way registration does.
    """

    # Multipart: the server-side engines need the IMAGE, since the browser
    # cannot produce an ArcFace embedding. face-api still sends its descriptor.
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, account_id):
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error

        account = AlumniAccount.objects.select_related("user").filter(id=account_id).first()
        if not account:
            return Response({"detail": "Account not found."}, status=status.HTTP_404_NOT_FOUND)
        if not _is_debug_face_account(account):
            # Never let a debug tool overwrite a real graduate's biometrics.
            return Response(
                {"detail": "Not a debug face account."}, status=status.HTTP_403_FORBIDDEN,
            )

        try:
            engine = _debug_engine_from_request(request)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        # Multi-angle enrolment.
        #
        # One frontal frame gives one reference vector, so a login taken at a
        # slightly different angle has nothing close to match against. Enrolling
        # a short yaw sweep gives several references and the best of them wins,
        # which is why banking apps ask you to turn your head rather than just
        # hold still.
        #
        # The IMAGES are kept as well as the vectors, and not only for audit: an
        # engine change invalidates every stored embedding, and having the
        # original frames means everyone can be re-enrolled offline instead of
        # being asked back in person.
        image_files = request.FILES.getlist("face_images")
        if not image_files and "face_image" in request.FILES:
            image_files = [request.FILES["face_image"]]
        image_blobs = [f.read() for f in image_files]
        # Counted so a failure can report what actually happened instead of
        # concluding "no usable embedding" and leaving the cause to guesswork.
        frames_rejected = 0

        # Per-sample capture metadata (yaw at capture time), client-attested and
        # stored for display only.
        sample_meta = _safe_json_loads(request.data.get("sample_meta"))
        if not isinstance(sample_meta, list):
            sample_meta = []

        try:
            if engine.requires_client_descriptor:
                # Browser engine: the vectors were computed client-side and the
                # frames are only kept for re-enrolment later.
                samples = _parse_face_descriptor_samples(
                    request.data.get("face_descriptor_samples"), engine.dimensions
                )
                single = _parse_face_descriptor(
                    request.data.get("face_descriptor"), engine.dimensions
                )
                if single and single not in samples:
                    samples.append(single)
            else:
                # Server engine: embed every frame we were given. A frame the
                # detector cannot use is skipped rather than failing the whole
                # enrolment -- a sweep will always include some bad angles.
                samples = []
                for blob in image_blobs:
                    embedding = engine.embed(image_bytes=blob)
                    if embedding:
                        samples.append(embedding)
                    else:
                        frames_rejected += 1
        except RuntimeError as exc:
            # Missing optional dependency or unreachable service. Report it as
            # configuration rather than a face problem.
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        descriptor = engine.average(samples) if samples else None
        if descriptor is None:
            if engine.requires_client_descriptor:
                reason = (
                    "This engine embeds in the browser and no valid "
                    f"{engine.dimensions}-float descriptor arrived."
                )
            elif not image_blobs:
                reason = "No frames were uploaded; this engine embeds server-side."
            else:
                reason = (
                    f"{len(image_blobs)} frame(s) uploaded, none contained a face the "
                    "detector could use. The usual cause is the face filling the frame "
                    "-- the detector needs margin around it, so move further from the "
                    "camera. Poor light and heavy motion blur do it too."
                )
            return Response(
                {
                    "detail": f"No usable {engine.dimensions}-d embedding for {engine.name}. {reason}",
                    "engine": engine.name,
                    "framesSupplied": len(image_blobs),
                    "framesRejected": frames_rejected,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not samples:
            samples = [descriptor]

        template = _safe_json_loads(account.biometric_template)
        engines = template.get("engines")
        if not isinstance(engines, dict):
            engines = {}
        engines[engine.name] = {
            "face_descriptor": descriptor,
            "face_descriptor_samples": samples,
            "sample_meta": sample_meta[: len(samples)],
            "frames_supplied": len(image_blobs),
            "dimensions": engine.dimensions,
            "enrolled_at": timezone.now().isoformat(),
        }
        template.update({"is_debug": True, "engines": engines})
        account.biometric_template = json.dumps(template)
        account.save(update_fields=["biometric_template"])

        return Response(
            {
                "enrolled": True,
                "engine": engine.name,
                "dimensions": engine.dimensions,
                "samples": len(samples),
                # How many frames were sent versus how many produced a usable
                # embedding -- the gap is the honest measure of how well this
                # engine coped with the angles in the sweep.
                "framesSupplied": len(image_blobs),
                "framesUsed": len(samples) if not engine.requires_client_descriptor else None,
                "enrolledEngines": sorted(engines.keys()),
            },
            status=status.HTTP_200_OK,
        )


class DebugFaceVerifyView(APIView):
    """Compare a fresh capture against the template enrolled under one engine."""

    parser_classes = [MultiPartParser, FormParser, JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, account_id):
        _admin_user, _auth_error = _require_admin(request)
        if _auth_error:
            return _auth_error

        account = AlumniAccount.objects.select_related("user").filter(id=account_id).first()
        if not account:
            return Response({"detail": "Account not found."}, status=status.HTTP_404_NOT_FOUND)

        try:
            engine = _debug_engine_from_request(request)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        stored = _debug_engine_templates(account).get(engine.name)
        if not stored:
            return Response(
                {
                    "detail": f"Nothing enrolled under {engine.name} yet on this account.",
                    "engine": engine.name,
                },
                status=status.HTTP_409_CONFLICT,
            )

        references = _parse_face_descriptor_samples(
            stored.get("face_descriptor_samples"), engine.dimensions
        )
        primary = _parse_face_descriptor(stored.get("face_descriptor"), engine.dimensions)
        if primary and primary not in references:
            references.append(primary)
        if not references:
            return Response(
                {"detail": f"Stored {engine.name} template is unreadable."},
                status=status.HTTP_409_CONFLICT,
            )

        # Accept both field names. The client sends `face_images` since
        # enrolment became multi-frame; reading only the old singular
        # `face_image` here meant verify received NO image at all, so every
        # server-side engine reported "no usable embedding" while face-api --
        # which uses the client descriptor and never looks at the image --
        # carried on working and hid the breakage.
        image_files = request.FILES.getlist("face_images")
        if not image_files and "face_image" in request.FILES:
            image_files = [request.FILES["face_image"]]
        image_bytes = image_files[0].read() if image_files else None

        try:
            probe = engine.embed(
                image_bytes=image_bytes,
                client_descriptor=_parse_face_descriptor(
                    request.data.get("face_descriptor"), engine.dimensions
                ),
            )
        except RuntimeError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        if probe is None:
            if engine.requires_client_descriptor:
                why = "no valid client descriptor arrived."
            elif not image_files:
                why = "no frame was uploaded; this engine embeds server-side."
            else:
                why = (
                    "the uploaded frame contained no face the detector could use. "
                    "Most often the face fills the frame -- the detector needs margin "
                    "around it, so move further from the camera."
                )
            return Response(
                {
                    "detail": f"No usable {engine.dimensions}-d embedding for {engine.name}: {why}",
                    "engine": engine.name,
                    "framesSupplied": len(image_files),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        result = engine.compare(probe, references)
        return Response(
            {
                "isMatch": result.is_match,
                "distance": round(result.distance, 4),
                "similarity": round(result.similarity, 4),
                "threshold": engine.distance_threshold,
                "referenceCount": result.reference_count,
                "engine": result.engine,
                "dimensions": engine.dimensions,
                "metric": "euclidean" if engine.name == "faceapi" else "cosine",
            },
            status=status.HTTP_200_OK,
        )



# endregion DEBUG-ONLY:CurrenChanDebug
