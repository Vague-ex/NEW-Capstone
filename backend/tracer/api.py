import json
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


def _require_employer(request) -> tuple[EmployerAccount | None, Response | None]:
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

    if employer_account.account_status != AccountStatus.ACTIVE:
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
    }


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
        employer_account, error_response = _require_employer(request)
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
        employer_account, error_response = _require_employer(request)
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

        try:
            with transaction.atomic():
                decision = VerificationDecision.objects.create(
                    employer_account=employer_account,
                    token=token,
                    verified_employer_name=verified_employer_name,
                    verified_job_title=verified_job_title,
                    decision=raw_decision,
                    comment=comment,
                )

                employment_record.employer_account = employer_account
                employment_record.employer_name_input = verified_employer_name or employment_record.employer_name_input
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

        return Response(
            {
                "message": "Verification decision submitted.",
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