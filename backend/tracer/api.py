import json

from django.db import transaction
from rest_framework import status
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Industry, JobTitle, Skill, SkillCategory, Region


# ── Helpers ────────────────────────────────────────────────────────────────────

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
        qs = Region.objects.filter(is_active=True).order_by("name")
        return Response({"regions": [_serialize_region(r) for r in qs]})


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