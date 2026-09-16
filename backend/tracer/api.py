import json
import re
from datetime import date, timedelta

from django.core import signing
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.signing import BadSignature, SignatureExpired
from django.core.validators import validate_email
from django.db import transaction
from django.db import DatabaseError, OperationalError
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from users.auth import require_admin, require_alumni
from users.models import AccountStatus, EmployerAccount, User

from django.db.models import Q

from .geo_lookup import GeoLookupError, resolve_location, reverse_geocode
from .models import (
    Barangay,
    CityMunicipality,
    EmploymentRecord,
    Industry,
    JobTitle,
    Province,
    Region,
    Skill,
    SkillCategory,
    VerificationDecision,
    VerificationToken,
)

# ── Helpers ────────────────────────────────────────────────────────────────────

_VERIFICATION_TOKEN_DEFAULT_TTL_DAYS = 7
# Concurrent live links per employment record. Several verifiers may hold one
# at once (HR plus a direct supervisor), but not without limit.
_VERIFICATION_MAX_LIVE_LINKS = 5
_COMPANY_STOP_WORDS = {
    "philippines",
    "corp",
    "corporation",
    "inc",
    "ltd",
    "co",
    "company",
    "ph",
    "the",
    "and",
    "of",
}

def _database_unavailable_response() -> Response:
    return Response(
        {
            "detail": "Database is temporarily unavailable. Please try again.",
            "retryable": True,
        },
        status=status.HTTP_503_SERVICE_UNAVAILABLE,
    )

def _extract_bearer_token(request) -> str:
    header = request.headers.get("Authorization") or ""
    if not header.lower().startswith("bearer "):
        return ""
    return header[7:].strip()

def _serialize_skill(s) -> dict:
    return {
        "id": str(s.id),
        "name": s.name,
        "category": str(s.category_id) if s.category_id else None,
        "category_name": s.category.name if s.category else None,
        "is_active": s.is_active,
    }

def _serialize_category(c) -> dict:
    return {
        "id": str(c.id),
        "name": c.name,
        "is_active": c.is_active,
    }

def _serialize_industry(i) -> dict:
    return {
        "id": str(i.id),
        "name": i.name,
        "is_active": i.is_active,
    }

def _serialize_job_title(j) -> dict:
    return {
        "id": str(j.id),
        "name": j.name,
        "industry": str(j.industry_id) if j.industry_id else None,
        "industry_name": j.industry.name if j.industry else None,
        "is_active": j.is_active,
    }

def _serialize_region(r) -> dict:
    return {
        "id": str(r.id),
        "code": r.code,
        "name": r.name,
        "psgc_id": r.psgc_id or "",
        "is_active": r.is_active,
    }

def _serialize_province(p: Province) -> dict:
    return {
        "id": str(p.id),
        "region_id": str(p.region_id),
        "region_name": p.region.name if p.region_id else None,
        "name": p.name,
        "psgc_id": p.psgc_id,
        "is_active": p.is_active,
    }

def _serialize_city(c: CityMunicipality) -> dict:
    return {
        "id": str(c.id),
        "region_id": str(c.region_id),
        "region_name": c.region.name if c.region_id else None,
        "province_id": str(c.province_id) if c.province_id else None,
        "province_name": c.province.name if c.province_id else None,
        # Set only for highly urbanized cities: the province they sit inside,
        # which is where the dropdown lists them.
        "home_province_id": str(c.home_province_id) if c.home_province_id else None,
        "home_province_name": c.home_province.name if c.home_province_id else None,
        "name": c.name,
        "psgc_id": c.psgc_id,
        "is_city": c.is_city,
        "is_active": c.is_active,
    }

def _serialize_employment_record(record: EmploymentRecord | None) -> dict:
    if not record:
        return {}

    return {
        "id": str(record.id),
        "employmentStatus": record.employment_status,
        "verificationStatus": record.verification_status,
        "employerName": record.employer_name_input,
        "jobTitle": record.job_title_input,
        "jobTitleId": str(record.job_title_id) if record.job_title_id else None,
        "jobTitleName": record.job_title.name if record.job_title else None,
        "workLocation": record.work_location,
        "regionId": str(record.region_id) if record.region_id else None,
        "regionName": record.region.name if record.region else None,
        "isCurrent": record.is_current,
        "updatedAt": record.updated_at.isoformat(),
    }

def _serialize_verification_token(token: VerificationToken) -> dict:
    return {
        "id": str(token.token_id),
        "status": token.status,
        "expiresAt": token.expires_at.isoformat(),
        "usedAt": token.used_at.isoformat() if token.used_at else None,
        "alumniId": str(token.alumni_id),
        "employmentRecordId": str(token.employment_record_id) if token.employment_record_id else None,
        "createdAt": token.created_at.isoformat(),
    }

def _serialize_verification_decision(decision: VerificationDecision) -> dict:
    return {
        "id": str(decision.id),
        "decision": decision.decision,
        "comment": decision.comment,
        "verifiedEmployerName": decision.verified_employer_name,
        "verifiedJobTitleId": str(decision.verified_job_title_id) if decision.verified_job_title_id else None,
        "verifiedJobTitleName": decision.verified_job_title.name if decision.verified_job_title else None,
        "decidedAt": decision.decided_at.isoformat(),
        # Null for link-based decisions, which have no employer account.
        "employerId": str(decision.employer_account_id) if decision.employer_account_id else None,
        "verifierName": decision.verifier_name,
        "verifierEmail": decision.verifier_email,
        "verifierPosition": decision.verifier_position,
        "flaggedForReview": decision.flagged_for_review,
        "flagReason": decision.flag_reason,
        "isHeld": decision.is_held,
        "heldActivatedAt": decision.held_activated_at.isoformat() if decision.held_activated_at else None,
        "evaluationSubmitted": decision.evaluation_submitted,
        "evaluationSubmittedAt": decision.evaluation_submitted_at.isoformat() if decision.evaluation_submitted_at else None,
    }

def _extract_evaluation_payload(request) -> tuple[dict | None, str | None]:
    """Validate and shape the Employer's Confidential Feedback Form payload.

    Returns (kwargs, error_message):
      - (None, None) when no evaluation is being submitted (caller leaves eval columns blank).
      - (kwargs, None) when a complete, valid eval was submitted.
      - (None, "...") when the eval is partial or invalid; caller returns 400.
    """
    data = request.data
    evaluator_name = str(data.get("evaluator_name") or "").strip()
    if not evaluator_name:
        return None, None

    employee_status = str(data.get("employee_status") or "").strip()
    if employee_status not in VerificationDecision.EmployeeStatus.values:
        return None, "employee_status must be one of: regular, probationary_casual_jo, other."

    valid_ratings = set(VerificationDecision.Rating.values)
    rating_values: dict[str, str] = {}
    for field in VerificationDecision.RATING_FIELDS:
        value = str(data.get(field) or "").strip()
        if value not in valid_ratings:
            return None, f"{field} must be one of: {', '.join(sorted(valid_ratings))}."
        rating_values[field] = value

    strengths = str(data.get("assessment_strengths") or "").strip()
    improvements = str(data.get("assessment_improvements") or "").strip()
    if not strengths or not improvements:
        return None, "Both assessment_strengths and assessment_improvements are required."
    _MAX_TEXT = 5000
    if len(strengths) > _MAX_TEXT or len(improvements) > _MAX_TEXT:
        return None, f"Assessment answers must be at most {_MAX_TEXT} characters each."

    years_in_company_raw = data.get("years_in_company")
    years_in_company: int | None = None
    if years_in_company_raw not in (None, ""):
        try:
            parsed = int(years_in_company_raw)
        except (TypeError, ValueError):
            return None, "years_in_company must be a non-negative integer."
        if parsed < 0:
            return None, "years_in_company must be a non-negative integer."
        years_in_company = parsed

    date_of_evaluation_raw = str(data.get("date_of_evaluation") or "").strip()
    date_of_evaluation: date | None = None
    if date_of_evaluation_raw:
        try:
            date_of_evaluation = date.fromisoformat(date_of_evaluation_raw)
        except ValueError:
            return None, "date_of_evaluation must be ISO date (YYYY-MM-DD)."

    kwargs: dict = {
        "evaluator_name": evaluator_name,
        "employee_status": employee_status,
        "employee_status_other": str(data.get("employee_status_other") or "").strip(),
        "years_in_company": years_in_company,
        "educational_attainment": str(data.get("educational_attainment") or "").strip(),
        "marital_status": str(data.get("marital_status") or "").strip(),
        "type_of_business": str(data.get("type_of_business") or "").strip(),
        "date_of_evaluation": date_of_evaluation,
        "assessment_strengths": strengths,
        "assessment_improvements": improvements,
        "evaluation_submitted": True,
        "evaluation_submitted_at": timezone.now(),
    }
    kwargs.update(rating_values)
    return kwargs, None

