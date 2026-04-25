"""
Translate the flat camelCase ``survey_data`` blob (sent by the alumni
employment / skills / personal-info forms) into the normalized rows that
populate the Phase-5 analytics tables.

The blob arrives via ``AlumniEmploymentUpdateView`` (``/api/auth/alumni/
account/<id>/employment/``). Until this module existed, the view stored the
blob inside ``AlumniAccount.biometric_template`` only — leaving the four
normalized tables (``EmploymentProfile``, ``WorkAddress``,
``CompetencyProfile``, ``EmploymentRecord``) empty even after thousands of
PATCHes.

``apply_survey_data_to_normalized_tables`` is the single entry point. It is
idempotent (uses ``update_or_create``) and is safe to call on every save.
The mapping tables are intentionally generous: legacy keys, snake_case
keys and human-readable labels all collapse to the same enum value.
"""

from __future__ import annotations

import logging
from typing import Any

from django.db import transaction

logger = logging.getLogger(__name__)


# ─── Label → enum mappers ────────────────────────────────────────────────────

_TIME_TO_HIRE_MONTHS = {
    "within 1 month": 1.0,
    "1 - 3 months": 3.0,
    "1-3 months": 3.0,
    "3 - 6 months": 4.5,
    "3-6 months": 4.5,
    "6 months to 1 year": 9.0,
    "1 - 2 years": 18.0,
    "1-2 years": 18.0,
    "more than 2 years": 30.0,
    "2+ years": 30.0,
}

_SECTOR = {
    "government": "government",
    "private": "private",
    "entrepreneurial": "entrepreneurial",
    "entrepreneurial / freelance / self-employed": "entrepreneurial",
    "entrepreneurial/freelance/self-employed": "entrepreneurial",
    "self-employed": "entrepreneurial",
    "freelance": "entrepreneurial",
}

_JOB_STATUS = {
    "regular/permanent": "regular",
    "regular": "regular",
    "permanent": "regular",
    "probationary": "probationary",
    "contractual/casual/job order": "contractual",
    "contractual": "contractual",
    "casual": "contractual",
    "self-employed / freelance": "self_employed",
    "self-employed/freelance": "self_employed",
    "self_employed": "self_employed",
}

_JOB_SOURCE = {
    "online job portal (jobstreet, linkedin, etc.)": "online_portal",
    "online job portal": "online_portal",
    "online_portal": "online_portal",
    "chmsu career orientation / job fair": "career_fair",
    "chmsu career fair": "career_fair",
    "career_fair": "career_fair",
    "personal network / referral": "personal_network",
    "personal network/referral": "personal_network",
    "personal_network": "personal_network",
    "company walk-in / direct hire": "walk_in",
    "company walk-in/direct hire": "walk_in",
    "walk_in": "walk_in",
    "social media (facebook groups, etc.)": "social_media",
    "social media": "social_media",
    "social_media": "social_media",
    "started own business / freelance platform": "entrepreneurship",
    "started own business/freelance platform": "entrepreneurship",
    "entrepreneurship": "entrepreneurship",
    "others": "other",
    "other": "other",
}

_JOB_RETENTION_MONTHS = {
    "less than 3 months": 2,
    "3 - 6 months": 4,
    "3-6 months": 4,
    "6 months to 1 year": 9,
    "1 - 2 years": 18,
    "1-2 years": 18,
    "more than 2 years": 30,
    "2+ years": 30,
    "currently in first job": None,  # unknown end date
}

_JOB_APPLICATIONS_BUCKET = {
    "1 - 5 applications": 1,
    "1-5 applications": 1,
    "1-5": 1,
    "6 - 15 applications": 2,
    "6-15 applications": 2,
    "6-15": 2,
    "16 - 30 applications": 3,
    "16-30 applications": 3,
    "16-30": 3,
    "31+ applications": 4,
    "31+": 4,
}

