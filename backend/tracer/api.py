import json
import re
from datetime import timedelta

from django.core import signing
from django.core.signing import BadSignature, SignatureExpired
from django.db import transaction
from django.db import DatabaseError, OperationalError
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import AccountStatus, EmployerAccount, User

from .models import (
    EmploymentRecord,
    Industry,
    JobTitle,
    Region,
    Skill,
    SkillCategory,
    VerificationDecision,
    VerificationToken,
)


# ── Helpers ────────────────────────────────────────────────────────────────────

_EMPLOYER_TOKEN_SALT = "users.employer.access"
_EMPLOYER_TOKEN_TTL_SECONDS = 60 * 60 * 8
_VERIFICATION_TOKEN_DEFAULT_TTL_DAYS = 7
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


def _require_employer(request, *, allow_pending: bool = False) -> tuple[EmployerAccount | None, Response | None]:
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
        user = User.objects.filter(id=user_id, role=User.Role.EMPLOYER, is_active=True).first()
        employer_account = (
            EmployerAccount.objects.select_related("user")
            .filter(user=user)
            .first()
        )
    except (OperationalError, DatabaseError):
        return None, _database_unavailable_response()

    if not user or not employer_account:
        return None, Response(
            {"detail": "Employer account was not found."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    if employer_account.account_status in {
        AccountStatus.REJECTED,
        AccountStatus.SUSPENDED,
    }:
        return None, Response(
            {
                "detail": (
                    f"Employer account access blocked ({employer_account.account_status}). "
                    "Contact the administrator."
                ),
            },
            status=status.HTTP_403_FORBIDDEN,
        )

    if employer_account.account_status != AccountStatus.ACTIVE and not (
        allow_pending and employer_account.account_status == AccountStatus.PENDING
    ):
        return None, Response(
            {
                "detail": "Employer account is not active. Approval is required before verification actions.",
            },
            status=status.HTTP_403_FORBIDDEN,
        )

    return employer_account, None

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
        "is_active": r.is_active,
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
        "employerId": str(decision.employer_account_id),
        "isHeld": decision.is_held,
        "heldActivatedAt": decision.held_activated_at.isoformat() if decision.held_activated_at else None,
    }


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
        name = (request.data.get("name") or "").strip()
        industry_id = request.data.get("industry_id") or None
        if not name:
            return Response({"detail": "name is required."}, status=status.HTTP_400_BAD_REQUEST)
        if JobTitle.objects.filter(name__iexact=name).exists():
            return Response({"detail": "Job title already exists."}, status=status.HTTP_409_CONFLICT)
        industry = None
        if industry_id:
            try:
                industry = Industry.objects.get(pk=industry_id)
            except Industry.DoesNotExist:
                return Response({"detail": "Industry not found."}, status=status.HTTP_400_BAD_REQUEST)
        jt = JobTitle.objects.create(name=name, industry=industry)
        return Response({"job_title": _serialize_job_title(jt)}, status=status.HTTP_201_CREATED)


class JobTitleDetailView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def patch(self, request, pk):
        try:
            jt = JobTitle.objects.select_related("industry").get(pk=pk)
        except JobTitle.DoesNotExist:
            return Response({"detail": "Job title not found."}, status=status.HTTP_404_NOT_FOUND)
        if "name" in request.data:
            jt.name = (request.data["name"] or "").strip() or jt.name
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
        try:
            jt = JobTitle.objects.get(pk=pk)
        except JobTitle.DoesNotExist:
            return Response({"detail": "Job title not found."}, status=status.HTTP_404_NOT_FOUND)
        jt.is_active = False
        jt.save(update_fields=["is_active"])
        return Response(status=status.HTTP_204_NO_CONTENT)


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
        try:
            region = Region.objects.get(pk=pk)
        except Region.DoesNotExist:
            return Response({"detail": "Region not found."}, status=status.HTTP_404_NOT_FOUND)
        region.is_active = False
        region.save(update_fields=["is_active"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class VerificationTokenIssueView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        employer_account, error_response = _require_employer(request, allow_pending=True)
        if error_response:
            return error_response

        alumni_id = request.data.get("alumni_id")
        employment_record_id = request.data.get("employment_record_id")

        if not alumni_id and not employment_record_id:
            return Response(
                {"detail": "alumni_id or employment_record_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            record_query = EmploymentRecord.objects.select_related("job_title", "region", "alumni")
            if employment_record_id:
                record = record_query.filter(id=employment_record_id).first()
            else:
                record = record_query.filter(alumni_id=alumni_id, is_current=True).first()

            if not record:
                return Response(
                    {"detail": "Employment record was not found."},
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

            with transaction.atomic():
                VerificationToken.objects.filter(
                    employment_record=record,
                    status=VerificationToken.Status.PENDING,
                ).update(status=VerificationToken.Status.REVOKED)

                token = VerificationToken.objects.create(
                    alumni=record.alumni,
                    employment_record=record,
                    expires_at=timezone.now() + timedelta(days=ttl_days),
                )
        except (OperationalError, DatabaseError):
            return _database_unavailable_response()

        return Response(
            {
                "message": "Verification token issued.",
                "token": _serialize_verification_token(token),
                "employmentRecord": _serialize_employment_record(record),
                "issuedByEmployerId": str(employer_account.id),
            },
            status=status.HTTP_201_CREATED,
        )


class EmployerVerifiableGraduateListView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        employer_account, error_response = _require_employer(request, allow_pending=True)
        if error_response:
            return error_response

        employer_company = (
            request.query_params.get("company")
            or employer_account.company_name
            or ""
        ).strip()
        query_text = (request.query_params.get("q") or "").strip().lower()
        year_param = request.query_params.get("year")

        filter_year = None
        if year_param not in (None, ""):
            try:
                filter_year = int(str(year_param))
            except (TypeError, ValueError):
                return Response(
                    {"detail": "year must be a valid number."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        try:
            records = list(
                EmploymentRecord.objects.select_related(
                    "alumni__user",
                    "alumni__profile",
                    "alumni__master_record",
                    "job_title__industry",
                )
                .prefetch_related("alumni__face_scans", "alumni__skills__skill")
                .filter(
                    is_current=True,
                    alumni__account_status=AccountStatus.ACTIVE,
                )
                .order_by("-updated_at")
            )
        except (OperationalError, DatabaseError):
            return _database_unavailable_response()

        results: list[dict] = []
        for record in records:
            if employer_company and not _companies_match(employer_company, record.employer_name_input):
                continue

            graduate_payload = _serialize_employer_verifiable_graduate(record)

            if filter_year is not None and graduate_payload.get("graduationYear") != filter_year:
                continue

            graduate_name = str(graduate_payload.get("name") or "").lower()
            if query_text and query_text not in graduate_name:
                continue

            results.append(graduate_payload)

        results.sort(key=lambda item: str(item.get("name") or "").lower())

        return Response(
            {
                "results": results,
                "count": len(results),
                "company": employer_company,
            }
        )


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
            alumni_name = token.alumni.user.email

        return Response(
            {
                "token": _serialize_verification_token(token),
                "alumni": {
                    "id": str(token.alumni_id),
                    "name": alumni_name,
                    "email": token.alumni.user.email,
                },
                "employmentRecord": _serialize_employment_record(token.employment_record),
            }
        )


class VerificationTokenDecisionView(APIView):
    parser_classes = [JSONParser]
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, token_id):
        employer_account, error_response = _require_employer(request, allow_pending=True)
        if error_response:
            return error_response

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

        verified_employer_name = str(
            request.data.get("verified_employer_name")
            or employer_account.company_name
            or employment_record.employer_name_input
            or ""
        ).strip()
        comment = str(request.data.get("comment") or "").strip()
        is_held_decision = employer_account.account_status == AccountStatus.PENDING

        try:
            with transaction.atomic():
                decision = VerificationDecision.objects.create(
                    employer_account=employer_account,
                    token=token,
                    verified_employer_name=verified_employer_name,
                    verified_job_title=verified_job_title,
                    decision=raw_decision,
                    comment=comment,
                    is_held=is_held_decision,
                )

                if not is_held_decision:
                    employment_record.employer_account = employer_account
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
                            "employer_account",
                            "employer_name_input",
                            "job_title",
                            "job_title_input",
                            "verification_status",
                            "updated_at",
                        ]
                    )

                token.employment_record = employment_record
                token.mark_used()

                VerificationToken.objects.filter(
                    employment_record=employment_record,
                    status=VerificationToken.Status.PENDING,
                ).exclude(token_id=token.token_id).update(status=VerificationToken.Status.REVOKED)
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
        regions = list(Region.objects.filter(is_active=True).order_by("name"))

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

                # Academic profile fields
                profile.general_average_range = academic.get('general_average_range')
                profile.academic_honors = academic.get('academic_honors')
                profile.prior_work_experience = academic.get('prior_work_experience', False)
                profile.ojt_relevance = academic.get('ojt_relevance')
                profile.has_portfolio = academic.get('has_portfolio', False)
                profile.english_proficiency = academic.get('english_proficiency')

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


# ── Admin Analytics - Employability Predictions ────────────────────────────────

_ML_CACHE: dict = {}


def _load_ml_artifacts():
    """Lazy-load joblib models + processed population CSV. Only successful loads are cached."""
    if _ML_CACHE and "models" in _ML_CACHE:
        return _ML_CACHE
    import traceback
    try:
        from pathlib import Path
        import json as _json
        import joblib
        import pandas as pd

        root = Path(__file__).resolve().parents[2] / "EyeOfTheTiger"
        models = joblib.load(root / "models" / "employability_model.joblib")
        scaler = joblib.load(root / "models" / "feature_scaler.joblib")
        with (root / "models" / "model_metadata.json").open("r", encoding="utf-8") as f:
            meta = _json.load(f)
        df = pd.read_csv(root / "data" / "processed_training_data.csv")

        _ML_CACHE.clear()
        _ML_CACHE.update({
            "models": models, "scaler": scaler, "meta": meta,
            "df": df, "features": meta["features"],
            "source_path": str(root),
        })
        return _ML_CACHE
    except Exception as exc:  # noqa: BLE001
        return {"error": f"{type(exc).__name__}: {exc}", "traceback": traceback.format_exc()}


def _aggregate_for_cohort(artifacts: dict, cohort: int | None) -> dict:
    import numpy as np
    df = artifacts["df"]
    subset = df if cohort is None else df[df["cohort"] == cohort]
    if subset.empty:
        return {"n_alumni": 0}

    feats = artifacts["features"]
    X = artifacts["scaler"].transform(subset[feats])
    models = artifacts["models"]

    pred_emp = models["employment_status"].predict(X).astype(int)
    pred_tth = models["time_to_hire"].predict(X)

    actual_emp = subset["employment_status"].astype(int).to_numpy()
    actual_first = subset["bsis_related_job_first"].dropna().astype(int)
    actual_curr = subset["bsis_related_job_current"].dropna().astype(int)
    actual_tth = subset["time_to_hire_months"].dropna().to_numpy()

    buckets = {"1-3 months": 0, "3-6 months": 0, "6-12 months": 0, ">12 months": 0}
    for t in pred_tth:
        if t < 3:
            buckets["1-3 months"] += 1
        elif t < 6:
            buckets["3-6 months"] += 1
        elif t < 12:
            buckets["6-12 months"] += 1
        else:
            buckets[">12 months"] += 1

    return {
        "n_alumni": int(len(subset)),
        "actual_employment_rate": float(actual_emp.mean()) if len(actual_emp) else 0.0,
        "predicted_employment_rate": float(pred_emp.mean()),
        "actual_mean_time_to_hire_months": float(actual_tth.mean()) if len(actual_tth) else 0.0,
        "predicted_mean_time_to_hire_months": float(np.mean(pred_tth)),
        "actual_bsis_first_rate": float(actual_first.mean()) if len(actual_first) else 0.0,
        "actual_bsis_current_rate": float(actual_curr.mean()) if len(actual_curr) else 0.0,
        "time_to_hire_distribution": buckets,
    }


class AdminAnalyticsPredictionsView(APIView):
    """
    GET /api/admin/analytics/employability-predictions/?cohort=YYYY

    Returns aggregate model predictions. If ?cohort is omitted, returns
    per-cohort breakdown across the full trained population.
    """

    permission_classes = []  # Admin only - set in middleware

    def get(self, request):
        cohort_param = request.query_params.get("cohort")
        cohort = None
        if cohort_param:
            try:
                cohort = int(cohort_param)
            except ValueError:
                return Response({"error": "cohort must be integer"}, status=status.HTTP_400_BAD_REQUEST)

        artifacts = _load_ml_artifacts()
        if "error" in artifacts:
            import logging
            logging.getLogger(__name__).error(
                "ML artifacts failed to load: %s\n%s",
                artifacts["error"],
                artifacts.get("traceback", ""),
            )
            return Response(
                {
                    "error": "ML artifacts unavailable",
                    "detail": artifacts["error"],
                    "traceback": artifacts.get("traceback"),
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        overall = _aggregate_for_cohort(artifacts, cohort)
        per_cohort = []
        for c in sorted(artifacts["df"]["cohort"].unique().tolist()):
            entry = _aggregate_for_cohort(artifacts, int(c))
            entry["cohort"] = int(c)
            per_cohort.append(entry)

        meta = artifacts["meta"]
        best = {k: v.get("best_model") for k, v in meta.get("targets", {}).items()}

        return Response({
            "cohort": cohort,
            "overall": overall,
            "per_cohort": per_cohort,
            "model_metadata": {
                "trained_at": meta.get("trained_at"),
                "n_samples": meta.get("n_samples"),
                "n_features": meta.get("n_features"),
                "best_models": best,
                "targets": {
                    k: {
                        "best_model": v.get("best_model"),
                        "metrics": v.get("candidates", {}).get(v.get("best_model"), {}),
                    }
                    for k, v in meta.get("targets", {}).items()
                },
            },
            "timestamp": timezone.now().isoformat(),
        }, status=status.HTTP_200_OK)


# ── Data Export for Model Training ────────────────────────────────────────────

class TrainingDataExportView(APIView):
    """
    GET /api/admin/analytics/export-training-data/

    Export cleaned alumni data for ML model training (admin only)
    Returns CSV format with all 17 predictors + 4 targets
    """

    permission_classes = []  # Admin only

    def get(self, request):
        """Export training data"""
        import csv
        from io import StringIO

        start_cohort = request.query_params.get('start_cohort', 2020)
        end_cohort = request.query_params.get('end_cohort', 2025)
        include_unverified = request.query_params.get('include_unverified', 'false').lower() == 'true'

        try:
            start_cohort = int(start_cohort)
            end_cohort = int(end_cohort)
        except ValueError:
            return Response(
                {'error': 'Cohort parameters must be integers'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Query alumni with completed surveys
        from users.models import AlumniProfile
        from tracer.models import EmploymentProfile, CompetencyProfile

        alumni_profiles = AlumniProfile.objects.filter(
            graduation_year__gte=start_cohort,
            graduation_year__lte=end_cohort
        ).select_related('alumni')

        # Create CSV
        output = StringIO()
        fieldnames = [
            'alumni_id', 'cohort', 'gender', 'scholarship',
            'general_average_range', 'academic_honors', 'prior_work_experience',
            'ojt_relevance', 'has_portfolio', 'english_proficiency',
            'job_applications_count', 'job_source', 'first_job_sector',
            'first_job_status', 'technical_skill_count', 'soft_skill_count',
            'location_type', 'current_job_sector',
            'time_to_hire_months', 'employment_status', 'bsis_related_first',
            'bsis_related_current', 'data_quality_score'
        ]

        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()

        for profile in alumni_profiles:
            emp_profile = profile.alumni.employment_profiles.first()
            comp_profile = profile.alumni.competency_profiles.first()

            if not emp_profile:
                continue  # Skip if no employment data

            row = {
                'alumni_id': str(profile.alumni.id),
                'cohort': profile.graduation_year,
                'gender': 1 if profile.gender and profile.gender.upper() == 'F' else 0,
                'scholarship': 1 if profile.scholarship else 0,
                'general_average_range': profile.general_average_range,
                'academic_honors': profile.academic_honors,
                'prior_work_experience': 1 if profile.prior_work_experience else 0,
                'ojt_relevance': profile.ojt_relevance,
                'has_portfolio': 1 if profile.has_portfolio else 0,
                'english_proficiency': profile.english_proficiency,
                'job_applications_count': emp_profile.first_job_applications_count,
                'job_source': emp_profile.first_job_source,
                'first_job_sector': emp_profile.first_job_sector,
                'first_job_status': emp_profile.first_job_status,
                'technical_skill_count': profile.technical_skill_count,
                'soft_skill_count': profile.soft_skill_count,
                'location_type': 1 if emp_profile.location_type else 0,
                'current_job_sector': emp_profile.current_job_sector,
                'time_to_hire_months': emp_profile.time_to_hire_months,
                'employment_status': 1 if emp_profile.employment_status in ['employed_full_time', 'employed_part_time', 'self_employed'] else 0,
                'bsis_related_first': 1 if emp_profile.first_job_related_to_bsis else 0,
                'bsis_related_current': 1 if emp_profile.current_job_related_to_bsis else 0,
                'data_quality_score': 85.0  # Placeholder - calculate from validation metrics
            }
            writer.writerow(row)

        csv_content = output.getvalue()

        from django.http import HttpResponse
        response = HttpResponse(csv_content, content_type='text/csv')
        response['Content-Disposition'] = f'attachment; filename="training_data_{start_cohort}_{end_cohort}.csv"'
        return response


# ── Data Quality Report ────────────────────────────────────────────────────────

class DataQualityReportView(APIView):
    """
    GET /api/admin/analytics/data-quality-report/

    Get summary of data validation metrics across all submissions (admin only)
    """

    permission_classes = []  # Admin only

    def get(self, request):
        """Get data quality report"""
        from tracer.models import EmploymentProfile

        # Query all employment profiles
        all_profiles = EmploymentProfile.objects.all()
        total_surveys = all_profiles.count()

        # Count valid surveys (those with completed status)
        valid_surveys = all_profiles.filter(survey_completion_status='completed').count()

        # Mock field error summary - in production, would query validation logs
        field_error_summary = {
            'general_average_range': 0,
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