def _split_company_keywords(value: str) -> list[str]:
    normalized = re.sub(r"[^a-z0-9]+", " ", (value or "").strip().lower()).strip()
    if not normalized:
        return []
    return [
        word
        for word in normalized.split()
        if len(word) >= 4 and word not in _COMPANY_STOP_WORDS
    ]

def _companies_match(employer_company: str, graduate_company: str) -> bool:
    employer_value = (employer_company or "").strip().lower()
    graduate_value = (graduate_company or "").strip().lower()

    if not employer_value or not graduate_value:
        return False

    if employer_value in graduate_value or graduate_value in employer_value:
        return True

    employer_words = _split_company_keywords(employer_value)
    graduate_words = _split_company_keywords(graduate_value)
    if not employer_words or not graduate_words:
        return False

    return any(
        employer_word in graduate_word or graduate_word in employer_word
        for employer_word in employer_words
        for graduate_word in graduate_words
    )

def _build_alumni_name(record: EmploymentRecord) -> str:
    alumni = record.alumni
    profile = getattr(alumni, "profile", None)
    if profile:
        full_name = " ".join(
            part.strip()
            for part in [profile.first_name, profile.middle_name, profile.last_name]
            if part and part.strip()
        ).strip()
        if full_name:
            return full_name

    if alumni.master_record_id and alumni.master_record:
        return alumni.master_record.full_name

    return alumni.user.email

def _resolve_graduation_year(record: EmploymentRecord) -> int | None:
    alumni = record.alumni
    profile = getattr(alumni, "profile", None)
    if profile and profile.graduation_year:
        return int(profile.graduation_year)
    if alumni.master_record_id and alumni.master_record:
        return int(alumni.master_record.batch_year)
    return None

def _serialize_employer_verifiable_graduate(record: EmploymentRecord) -> dict:
    alumni = record.alumni
    face_scans = [
        scan
        for scan in alumni.face_scans.all()
        if scan.scan_type in {"face_front", "face_left", "face_right"}
    ]
    face_scans.sort(key=lambda scan: scan.created_at, reverse=True)

    latest_scan = face_scans[0] if face_scans else None
    gps_lat = None
    gps_lng = None
    for scan in face_scans:
        if scan.gps_lat is not None and scan.gps_lng is not None:
            gps_lat = float(scan.gps_lat)
            gps_lng = float(scan.gps_lng)
            break

    skill_names = sorted(
        {
            skill_entry.skill.name
            for skill_entry in alumni.skills.all()
            if skill_entry.skill_id and skill_entry.skill
        }
    )

    payload = {
        "id": str(alumni.id),
        "employmentRecordId": str(record.id),
        "name": _build_alumni_name(record),
        "email": alumni.user.email,
        "graduationYear": _resolve_graduation_year(record),
        "verificationStatus": record.verification_status,
        "employmentStatus": record.employment_status.replace("_", "-"),
        "jobTitle": record.job_title_input,
        "jobTitleId": str(record.job_title_id) if record.job_title_id else None,
        "company": record.employer_name_input,
        "industry": record.job_title.industry.name if record.job_title and record.job_title.industry else "",
        "workLocation": record.work_location,
        "regionId": str(record.region_id) if record.region_id else None,
        "dateUpdated": record.updated_at.date().isoformat(),
        "skills": skill_names,
        "biometricCaptured": bool(face_scans),
        "biometricDate": (
            (latest_scan.captured_at or latest_scan.created_at).date().isoformat()
            if latest_scan
            else None
        ),
    }

    if gps_lat is not None and gps_lng is not None:
        payload["lat"] = gps_lat
        payload["lng"] = gps_lng

    return payload

# ── Skills ─────────────────────────────────────────────────────────────────────

class SkillListView(APIView):
    """GET  /api/reference/skills/        → list all active skills
       POST /api/reference/skills/        → create skill (admin only in practice)
    """
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        active_only = request.query_params.get("active", "true").lower() != "false"
        qs = Skill.objects.select_related("category").order_by("category__name", "name")
        if active_only:
            qs = qs.filter(is_active=True)
        return Response({"skills": [_serialize_skill(s) for s in qs]})

    def post(self, request):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        name = (request.data.get("name") or "").strip()
        category_id = request.data.get("category_id") or None
        if not name:
            return Response({"detail": "name is required."}, status=status.HTTP_400_BAD_REQUEST)
        if Skill.objects.filter(name__iexact=name).exists():
            return Response({"detail": "A skill with this name already exists."}, status=status.HTTP_409_CONFLICT)
        category = None
        if category_id:
            try:
                category = SkillCategory.objects.get(pk=category_id)
            except SkillCategory.DoesNotExist:
                return Response({"detail": "Category not found."}, status=status.HTTP_400_BAD_REQUEST)
        skill = Skill.objects.create(name=name, category=category)
        return Response({"skill": _serialize_skill(skill)}, status=status.HTTP_201_CREATED)

class SkillDetailView(APIView):
    """PATCH /api/reference/skills/<pk>/   → update name / category / is_active
       DELETE /api/reference/skills/<pk>/  → soft-delete (set is_active=False)
    """
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def _get_skill(self, pk):
        try:
            return Skill.objects.select_related("category").get(pk=pk)
        except Skill.DoesNotExist:
            return None

    def patch(self, request, pk):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        skill = self._get_skill(pk)
        if not skill:
            return Response({"detail": "Skill not found."}, status=status.HTTP_404_NOT_FOUND)
        if "name" in request.data:
            skill.name = (request.data["name"] or "").strip() or skill.name
        if "category_id" in request.data:
            cat_id = request.data["category_id"]
            if cat_id is None:
                skill.category = None
            else:
                try:
                    skill.category = SkillCategory.objects.get(pk=cat_id)
                except SkillCategory.DoesNotExist:
                    return Response({"detail": "Category not found."}, status=status.HTTP_400_BAD_REQUEST)
        if "is_active" in request.data:
            skill.is_active = bool(request.data["is_active"])
        skill.save()
        return Response({"skill": _serialize_skill(skill)})

    def delete(self, request, pk):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        skill = self._get_skill(pk)
        if not skill:
            return Response({"detail": "Skill not found."}, status=status.HTTP_404_NOT_FOUND)
        skill.is_active = False
        skill.save(update_fields=["is_active"])
        return Response(status=status.HTTP_204_NO_CONTENT)

# ── Skill Categories ───────────────────────────────────────────────────────────

class SkillCategoryListView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        qs = SkillCategory.objects.filter(is_active=True).order_by("name")
        return Response({"categories": [_serialize_category(c) for c in qs]})

    def post(self, request):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        name = (request.data.get("name") or "").strip()
        if not name:
            return Response({"detail": "name is required."}, status=status.HTTP_400_BAD_REQUEST)
        if SkillCategory.objects.filter(name__iexact=name).exists():
            return Response({"detail": "Category already exists."}, status=status.HTTP_409_CONFLICT)
        cat = SkillCategory.objects.create(name=name)
        return Response({"category": _serialize_category(cat)}, status=status.HTTP_201_CREATED)

class SkillCategoryDetailView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def patch(self, request, pk):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        try:
            cat = SkillCategory.objects.get(pk=pk)
        except SkillCategory.DoesNotExist:
            return Response({"detail": "Category not found."}, status=status.HTTP_404_NOT_FOUND)
        if "name" in request.data:
            cat.name = (request.data["name"] or "").strip() or cat.name
        if "is_active" in request.data:
            cat.is_active = bool(request.data["is_active"])
        cat.save()
        return Response({"category": _serialize_category(cat)})

    def delete(self, request, pk):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        try:
            cat = SkillCategory.objects.get(pk=pk)
        except SkillCategory.DoesNotExist:
            return Response({"detail": "Category not found."}, status=status.HTTP_404_NOT_FOUND)
        cat.is_active = False
        cat.save(update_fields=["is_active"])
        return Response(status=status.HTTP_204_NO_CONTENT)

# ── Industries ─────────────────────────────────────────────────────────────────