_EMPLOYMENT_STATUS = {
    "employed_full_time": "employed_full_time",
    "employed full-time": "employed_full_time",
    "yes, full-time": "employed_full_time",
    "employed_part_time": "employed_part_time",
    "employed part-time": "employed_part_time",
    "yes, part-time": "employed_part_time",
    "self_employed": "self_employed",
    "self-employed": "self_employed",
    "yes, self-employed/freelance": "self_employed",
    "seeking": "seeking",
    "no, currently seeking employment": "seeking",
    "not_seeking": "not_seeking",
    "no, not seeking employment (further studies, personal reasons)": "not_seeking",
    "never_employed": None,  # not in EmploymentProfile choices
    "never employed": None,
}


def _norm(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip().lower()


def _map(table: dict[str, Any], value: Any) -> Any:
    return table.get(_norm(value))


def _related_to_bsis(label: Any) -> bool | None:
    n = _norm(label)
    if not n or n == "not applicable":
        return None
    if n.startswith("yes") or "directly related" in n:
        return True
    if "somewhat" in n:
        return True  # treat semi-related as related for the boolean field
    if "not related" in n or n.startswith("no"):
        return False
    return None


def _is_local(label: Any) -> bool | None:
    n = _norm(label)
    if not n:
        return None
    if "local" in n or "philippines" in n:
        return True
    if "abroad" in n or "remote" in n or "foreign" in n:
        return False
    return None


def _to_int(value: Any) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _to_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    n = _norm(value)
    return n in {"true", "1", "yes", "y"}


def _split_skills(value: Any) -> list[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [str(s).strip() for s in value if str(s).strip()]
    if isinstance(value, str):
        return [s.strip() for s in value.split(",") if s.strip()]
    return []


def _resolve_region_choice(survey_data: dict, region_name_hint: str = "") -> str | None:
    """Resolve a region choice value usable by ``WorkAddress.region``.

    Frontend sends ``currentJobRegionId`` (UUID) or ``region_address`` (string).
    Returns the choice key (e.g. ``"Region VI"``, ``"NCR"``, ``"Abroad"``) or
    ``None`` if it can't be matched.
    """
    from tracer.models import Region, WorkAddress

    valid_choices = {c[0] for c in WorkAddress.RegionChoices.choices}

    # Direct string from form
    direct = survey_data.get("region_address") or region_name_hint
    if isinstance(direct, str) and direct.strip() in valid_choices:
        return direct.strip()

    # Lookup by UUID
    region_id = survey_data.get("currentJobRegionId") or survey_data.get("region_id")
    if region_id:
        try:
            region = Region.objects.filter(id=region_id).first()
            if region:
                if region.code in valid_choices:
                    return region.code
                if region.name in valid_choices:
                    return region.name
        except Exception:
            pass

    # Country fallback: anything non-Philippines counts as Abroad
    country = _norm(survey_data.get("country_address"))
    if country and country not in {"philippines", "ph", "philippine"}:
        return "Abroad"

    return None


# ─── Public API ─────────────────────────────────────────────────────────────


@transaction.atomic
def apply_survey_data_to_normalized_tables(alumni_account, survey_data: dict) -> dict:
    """Upsert AlumniProfile / EmploymentProfile / WorkAddress / CompetencyProfile /
    EmploymentRecord rows from a flat camelCase survey blob.

    Returns a dict describing which tables were touched (handy for logging / tests).
    """
    from tracer.models import (
        CompetencyProfile,
        EmploymentProfile,
        EmploymentRecord,
        WorkAddress,
    )
    from .models import AlumniProfile, EmployerAccount

    if not isinstance(survey_data, dict):
        return {"applied": False, "reason": "survey_data is not a dict"}

    sd = survey_data
    touched: dict[str, bool] = {}

    # ─── AlumniProfile (personal + academic) ────────────────────────────────
    profile_updates: dict[str, Any] = {}

    # Personal info (alumni-profile.tsx feeds these via mobile / phone keys)
    if sd.get("mobile") or sd.get("phone"):
        profile_updates["mobile"] = sd.get("mobile") or sd.get("phone") or ""

    for key_src, key_dst in (
        ("first_name", "first_name"),
        ("middle_name", "middle_name"),
        ("last_name", "last_name"),
        ("gender", "gender"),
        ("civil_status", "civil_status"),
        ("birth_date", "birth_date"),
        ("city", "city"),
        ("province", "province"),
        ("graduation_date", "graduation_date"),
        ("scholarship", "scholarship"),
        ("highest_attainment", "highest_attainment"),
        ("graduate_school", "graduate_school"),
        ("facebook_url", "facebook_url"),
    ):
        if sd.get(key_src) not in (None, ""):
            profile_updates[key_dst] = sd[key_src]

    # Academic encoded values (Section 3 of questionnaire)
    if (val := _to_int(sd.get("general_average_range"))) is not None:
        profile_updates["general_average_range"] = val
    if (val := _to_int(sd.get("academic_honors"))) is not None:
        profile_updates["academic_honors"] = val
    if "prior_work_experience" in sd:
        profile_updates["prior_work_experience"] = _to_bool(sd["prior_work_experience"])
    if (val := _to_int(sd.get("ojt_relevance"))) is not None:
        profile_updates["ojt_relevance"] = val
    if "has_portfolio" in sd:
        profile_updates["has_portfolio"] = _to_bool(sd["has_portfolio"])
    if (val := _to_int(sd.get("english_proficiency"))) is not None:
        profile_updates["english_proficiency"] = val

    technical_skills = _split_skills(sd.get("technical_skills") or sd.get("skills"))
    soft_skills = _split_skills(sd.get("soft_skills"))
    if technical_skills:
        profile_updates["technical_skill_count"] = min(len(technical_skills), 12)
    if soft_skills:
        profile_updates["soft_skill_count"] = min(len(soft_skills), 10)

    if profile_updates:
        AlumniProfile.objects.update_or_create(
            alumni=alumni_account, defaults=profile_updates,
        )
        touched["alumni_profile"] = True

    # ─── EmploymentProfile ──────────────────────────────────────────────────
    employment_updates: dict[str, Any] = {}

    if (val := _map(_EMPLOYMENT_STATUS, sd.get("employment_status"))) is not None:
        employment_updates["employment_status"] = val
    elif sd.get("employment_status") in (None, ""):
        pass  # leave alone
    else:
        # respect raw value if it already matches a choice
        raw = _norm(sd.get("employment_status"))
        if raw in {c[0] for c in EmploymentProfile.EmploymentStatusChoices.choices}:
            employment_updates["employment_status"] = raw

    if sd.get("timeToHire") not in (None, ""):
        employment_updates["time_to_hire_raw"] = sd["timeToHire"]
        months = _TIME_TO_HIRE_MONTHS.get(_norm(sd["timeToHire"]))
        if months is not None:
            employment_updates["time_to_hire_months"] = months

    if (val := _map(_SECTOR, sd.get("firstJobSector"))) is not None:
        employment_updates["first_job_sector"] = val
    if (val := _map(_JOB_STATUS, sd.get("firstJobStatus"))) is not None:
        employment_updates["first_job_status"] = val
    if sd.get("firstJobTitle"):
        employment_updates["first_job_title"] = str(sd["firstJobTitle"])[:150]

    related = _related_to_bsis(sd.get("firstJobRelated"))
    if related is not None:
        employment_updates["first_job_related_to_bsis"] = related
    if sd.get("firstJobUnrelatedReason"):
        employment_updates["first_job_unrelated_reason"] = str(
            sd["firstJobUnrelatedReason"]
        )[:200]

    duration = _JOB_RETENTION_MONTHS.get(_norm(sd.get("jobRetention")))
    if duration is not None:
        employment_updates["first_job_duration_months"] = duration

    apps = _JOB_APPLICATIONS_BUCKET.get(_norm(sd.get("jobApplications")))
    if apps is not None:
        employment_updates["first_job_applications_count"] = apps

    if (val := _map(_JOB_SOURCE, sd.get("jobSource"))) is not None:
        employment_updates["first_job_source"] = val

    if (val := _map(_SECTOR, sd.get("currentJobSector"))) is not None:
        employment_updates["current_job_sector"] = val
    if sd.get("currentJobPosition"):
        employment_updates["current_job_title"] = str(sd["currentJobPosition"])[:150]
    if sd.get("currentJobCompany"):
        employment_updates["current_job_company"] = str(sd["currentJobCompany"])[:200]

    related_current = _related_to_bsis(sd.get("currentJobRelated"))
    if related_current is not None:
        employment_updates["current_job_related_to_bsis"] = related_current

    location_local = _is_local(sd.get("currentJobLocation"))
    if location_local is not None:
        employment_updates["location_type"] = location_local

    employment_profile = None
    if employment_updates:
        employment_updates["survey_completion_status"] = "completed"
        employment_profile, _ = EmploymentProfile.objects.update_or_create(
            alumni=alumni_account, defaults=employment_updates,
        )
        touched["employment_profile"] = True

    # ─── WorkAddress (only when city + region present) ──────────────────────
    city = (sd.get("city_municipality") or "").strip()
    if city:
        region_choice = _resolve_region_choice(sd)
        if region_choice:
            province = (sd.get("province_address") or sd.get("province") or "").strip()
            if not province:
                province = "—"
            country = (sd.get("country_address") or "Philippines").strip() or "Philippines"
            WorkAddress.objects.update_or_create(
                alumni=alumni_account,
                is_current=True,
                defaults=dict(
                    employment_profile=employment_profile,
                    street_address=(sd.get("street_address") or "")[:200],
                    barangay=(sd.get("barangay") or "")[:100],
                    city_municipality=city[:100],
                    province=province[:100],
                    region=region_choice,
                    zip_code=(sd.get("zip_code") or "")[:20],
                    country=country[:100],
                ),
            )
            touched["work_address"] = True

    # ─── CompetencyProfile ──────────────────────────────────────────────────
    if technical_skills or soft_skills:
        CompetencyProfile.objects.update_or_create(
            alumni=alumni_account,
            defaults=dict(
                technical_skills=[
                    {"name": s, "selected": True} for s in technical_skills[:12]
                ],
                soft_skills=[
                    {"name": s, "selected": True} for s in soft_skills[:10]
                ],
                technical_skill_count=min(len(technical_skills), 12),
                soft_skill_count=min(len(soft_skills), 10),
                professional_certifications=str(
                    sd.get("professional_certifications") or ""
                )[:500],
            ),
        )
        touched["competency_profile"] = True

    # ─── EmploymentRecord (employer linkage) ────────────────────────────────
    company_name = (sd.get("currentJobCompany") or "").strip()
    job_title = (sd.get("currentJobPosition") or sd.get("firstJobTitle") or "").strip()
    if company_name and job_title:
        employer_account = (
            EmployerAccount.objects.filter(company_name__iexact=company_name).first()
        )
        if location_local is True:
            work_loc = city or "Philippines"
        elif location_local is False:
            work_loc = "Abroad / Remote"
        else:
            work_loc = city
        es_choice = _norm(sd.get("employment_status"))
        if "self" in es_choice:
            er_status = EmploymentRecord.EmploymentStatus.SELF_EMPLOYED
        elif "employed" in es_choice or es_choice in {
            "yes, full-time",
            "yes, part-time",
            "employed_full_time",
            "employed_part_time",
        }:
            er_status = EmploymentRecord.EmploymentStatus.EMPLOYED
        else:
            er_status = EmploymentRecord.EmploymentStatus.UNEMPLOYED

        EmploymentRecord.objects.update_or_create(
            alumni=alumni_account,
            is_current=True,
            defaults=dict(
                employer_account=employer_account,
                employer_name_input=company_name[:255],
                job_title_input=job_title[:255],
                employment_status=er_status,
                work_location=(work_loc or "")[:255],
            ),
        )
        touched["employment_record"] = True

    return {"applied": True, "touched": touched}