class IndustryListView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        qs = Industry.objects.filter(is_active=True).order_by("name")
        return Response({"industries": [_serialize_industry(i) for i in qs]})

    def post(self, request):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        name = (request.data.get("name") or "").strip()
        if not name:
            return Response({"detail": "name is required."}, status=status.HTTP_400_BAD_REQUEST)
        if Industry.objects.filter(name__iexact=name).exists():
            return Response({"detail": "Industry already exists."}, status=status.HTTP_409_CONFLICT)
        ind = Industry.objects.create(name=name)
        return Response({"industry": _serialize_industry(ind)}, status=status.HTTP_201_CREATED)

class IndustryDetailView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def patch(self, request, pk):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        try:
            ind = Industry.objects.get(pk=pk)
        except Industry.DoesNotExist:
            return Response({"detail": "Industry not found."}, status=status.HTTP_404_NOT_FOUND)
        if "name" in request.data:
            ind.name = (request.data["name"] or "").strip() or ind.name
        if "is_active" in request.data:
            ind.is_active = bool(request.data["is_active"])
        ind.save()
        return Response({"industry": _serialize_industry(ind)})

    def delete(self, request, pk):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        try:
            ind = Industry.objects.get(pk=pk)
        except Industry.DoesNotExist:
            return Response({"detail": "Industry not found."}, status=status.HTTP_404_NOT_FOUND)
        ind.is_active = False
        ind.save(update_fields=["is_active"])
        return Response(status=status.HTTP_204_NO_CONTENT)

# ── Job Titles ─────────────────────────────────────────────────────────────────

class JobTitleListView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        qs = JobTitle.objects.select_related("industry").filter(is_active=True).order_by("name")
        return Response({"job_titles": [_serialize_job_title(j) for j in qs]})

    def post(self, request):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        from tracer.text_quality import job_text_problem

        name = " ".join((request.data.get("name") or "").split())
        industry_id = request.data.get("industry_id") or None
        if not name:
            return Response({"detail": "name is required."}, status=status.HTTP_400_BAD_REQUEST)
        if (problem := job_text_problem(name)):
            return Response({"detail": f"Job title {problem}."}, status=status.HTTP_400_BAD_REQUEST)
        if JobTitle.objects.filter(name__iexact=name).exists():
            return Response({"detail": "Job title already exists."}, status=status.HTTP_409_CONFLICT)
        industry = None
        if industry_id:
            try:
                industry = Industry.objects.get(pk=industry_id)
            except Industry.DoesNotExist:
                return Response({"detail": "Industry not found."}, status=status.HTTP_400_BAD_REQUEST)
        from tracer.management.commands.classify_job_titles import classify
        from tracer.models import EmploymentRecord

        jt = JobTitle.objects.create(name=name, industry=industry, is_field=classify(name))
        # Graduates who typed this title under "My job isn't listed" are on the
        # list now: link their records so reports count them under it.
        linked = EmploymentRecord.objects.filter(job_title__isnull=True, job_title_input__iexact=name).update(job_title=jt)
        return Response(
            {"job_title": _serialize_job_title(jt), "linked_records": linked},
            status=status.HTTP_201_CREATED,
        )

class JobTitleDetailView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def patch(self, request, pk):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        try:
            jt = JobTitle.objects.select_related("industry").get(pk=pk)
        except JobTitle.DoesNotExist:
            return Response({"detail": "Job title not found."}, status=status.HTTP_404_NOT_FOUND)
        if "name" in request.data:
            from tracer.text_quality import job_text_problem

            new_name = " ".join((request.data["name"] or "").split())
            if new_name and (problem := job_text_problem(new_name)):
                return Response({"detail": f"Job title {problem}."}, status=status.HTTP_400_BAD_REQUEST)
            jt.name = new_name or jt.name
        if "industry_id" in request.data:
            ind_id = request.data["industry_id"]
            if ind_id is None:
                jt.industry = None
            else:
                try:
                    jt.industry = Industry.objects.get(pk=ind_id)
                except Industry.DoesNotExist:
                    return Response({"detail": "Industry not found."}, status=status.HTTP_400_BAD_REQUEST)
        if "is_active" in request.data:
            jt.is_active = bool(request.data["is_active"])
        jt.save()
        return Response({"job_title": _serialize_job_title(jt)})

    def delete(self, request, pk):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        try:
            jt = JobTitle.objects.get(pk=pk)
        except JobTitle.DoesNotExist:
            return Response({"detail": "Job title not found."}, status=status.HTTP_404_NOT_FOUND)
        jt.is_active = False
        jt.save(update_fields=["is_active"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class UnlistedJobTitleView(APIView):
    """
    Admin: job titles graduates typed under "My job isn't listed", most common first.

    The admin adds a real one to the list (creating it links the matching
    records) and ignores the rest. Read-only.
    """

    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        from collections import defaultdict

        from tracer.models import EmploymentProfile
        from tracer.text_quality import job_text_problem

        listed = {n.strip().lower() for n in JobTitle.objects.filter(is_active=True).values_list("name", flat=True)}
        graduates: dict[str, set] = defaultdict(set)
        spelling: dict[str, str] = {}
        for alumni_id, *titles in EmploymentProfile.objects.values_list("alumni_id", "first_job_title", "current_job_title"):
            for title in titles:
                text = " ".join((title or "").split())
                key = text.lower()
                if not text or key in listed:
                    continue
                graduates[key].add(alumni_id)
                spelling.setdefault(key, text)
        items = sorted(
            (
                {"title": spelling[key], "graduates": len(ids), "problem": job_text_problem(spelling[key])}
                for key, ids in graduates.items()
            ),
            key=lambda item: (-item["graduates"], item["title"].lower()),
        )
        return Response({"unlisted": items})


class ResolveUnlistedJobTitleView(APIView):
    """
    Admin: replace typed job titles with one already on the list.

    POST {"fixes": [{"title": "Artits", "job_title_id": "<Artist id>"}, ...]}

    Covers typos and accounts saved before titles came from the list. Every copy
    of the typed text is rewritten: both titles on the graduate's survey profile
    and the employment records, which are also linked to the listed title. The
    profile and the current record end up with the same text, so the graduate's
    next save does not read as a job change and retire a verified record.
    """

    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        from tracer.models import EmploymentProfile, EmploymentRecord

        fixes = request.data.get("fixes")
        if not isinstance(fixes, list) or not fixes:
            return Response({"detail": "fixes must be a non-empty list."}, status=status.HTTP_400_BAD_REQUEST)

        replacements: dict[str, JobTitle] = {}
        for fix in fixes:
            if not isinstance(fix, dict):
                return Response({"detail": "Each fix needs a title and a job_title_id."}, status=status.HTTP_400_BAD_REQUEST)
            key = " ".join(str(fix.get("title") or "").split()).lower()
            if not key or not fix.get("job_title_id"):
                return Response({"detail": "Each fix needs a title and a job_title_id."}, status=status.HTTP_400_BAD_REQUEST)
            try:
                replacements[key] = JobTitle.objects.get(pk=fix["job_title_id"], is_active=True)
            except (JobTitle.DoesNotExist, ValueError, DjangoValidationError):
                return Response({"detail": "Job title not found."}, status=status.HTTP_400_BAD_REQUEST)

        def target(text):
            return replacements.get(" ".join((text or "").split()).lower())

        profiles = records = 0
        graduates: set = set()
        with transaction.atomic():
            for profile in EmploymentProfile.objects.select_for_update().only("id", "alumni_id", "first_job_title", "current_job_title"):
                changed = []
                for field in ("first_job_title", "current_job_title"):
                    jt = target(getattr(profile, field))
                    if jt:
                        setattr(profile, field, jt.name[:150])
                        changed.append(field)
                if changed:
                    profile.save(update_fields=changed)
                    profiles += 1
                    graduates.add(profile.alumni_id)
            for record in EmploymentRecord.objects.select_for_update().only("id", "alumni_id", "job_title_input", "job_title"):
                jt = target(record.job_title_input)
                if jt:
                    record.job_title_input = jt.name[:255]
                    record.job_title = jt
                    record.save(update_fields=["job_title_input", "job_title", "updated_at"])
                    records += 1
                    graduates.add(record.alumni_id)

        return Response({"graduates": len(graduates), "profiles": profiles, "records": records})

# ── Regions ────────────────────────────────────────────────────────────────────

class RegionListView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        active_only = request.query_params.get("active", "true").lower() != "false"
        qs = Region.objects.order_by("name")
        if active_only:
            qs = qs.filter(is_active=True)
        return Response({"regions": [_serialize_region(r) for r in qs]})

    def post(self, request):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        code = (request.data.get("code") or "").strip()
        name = (request.data.get("name") or "").strip()
        if not code or not name:
            return Response(
                {"detail": "code and name are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if Region.objects.filter(code__iexact=code).exists():
            return Response(
                {"detail": "Region code already exists."},
                status=status.HTTP_409_CONFLICT,
            )
        if Region.objects.filter(name__iexact=name).exists():
            return Response(
                {"detail": "Region name already exists."},
                status=status.HTTP_409_CONFLICT,
            )

        region = Region.objects.create(code=code, name=name)
        return Response({"region": _serialize_region(region)}, status=status.HTTP_201_CREATED)

class RegionDetailView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def patch(self, request, pk):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        try:
            region = Region.objects.get(pk=pk)
        except Region.DoesNotExist:
            return Response({"detail": "Region not found."}, status=status.HTTP_404_NOT_FOUND)

        if "code" in request.data:
            code = str(request.data.get("code") or "").strip()
            if not code:
                return Response({"detail": "code cannot be blank."}, status=status.HTTP_400_BAD_REQUEST)
            duplicate_code = Region.objects.filter(code__iexact=code).exclude(pk=region.pk).exists()
            if duplicate_code:
                return Response({"detail": "Region code already exists."}, status=status.HTTP_409_CONFLICT)
            region.code = code

        if "name" in request.data:
            name = str(request.data.get("name") or "").strip()
            if not name:
                return Response({"detail": "name cannot be blank."}, status=status.HTTP_400_BAD_REQUEST)
            duplicate_name = Region.objects.filter(name__iexact=name).exclude(pk=region.pk).exists()
            if duplicate_name:
                return Response({"detail": "Region name already exists."}, status=status.HTTP_409_CONFLICT)
            region.name = name

        if "is_active" in request.data:
            region.is_active = bool(request.data.get("is_active"))

        region.save()
        return Response({"region": _serialize_region(region)})

    def delete(self, request, pk):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        try:
            region = Region.objects.get(pk=pk)
        except Region.DoesNotExist:
            return Response({"detail": "Region not found."}, status=status.HTTP_404_NOT_FOUND)
        region.is_active = False
        region.save(update_fields=["is_active"])
        return Response(status=status.HTTP_204_NO_CONTENT)

# ── Provinces ──────────────────────────────────────────────────────────────────

class ProvinceListView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        qs = Province.objects.select_related("region").order_by("name")
        if not str(request.query_params.get("include_inactive", "")).lower() in {"1", "true", "yes"}:
            qs = qs.filter(is_active=True)
        region_id = request.query_params.get("region")
        if region_id:
            qs = qs.filter(region_id=region_id)
        return Response({"provinces": [_serialize_province(p) for p in qs]})

    def post(self, request):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        name = str(request.data.get("name") or "").strip()
        region_id = request.data.get("region_id") or request.data.get("region")
        psgc_id = str(request.data.get("psgc_id") or "").strip()
        if not name or not region_id or not psgc_id:
            return Response(
                {"detail": "name, region_id, and psgc_id are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not Region.objects.filter(pk=region_id).exists():
            return Response({"detail": "Region not found."}, status=status.HTTP_404_NOT_FOUND)
        if Province.objects.filter(psgc_id=psgc_id).exists():
            return Response({"detail": "Province with that psgc_id already exists."}, status=status.HTTP_409_CONFLICT)
        province = Province.objects.create(name=name, region_id=region_id, psgc_id=psgc_id)
        return Response({"province": _serialize_province(province)}, status=status.HTTP_201_CREATED)

class ProvinceDetailView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def patch(self, request, pk):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        try:
            province = Province.objects.select_related("region").get(pk=pk)
        except Province.DoesNotExist:
            return Response({"detail": "Province not found."}, status=status.HTTP_404_NOT_FOUND)

        if "name" in request.data:
            name = str(request.data.get("name") or "").strip()
            if not name:
                return Response({"detail": "name cannot be blank."}, status=status.HTTP_400_BAD_REQUEST)
            province.name = name
        if "region_id" in request.data and request.data.get("region_id"):
            province.region_id = request.data.get("region_id")
        if "is_active" in request.data:
            province.is_active = bool(request.data.get("is_active"))

        province.save()
        return Response({"province": _serialize_province(province)})

    def delete(self, request, pk):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        try:
            province = Province.objects.get(pk=pk)
        except Province.DoesNotExist:
            return Response({"detail": "Province not found."}, status=status.HTTP_404_NOT_FOUND)
        province.is_active = False
        province.save(update_fields=["is_active"])
        return Response(status=status.HTTP_204_NO_CONTENT)

# ── Cities / Municipalities ────────────────────────────────────────────────────

class CityMunicipalityListView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        qs = CityMunicipality.objects.select_related("region", "province", "home_province").order_by("name")
        if not str(request.query_params.get("include_inactive", "")).lower() in {"1", "true", "yes"}:
            qs = qs.filter(is_active=True)
        province_id = request.query_params.get("province")
        region_id = request.query_params.get("region")
        if province_id:
            # Include highly urbanized cities located in the province. They have
            # no province in the PSGC, so without this Bacolod never appeared
            # under Negros Occidental and could not be selected at all.
            qs = qs.filter(Q(province_id=province_id) | Q(home_province_id=province_id))
        if region_id:
            qs = qs.filter(region_id=region_id)
        return Response({"cities": [_serialize_city(c) for c in qs]})

    def post(self, request):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        name = str(request.data.get("name") or "").strip()
        region_id = request.data.get("region_id") or request.data.get("region")
        province_id = request.data.get("province_id") or request.data.get("province")
        psgc_id = str(request.data.get("psgc_id") or "").strip()
        is_city = bool(request.data.get("is_city", False))
        if not name or not region_id or not psgc_id:
            return Response(
                {"detail": "name, region_id, and psgc_id are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not Region.objects.filter(pk=region_id).exists():
            return Response({"detail": "Region not found."}, status=status.HTTP_404_NOT_FOUND)
        if province_id and not Province.objects.filter(pk=province_id).exists():
            return Response({"detail": "Province not found."}, status=status.HTTP_404_NOT_FOUND)
        if CityMunicipality.objects.filter(psgc_id=psgc_id).exists():
            return Response({"detail": "City/Municipality with that psgc_id already exists."}, status=status.HTTP_409_CONFLICT)
        city = CityMunicipality.objects.create(
            name=name,
            region_id=region_id,
            province_id=province_id or None,
            psgc_id=psgc_id,
            is_city=is_city,
        )
        return Response({"city": _serialize_city(city)}, status=status.HTTP_201_CREATED)

class CityMunicipalityDetailView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def patch(self, request, pk):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        try:
            city = CityMunicipality.objects.select_related("region", "province").get(pk=pk)
        except CityMunicipality.DoesNotExist:
            return Response({"detail": "City/Municipality not found."}, status=status.HTTP_404_NOT_FOUND)

        if "name" in request.data:
            name = str(request.data.get("name") or "").strip()
            if not name:
                return Response({"detail": "name cannot be blank."}, status=status.HTTP_400_BAD_REQUEST)
            city.name = name
        if "region_id" in request.data and request.data.get("region_id"):
            city.region_id = request.data.get("region_id")
        if "province_id" in request.data:
            city.province_id = request.data.get("province_id") or None
        if "is_city" in request.data:
            city.is_city = bool(request.data.get("is_city"))
        if "is_active" in request.data:
            city.is_active = bool(request.data.get("is_active"))

        city.save()
        return Response({"city": _serialize_city(city)})

    def delete(self, request, pk):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        try:
            city = CityMunicipality.objects.get(pk=pk)
        except CityMunicipality.DoesNotExist:
            return Response({"detail": "City/Municipality not found."}, status=status.HTTP_404_NOT_FOUND)
        city.is_active = False
        city.save(update_fields=["is_active"])
        return Response(status=status.HTTP_204_NO_CONTENT)

class AlumniVerificationInviteView(APIView):
    """Graduate-initiated verification invite.

    Lets a graduate mint a VerificationToken for THEIR OWN current employment
    record, so they can hand the resulting link to a (possibly new) evaluator at
    their company. Mirrors VerificationTokenIssueView but is keyed by alumni_id
    instead of employer auth. No schema change - reuses VerificationToken.
    """

    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, alumni_id):
        # The docstring above says this mints a token for the graduate's OWN
        # record, but nothing enforced it: the view accepted any alumni_id from
        # anyone. That let a third party mint a verification link for a graduate
        # they do not own and address it to an employer of their choosing, which
        # is precisely the fabrication this token flow exists to prevent.
        _account, _auth_error = require_alumni(request, alumni_id=alumni_id)
        if _auth_error:
            return _auth_error

        try:
            record = (
                EmploymentRecord.objects
                .select_related("job_title", "region", "alumni")
                .filter(alumni_id=alumni_id, is_current=True)
                .first()
            )
            if not record:
                return Response(
                    {"detail": "No current employment record to verify. Save your current job first."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            raw_ttl = request.data.get("expires_in_days")
            ttl_days = _VERIFICATION_TOKEN_DEFAULT_TTL_DAYS
            if raw_ttl is not None:
                try:
                    ttl_days = max(1, min(int(raw_ttl), 30))
                except (TypeError, ValueError):
                    return Response(
                        {"detail": "expires_in_days must be a valid number from 1 to 30."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            invited_email = str(request.data.get("employer_email") or "").strip().lower()
            if invited_email:
                try:
                    validate_email(invited_email)
                except DjangoValidationError:
                    return Response(
                        {"detail": "employer_email must be a valid email address."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                alumni_email = (getattr(record.alumni.user, "email", "") or "").strip().lower()
                if alumni_email and invited_email == alumni_email:
                    return Response(
                        {"detail": "You cannot send a verification link to your own address."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            # Cap outstanding links. Previously a new invite revoked the old
            # one, which capped things implicitly; now that several verifiers
            # can hold live links at once, the cap has to be explicit or
            # "one link per employer" becomes unbounded link generation.
            live_links = VerificationToken.objects.filter(
                employment_record=record,
                status=VerificationToken.Status.PENDING,
                expires_at__gt=timezone.now(),
            ).count()
            if live_links >= _VERIFICATION_MAX_LIVE_LINKS:
                return Response(
                    {
                        "detail": (
                            f"You already have {live_links} active verification links for this job. "
                            "Wait for one to be used or to expire before creating another."
                        )
                    },
                    status=status.HTTP_429_TOO_MANY_REQUESTS,
                )

            forwarded = (request.META.get("HTTP_X_FORWARDED_FOR") or "").split(",")[0].strip()
            created_ip = forwarded or request.META.get("REMOTE_ADDR") or None

            with transaction.atomic():
                # Prior pending tokens are intentionally left alone: a graduate
                # may invite more than one verifier (HR and a direct
                # supervisor), and each needs a link that still works.
                token = VerificationToken.objects.create(
                    alumni=record.alumni,
                    employment_record=record,
                    expires_at=timezone.now() + timedelta(days=ttl_days),
                    invited_email=invited_email,
                    created_ip=created_ip,
                )
        except (OperationalError, DatabaseError):
            return _database_unavailable_response()

        return Response(
            {
                "message": "Verification invite created.",
                "token": _serialize_verification_token(token),
                "employmentRecord": _serialize_employment_record(record),
                "companyName": record.employer_name_input,
                "invitedEmail": token.invited_email,
            },
            status=status.HTTP_201_CREATED,
        )

def _candidate_is_unemployed(emp_profile) -> bool:
    """True when the alumni's latest EmploymentProfile is NOT an employed status.

    Mirrors `_is_employed` in reports_api.py — kept inline here to avoid a
    cross-module import cycle.
    """
    if emp_profile is None or not emp_profile.employment_status:
        return True
    return emp_profile.employment_status not in {
        "employed_full_time",
        "employed_part_time",
        "self_employed",
    }

class VerificationTokenDetailView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, token_id):
        try:
            token = (
                VerificationToken.objects.select_related(
                    "alumni__user",
                    "alumni__profile",
                    "employment_record__job_title",
                    "employment_record__region",
                )
                .filter(token_id=token_id)
                .first()
            )
        except (OperationalError, DatabaseError):
            return _database_unavailable_response()

        if not token:
            return Response({"detail": "Verification token not found."}, status=status.HTTP_404_NOT_FOUND)

        if token.status == VerificationToken.Status.PENDING and token.expires_at <= timezone.now():
            token.status = VerificationToken.Status.EXPIRED
            token.save(update_fields=["status"])

        profile = getattr(token.alumni, "profile", None)
        alumni_name = ""
        if profile:
            alumni_name = " ".join(
                p.strip() for p in [profile.first_name, profile.middle_name, profile.last_name] if p and p.strip()
            )
        if not alumni_name:
            # Deliberately NOT the email address — see the data-minimisation
            # note below. A nameless profile is rare and a placeholder is
            # preferable to leaking contact details.
            alumni_name = "BSIS Graduate"

        # This endpoint is public: anyone holding (or forwarded) the link can
        # read it. It therefore returns only what an employer needs to identify
        # the graduate they are vouching for — name, programme, batch. The
        # graduate's email address is NOT included; a stranger with a forwarded
        # link has no reason to receive their contact details.
        response = Response(
            {
                "token": _serialize_verification_token(token),
                "alumni": {
                    "id": str(token.alumni_id),
                    "name": alumni_name,
                    "program": "BSIS",
                    "batchYear": getattr(profile, "graduation_year", None) if profile else None,
                },
                "employmentRecord": _serialize_employment_record(token.employment_record),
            }
        )
        # Keep the graduate's details out of shared caches and search engines.
        response["Cache-Control"] = "no-store"
        response["X-Robots-Tag"] = "noindex, nofollow"
        return response

class VerificationTokenDecisionView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, token_id):
        # No employer login. Holding a valid, unused token IS the authorisation
        # to answer — the token's alumni FK already establishes whose
        # employment this is. What the token cannot establish is WHO is
        # answering, so the verifier identifies themselves here and that
        # identity is recorded for the audit trail.
        verifier_name = str(request.data.get("verifier_name") or "").strip()
        verifier_email = str(request.data.get("verifier_email") or "").strip().lower()
        verifier_position = str(request.data.get("verifier_position") or "").strip()
        if not verifier_name or not verifier_email:
            return Response(
                {"detail": "verifier_name and verifier_email are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            validate_email(verifier_email)
        except DjangoValidationError:
            return Response(
                {"detail": "verifier_email must be a valid email address."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        raw_decision = str(request.data.get("decision") or "").strip().lower()
        valid_decisions = {
            VerificationDecision.Decision.CONFIRM,
            VerificationDecision.Decision.DENY,
        }
        if raw_decision not in valid_decisions:
            return Response(
                {"detail": "decision must be either 'confirm' or 'deny'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        verified_job_title = None
        verified_job_title_id = request.data.get("verified_job_title_id")
        if verified_job_title_id:
            verified_job_title = JobTitle.objects.filter(id=verified_job_title_id, is_active=True).first()
            if not verified_job_title:
                return Response(
                    {"detail": "verified_job_title_id does not match an active job title."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        eval_kwargs: dict | None = None
        if raw_decision == VerificationDecision.Decision.CONFIRM:
            eval_kwargs, eval_error = _extract_evaluation_payload(request)
            if eval_error:
                return Response({"detail": eval_error}, status=status.HTTP_400_BAD_REQUEST)

        try:
            token = (
                VerificationToken.objects.select_related(
                    "alumni",
                    "employment_record__job_title",
                    "employment_record__region",
                )
                .filter(token_id=token_id)
                .first()
            )
        except (OperationalError, DatabaseError):
            return _database_unavailable_response()

        if not token:
            return Response({"detail": "Verification token not found."}, status=status.HTTP_404_NOT_FOUND)

        if token.status != VerificationToken.Status.PENDING:
            return Response(
                {"detail": f"Token is already {token.status}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if token.expires_at <= timezone.now():
            token.status = VerificationToken.Status.EXPIRED
            token.save(update_fields=["status"])
            return Response(
                {"detail": "Verification token has expired."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        employment_record = token.employment_record
        if not employment_record:
            employment_record = EmploymentRecord.objects.select_related("job_title", "region").filter(
                alumni=token.alumni,
                is_current=True,
            ).first()
            if not employment_record:
                return Response(
                    {"detail": "Current employment record was not found for this token."},
                    status=status.HTTP_404_NOT_FOUND,
                )

        # Hard reject: a graduate cannot verify themselves. This is the one
        # self-verification case that can be blocked outright rather than only
        # flagged, because the addresses are directly comparable.
        alumni_email = (getattr(token.alumni.user, "email", "") or "").strip().lower()
        if alumni_email and verifier_email == alumni_email:
            return Response(
                {"detail": "A graduate cannot verify their own employment. Ask your employer to complete this."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        verified_employer_name = str(
            request.data.get("verified_employer_name")
            or employment_record.employer_name_input
            or ""
        ).strip()
        comment = str(request.data.get("comment") or "").strip()
        # Held decisions existed only to park answers from employers awaiting
        # admin approval. With no accounts there is nothing to wait for, so a
        # link-based decision always applies immediately.
        is_held_decision = False
        forwarded = (request.META.get("HTTP_X_FORWARDED_FOR") or "").split(",")[0].strip()
        verifier_ip = forwarded or request.META.get("REMOTE_ADDR") or None

        # Soft flags. None of these block the submission — they surface rows an
        # admin should eyeball, which is the honest defence against
        # self-verification once accounts are gone.
        flags: list[str] = []
        if token.invited_email and verifier_email != token.invited_email.strip().lower():
            flags.append("answered from a different address than the invite")
        if token.created_ip and verifier_ip and token.created_ip == verifier_ip:
            flags.append("link created and answered from the same device")
        if (timezone.now() - token.created_at).total_seconds() < 60:
            flags.append("answered less than a minute after the link was created")
        flag_reason = "; ".join(flags)[:255]

        try:
            with transaction.atomic():
                decision = VerificationDecision.objects.create(
                    employer_account=None,
                    token=token,
                    verifier_name=verifier_name,
                    verifier_email=verifier_email,
                    verifier_position=verifier_position,
                    invited_email=token.invited_email or "",
                    verifier_ip=verifier_ip,
                    flagged_for_review=bool(flags),
                    flag_reason=flag_reason,
                    verified_employer_name=verified_employer_name,
                    verified_job_title=verified_job_title,
                    decision=raw_decision,
                    comment=comment,
                    is_held=is_held_decision,
                    **(eval_kwargs or {}),
                )

                if not is_held_decision:
                    employment_record.employer_name_input = (
                        verified_employer_name or employment_record.employer_name_input
                    )
                    if verified_job_title:
                        employment_record.job_title = verified_job_title
                        if not employment_record.job_title_input:
                            employment_record.job_title_input = verified_job_title.name
                    employment_record.verification_status = (
                        EmploymentRecord.VerificationStatus.VERIFIED
                        if raw_decision == VerificationDecision.Decision.CONFIRM
                        else EmploymentRecord.VerificationStatus.DENIED
                    )
                    employment_record.save(
                        update_fields=[
                            "employer_name_input",
                            "job_title",
                            "job_title_input",
                            "verification_status",
                            "updated_at",
                        ]
                    )

                token.employment_record = employment_record
                token.mark_used()

                # Sibling pending tokens are deliberately NOT revoked here. A
                # graduate may send links to more than one verifier (an HR
                # contact and a direct supervisor, say), and each must be able
                # to answer independently. Revoking them would silently kill
                # the other employer's link the moment the first one replied.
        except (OperationalError, DatabaseError):
            return _database_unavailable_response()

        message = (
            "Verification decision submitted and placed on hold until employer approval."
            if is_held_decision
            else "Verification decision submitted."
        )

        return Response(
            {
                "message": message,
                "token": _serialize_verification_token(token),
                "decision": _serialize_verification_decision(decision),
                "employmentRecord": _serialize_employment_record(employment_record),
            }
        )

# ── All Reference Data (single call) ──────────────────────────────────────────

class BarangayListView(APIView):
    """
    GET /api/reference/barangays/?city=<uuid> -> the active barangays of one
    city or municipality.

    `city` is required: there are 42,010 barangays, and no form needs them all.
    Public for the same reason as the other reference lists: registration needs
    them before anyone has signed in.
    """

    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        import uuid as _uuid

        city_id = request.query_params.get("city")
        try:
            _uuid.UUID(str(city_id))
        except (TypeError, ValueError):
            return Response({"detail": "A valid city id is required."}, status=status.HTTP_400_BAD_REQUEST)
        rows = Barangay.objects.filter(city_id=city_id, is_active=True).order_by("name")
        return Response({"barangays": [_serialize_barangay(b) for b in rows]})

    def post(self, request):
        """Admin: add a barangay the PSGC release does not have yet."""
        import uuid as _uuid

        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        name = str(request.data.get("name") or "").strip()
        city_id = request.data.get("city_id") or request.data.get("city")
        psgc_id = str(request.data.get("psgc_id") or "").strip()
        if not name or not city_id or not psgc_id:
            return Response(
                {"detail": "name, city_id, and psgc_id are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            _uuid.UUID(str(city_id))
        except (TypeError, ValueError):
            return Response({"detail": "City/Municipality not found."}, status=status.HTTP_404_NOT_FOUND)
        if not CityMunicipality.objects.filter(pk=city_id).exists():
            return Response({"detail": "City/Municipality not found."}, status=status.HTTP_404_NOT_FOUND)
        if Barangay.objects.filter(psgc_id=psgc_id).exists():
            return Response(
                {"detail": "A barangay with that PSGC ID already exists."},
                status=status.HTTP_409_CONFLICT,
            )
        barangay = Barangay.objects.create(name=name, city_id=city_id, psgc_id=psgc_id)
        return Response({"barangay": _serialize_barangay(barangay)}, status=status.HTTP_201_CREATED)


class BarangayDetailView(APIView):
    """Admin rename / soft-delete for one barangay, mirroring the city endpoints."""

    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def patch(self, request, pk):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        try:
            barangay = Barangay.objects.get(pk=pk)
        except Barangay.DoesNotExist:
            return Response({"detail": "Barangay not found."}, status=status.HTTP_404_NOT_FOUND)
        if "name" in request.data:
            name = str(request.data.get("name") or "").strip()
            if not name:
                return Response({"detail": "name cannot be blank."}, status=status.HTTP_400_BAD_REQUEST)
            barangay.name = name
        if "is_active" in request.data:
            barangay.is_active = bool(request.data.get("is_active"))
        barangay.save()
        return Response({"barangay": _serialize_barangay(barangay)})

    def delete(self, request, pk):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        try:
            barangay = Barangay.objects.get(pk=pk)
        except Barangay.DoesNotExist:
            return Response({"detail": "Barangay not found."}, status=status.HTTP_404_NOT_FOUND)
        # Soft delete, like cities: a graduate's saved address may still name it,
        # and the next PSGC sync would otherwise re-create it anyway.
        barangay.is_active = False
        barangay.save(update_fields=["is_active"])
        return Response(status=status.HTTP_204_NO_CONTENT)


def _serialize_barangay(b) -> dict:
    return {"id": str(b.id), "name": b.name, "psgc_id": b.psgc_id, "city_id": str(b.city_id)}


class LocationLookupView(APIView):
    """
    POST /api/reference/locate/ {latitude, longitude} -> the address rows that
    point falls in, for "Use my current location" on registration.

    Public (registration is pre-login) but rate limited per client, and the
    lookup itself is spaced and cached in tracer/geo_lookup.py. Coordinates are
    never logged.
    """

    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    RATE_LIMIT = 20
    RATE_WINDOW_SECONDS = 60

    def post(self, request):
        from django.core.cache import cache

        try:
            latitude = float(request.data.get("latitude"))
            longitude = float(request.data.get("longitude"))
        except (TypeError, ValueError):
            return Response({"detail": "latitude and longitude are required."}, status=status.HTTP_400_BAD_REQUEST)
        if latitude != latitude or longitude != longitude or not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            return Response({"detail": "Coordinates are out of range."}, status=status.HTTP_400_BAD_REQUEST)

        forwarded = (request.META.get("HTTP_X_FORWARDED_FOR") or "").split(",")[0].strip()
        client = forwarded or request.META.get("REMOTE_ADDR") or "unknown"
        rate_key = f"geo:locate:rate:{client}"
        used = cache.get(rate_key, 0)
        if used >= self.RATE_LIMIT:
            return Response(
                {"detail": "Too many location lookups. Please wait a minute or fill the address in by hand."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        cache.set(rate_key, used + 1, self.RATE_WINDOW_SECONDS)

        try:
            payload = reverse_geocode(latitude, longitude)
        except GeoLookupError:
            return Response(
                {"detail": "Location lookup is unavailable right now. Please fill in your address by hand."},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        result = resolve_location(payload)
        result["latitude"] = latitude
        result["longitude"] = longitude
        return Response(result)


class CspReportView(APIView):
    """
    POST /api/csp-report/ -> receive the browser's Content-Security-Policy reports.

    The full policy in frontend/next.config.ts runs REPORT-ONLY: browsers block
    nothing and send here what they would have blocked. A policy mistake then
    shows up as a log line instead of breaking the face scan or the maps for a
    real graduate. Each violation is one log line; nothing is stored.

    Public, because browsers send reports without credentials. Oversized or
    malformed bodies and anything past the per-client rate limit are dropped,
    and the answer is always 204, so there is nothing to learn by probing it.
    """

    authentication_classes = []
    permission_classes = [AllowAny]

    RATE_LIMIT = 60
    RATE_WINDOW_SECONDS = 60
    MAX_BODY_BYTES = 8 * 1024
    FIELD_LIMIT = 200
    MAX_REPORTS_PER_BATCH = 20

    def post(self, request):
        import logging
        from django.core.cache import cache

        no_content = Response(status=status.HTTP_204_NO_CONTENT)

        forwarded = (request.META.get("HTTP_X_FORWARDED_FOR") or "").split(",")[0].strip()
        client = forwarded or request.META.get("REMOTE_ADDR") or "unknown"
        rate_key = f"csp:report:rate:{client}"
        used = cache.get(rate_key, 0)
        if used >= self.RATE_LIMIT:
            return no_content
        cache.set(rate_key, used + 1, self.RATE_WINDOW_SECONDS)

        try:
            raw = request.body
        except Exception:
            return no_content
        if not raw or len(raw) > self.MAX_BODY_BYTES:
            return no_content
        try:
            payload = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            return no_content

        log = logging.getLogger(__name__)
        for directive, blocked, page in self._violations(payload):
            log.warning(
                "CSP violation (report-only) directive=%s blocked=%s page=%s",
                directive, blocked, page,
            )
        return no_content

    @classmethod
    def _trim(cls, value) -> str:
        # Newlines are removed so a crafted report cannot forge extra log lines.
        text = str(value or "-").replace("\r", " ").replace("\n", " ")
        return text[: cls.FIELD_LIMIT]

    @classmethod
    def _violations(cls, payload):
        # Legacy `report-uri` format: {"csp-report": {...}}
        if isinstance(payload, dict) and isinstance(payload.get("csp-report"), dict):
            report = payload["csp-report"]
            yield (
                cls._trim(report.get("effective-directive") or report.get("violated-directive")),
                cls._trim(report.get("blocked-uri")),
                cls._trim(report.get("document-uri")),
            )
            return
        # Reporting API format: [{"type": "csp-violation", "body": {...}}, ...]
        if isinstance(payload, list):
            for item in payload[: cls.MAX_REPORTS_PER_BATCH]:
                if not isinstance(item, dict) or item.get("type") != "csp-violation":
                    continue
                body = item.get("body")
                if not isinstance(body, dict):
                    continue
                yield (
                    cls._trim(body.get("effectiveDirective")),
                    cls._trim(body.get("blockedURL")),
                    cls._trim(body.get("documentURL")),
                )


class ReferenceDataView(APIView):
    """GET /api/reference/ → all reference tables in one request."""
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        skills = list(
            Skill.objects.select_related("category").filter(is_active=True).order_by("category__name", "name")
        )
        categories = list(SkillCategory.objects.filter(is_active=True).order_by("name"))
        industries = list(Industry.objects.filter(is_active=True).order_by("name"))
        job_titles = list(JobTitle.objects.select_related("industry").filter(is_active=True).order_by("name"))
        # Only expose regions that have a PSGC identifier — these are the ones
        # seeded by seed_locations and can drive the Province → City cascade.
        # Legacy rows created by seed_reference_data (psgc_id="") are hidden
        # here; they may still be used internally by FK references.
        regions = list(
            Region.objects.filter(is_active=True)
            .exclude(psgc_id="")
            .order_by("name")
        )

        return Response({
            "skills": [_serialize_skill(s) for s in skills],
            "skill_categories": [_serialize_category(c) for c in categories],
            "industries": [_serialize_industry(i) for i in industries],
            "job_titles": [_serialize_job_title(j) for j in job_titles],
            "regions": [_serialize_region(r) for r in regions],
        })

# ── Comprehensive Survey Submission ────────────────────────────────────────────

class ComprehensiveSurveySubmissionView(APIView):
    """
    POST /api/tracer/survey/submit/

    Submit complete questionnaire response (Sections 1-8)
    Validates data against encoding rules before storage
    """

    permission_classes = []  # Authenticated alumni only - set in middleware

    def post(self, request):
        _alumni_account, _auth_error = require_alumni(request)
        if _auth_error:
            return _auth_error
        """Submit comprehensive survey data"""
        from tracer.serializers import ComprehensiveSurveySerializer
        from tracer.models import EmploymentProfile, WorkAddress, CompetencyProfile
        from tracer.validators import validate_survey_data, SurveyDataValidator
        from users.models import AlumniProfile

        try:
            # Validate survey data structure
            serializer = ComprehensiveSurveySerializer(data=request.data)
            if not serializer.is_valid():
                return Response(
                    {
                        'status': 'invalid',
                        'errors': serializer.errors,
                        'message': 'Survey data validation failed'
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )

            # Run comprehensive validation
            validator = SurveyDataValidator()
            validation_result = validator.validate_comprehensive_survey(request.data)

            if not validation_result['is_valid']:
                return Response(validation_result, status=status.HTTP_400_BAD_REQUEST)

            # Get authenticated alumni
            try:
                alumni = request.user.alumni_account
            except AttributeError:
                return Response(
                    {'error': 'Alumni account not found'},
                    status=status.HTTP_401_UNAUTHORIZED
                )

            # Begin transaction for all updates
            with transaction.atomic():
                data = serializer.validated_data

                # Update AlumniProfile (personal & academic info)
                personal = data.get('personal_information', {})
                academic = data.get('academic_preemployment', {})
                profile = alumni.profile

                profile.first_name = personal.get('first_name', profile.first_name)
                profile.middle_name = personal.get('middle_name', '')
                profile.last_name = personal.get('last_name', profile.last_name)
                profile.gender = personal.get('gender', profile.gender)
                profile.birth_date = str(personal.get('birth_date', ''))
                profile.civil_status = personal.get('civil_status', '')
                profile.mobile = personal.get('mobile', profile.mobile)
                profile.city = personal.get('city', profile.city)
                profile.province = personal.get('province', profile.province)

                # Education fields
                edu = data.get('educational_background', {})
                profile.graduation_date = str(edu.get('graduation_date', ''))
                profile.graduation_year = edu.get('graduation_year')
                profile.scholarship = edu.get('scholarship', '')
                profile.highest_attainment = edu.get('highest_attainment', 'NA')
                profile.graduate_school = edu.get('graduate_school', '')
                profile.prof_eligibility = edu.get('professional_eligibility', '')

                # Academic profile fields (general_average_range removed per the
                # 2026 panel revision; the column is kept for historical rows)
                profile.academic_honors = academic.get('academic_honors')
                profile.prior_work_experience = academic.get('prior_work_experience', False)
                profile.ojt_relevance = academic.get('ojt_relevance')
                profile.has_portfolio = academic.get('has_portfolio', False)

                # Skill counts
                competency = data.get('competency_assessment', {})
                profile.technical_skill_count = competency.get('technical_skill_count', 0)
                profile.soft_skill_count = competency.get('soft_skill_count', 0)
                profile.professional_certifications = competency.get('professional_certifications', [])

                profile.save()

                # Create/Update EmploymentProfile
                emp_data = data.get('employment_status', {})
                first_job = data.get('first_job_details', {})
                current_job = data.get('current_job_details', {})

                emp_profile, created = EmploymentProfile.objects.get_or_create(alumni=alumni)
                emp_profile.employment_status = emp_data.get('employment_status')
                emp_profile.time_to_hire_raw = first_job.get('time_to_hire_raw')
                emp_profile.time_to_hire_months = first_job.get('time_to_hire_months')
                emp_profile.first_job_sector = first_job.get('first_job_sector')
                emp_profile.first_job_status = first_job.get('first_job_status')
                emp_profile.first_job_title = first_job.get('first_job_title')
                emp_profile.first_job_related_to_bsis = first_job.get('first_job_related_to_bsis')
                emp_profile.first_job_applications_count = first_job.get('first_job_applications_count')
                emp_profile.first_job_source = first_job.get('first_job_source')
                emp_profile.current_job_sector = current_job.get('current_job_sector')
                emp_profile.current_job_title = current_job.get('current_job_title')
                emp_profile.current_job_company = current_job.get('current_job_company')
                emp_profile.current_job_related_to_bsis = current_job.get('current_job_related_to_bsis')
                emp_profile.location_type = current_job.get('location_type')
                emp_profile.survey_completion_status = 'completed'
                emp_profile.save()

                # Create/Update WorkAddress
                work_addr_data = data.get('work_address', {})
                work_addr, created = WorkAddress.objects.get_or_create(
                    alumni=alumni,
                    is_current=True
                )
                work_addr.employment_profile = emp_profile
                work_addr.street_address = work_addr_data.get('street_address', '')
                work_addr.barangay = work_addr_data.get('barangay', '')
                work_addr.city_municipality = work_addr_data.get('city_municipality')
                work_addr.province = work_addr_data.get('province')
                work_addr.region = work_addr_data.get('region')
                work_addr.zip_code = work_addr_data.get('zip_code', '')
                work_addr.country = work_addr_data.get('country', 'Philippines')
                work_addr.latitude = work_addr_data.get('latitude')
                work_addr.longitude = work_addr_data.get('longitude')
                work_addr.save()

                # Create/Update CompetencyProfile
                comp_profile, created = CompetencyProfile.objects.get_or_create(alumni=alumni)
                comp_profile.technical_skills = competency.get('technical_skills', [])
                comp_profile.soft_skills = competency.get('soft_skills', [])
                comp_profile.technical_skill_count = competency.get('technical_skill_count', 0)
                comp_profile.soft_skill_count = competency.get('soft_skill_count', 0)
                comp_profile.professional_certifications = competency.get('professional_certifications', '')
                comp_profile.save()

            return Response(
                {
                    'status': 'success',
                    'message': 'Survey submitted successfully',
                    'alumni_id': str(alumni.id),
                    'completion_status': 'completed',
                    'data_quality_score': validation_result['completeness_score']
                },
                status=status.HTTP_201_CREATED
            )

        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

# ── Survey Data Retrieval ──────────────────────────────────────────────────────

class SurveyDataRetrievalView(APIView):
    """
    GET /api/tracer/survey/

    Retrieve current survey completion status and all submitted data
    """

    permission_classes = []  # Authenticated alumni only

    def get(self, request):
        _alumni_account, _auth_error = require_alumni(request)
        if _auth_error:
            return _auth_error
        """Get survey data for authenticated alumni"""
        try:
            alumni = request.user.alumni_account
        except AttributeError:
            return Response(
                {'error': 'Alumni account not found'},
                status=status.HTTP_401_UNAUTHORIZED
            )

        from tracer.models import EmploymentProfile, WorkAddress, CompetencyProfile

        try:
            profile = alumni.profile
            emp_profile = alumni.employment_profiles.first()
            work_addr = alumni.work_addresses.filter(is_current=True).first()
            comp_profile = alumni.competency_profiles.first()
        except Exception as e:
            return Response(
                {'error': f'Error retrieving profile: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

        # Determine completion status
        sections_completed = []
        if profile:
            if profile.first_name and profile.graduation_year:
                sections_completed.extend(['personal_information', 'educational_background'])
            if profile.general_average_range is not None or profile.academic_honors is not None:
                sections_completed.append('academic_preemployment')

        if emp_profile:
            if emp_profile.employment_status:
                sections_completed.append('employment_status')
            if emp_profile.first_job_title:
                sections_completed.append('first_job_details')
            if emp_profile.current_job_title:
                sections_completed.append('current_job_details')

        if work_addr:
            sections_completed.append('work_address')

        if comp_profile and (comp_profile.technical_skill_count > 0 or comp_profile.soft_skill_count > 0):
            sections_completed.append('competency_assessment')

        completion_status = 'completed' if len(sections_completed) == 8 else 'in_progress'

        return Response(
            {
                'completion_status': completion_status,
                'last_updated': profile.updated_at if profile else None,
                'sections_completed': sections_completed,
                'data': {
                    'personal_information': {
                        'first_name': profile.first_name if profile else '',
                        'last_name': profile.last_name if profile else '',
                        'gender': profile.gender if profile else '',
                        'city': profile.city if profile else '',
                        'province': profile.province if profile else '',
                    } if profile else {},
                    'employment_profile': {
                        'employment_status': emp_profile.employment_status if emp_profile else '',
                        'time_to_hire_months': emp_profile.time_to_hire_months if emp_profile else None,
                        'first_job_sector': emp_profile.first_job_sector if emp_profile else '',
                    } if emp_profile else {},
                    'work_address': {
                        'city_municipality': work_addr.city_municipality if work_addr else '',
                        'province': work_addr.province if work_addr else '',
                        'region': work_addr.region if work_addr else '',
                    } if work_addr else {},
                    'competency': {
                        'technical_skill_count': comp_profile.technical_skill_count if comp_profile else 0,
                        'soft_skill_count': comp_profile.soft_skill_count if comp_profile else 0,
                    } if comp_profile else {},
                }
            },
            status=status.HTTP_200_OK
        )

# ── Admin Analytics - Employability ────────────────────────────────────────────
# Observed indicators and the gated "employed within 12 months" model live in
# tracer/employability.py. The model this replaced used job-profile answers that
# only employed graduates can give, so it read the registration form's skip logic
# instead of predicting employability (documentations/10-ml-pipeline-methodology.md,
# sections 11 to 13).

class AdminAnalyticsPredictionsView(APIView):
    """
    GET /api/admin/analytics/employability-predictions/?batch=YYYY&horizon=1|2

    Observed indicators per batch (sample sizes, Wilson 95% intervals, small
    groups suppressed), the expected employment range for the next batches,
    the active "employed within 12 months" model if one has passed the
    acceptance gate, and a summary of the skills graduates listed. `batch` narrows the overall
    summary only; the per-batch list always covers every batch.
    """

    permission_classes = []  # Admin only - set in middleware

    def get(self, request):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        import logging
        from django.core.cache import cache
        from . import employability

        batch = None
        batch_param = request.query_params.get("batch")
        if batch_param:
            try:
                batch = int(batch_param)
            except ValueError:
                return Response({"error": "batch must be integer"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            horizon = max(1, min(2, int(request.query_params.get("horizon", 1))))
        except (TypeError, ValueError):
            horizon = 1

        # Cached briefly so switching the batch filter or horizon does not
        # rebuild the frame. Indicators still reflect account changes within
        # 90 seconds; the model itself only changes through the training command.
        # Real graduates or the seeded simulated ones, as chosen on /admin/debug/a.
        source = employability.analytics_source()
        cache_key = employability.frame_cache_key(source)
        frame = cache.get(cache_key)
        if frame is None:
            try:
                frame = employability.build_graduate_frame(source=source)
            except Exception as exc:  # noqa: BLE001
                logging.getLogger(__name__).exception("Employability analytics: graduate records failed to load")
                return Response(
                    {"error": "Graduate records could not be loaded", "detail": f"{type(exc).__name__}: {exc}"},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
            cache.set(cache_key, frame, 90)

        payload = employability.analytics_payload(
            frame,
            employability.masterlist_counts(source),
            employability.load_active_model(source),
            batch=batch,
            horizon=horizon,
            source=source,
        )
        try:
            payload["skills"] = employability.skill_summary(employability.reportable(frame))
        except Exception:  # noqa: BLE001
            logging.getLogger(__name__).exception("Employability analytics: skill summary failed")
            payload["skills"] = {
                "respondents": 0, "labor_force": 0, "min_group": employability.MIN_GROUP,
                "hidden_skills": 0, "skills": [],
            }
        payload["timestamp"] = timezone.now().isoformat()
        return Response(payload, status=status.HTTP_200_OK)

class DataQualityReportView(APIView):
    """
    GET /api/admin/analytics/data-quality-report/

    Get summary of data validation metrics across all submissions (admin only)
    """

    permission_classes = []  # Admin only

    def get(self, request):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        """Get data quality report"""
        from tracer.models import EmploymentProfile

        # Query all employment profiles
        all_profiles = EmploymentProfile.objects.all()
        total_surveys = all_profiles.count()

        # Count valid surveys (those with completed status)
        valid_surveys = all_profiles.filter(survey_completion_status='completed').count()

        # Mock field error summary - in production, would query validation logs
        field_error_summary = {
            'employment_status': 0,
            'time_to_hire_months': 0,
            'work_address': 0,
            'skill_counts': 0
        }

        validity_rate = (valid_surveys / total_surveys * 100) if total_surveys > 0 else 0
        avg_completeness = 92.5  # Placeholder

        return Response(
            {
                'total_surveys': total_surveys,
                'valid_surveys': valid_surveys,
                'validity_rate': validity_rate,
                'avg_completeness': avg_completeness,
                'field_error_summary': field_error_summary,
                'consistency_rate': 98.5,
                'recommendations': [
                    'Monitor GPA range submissions for completeness',
                    'Verify time-to-hire data is being collected',
                    'Cross-check employment status coherence'
                ]
            },
            status=status.HTTP_200_OK
        )