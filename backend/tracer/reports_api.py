"""Report-data endpoints powering the admin Reports tab.

Each endpoint returns a JSON document of the form:

    {
        "title":       "<report title>",
        "generated_at": "<iso timestamp>",
        "filters":     {... echo of cohort_start / cohort_end / include_unverified},
        "sections":    [
            {"title": "...", "columns": [...], "rows": [[...], ...]},
            ...
        ],
    }

The frontend renders that payload to PDF / XLSX / CSV via
``frontend/src/lib/report-export.ts``. Producing structured JSON (rather than
the binary artifact directly) keeps the backend dependency-free and lets the
UI preview the table before the user exports it.
"""

from __future__ import annotations

import logging
from collections import Counter, defaultdict
from typing import Any

from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from users.api import (
    _SECTOR_LABELS,
    _alumni_dashboard_queryset,
    _first_prefetched,
)
from users.models import AccountStatus, AlumniAccount

logger = logging.getLogger(__name__)


DEFAULT_START = 2018
DEFAULT_END = 2030


# ── shared helpers ─────────────────────────────────────────────────────────


def _parse_filters(request) -> dict[str, Any]:
    qp = request.query_params
    try:
        start = int(qp.get("cohort_start", DEFAULT_START))
    except (TypeError, ValueError):
        start = DEFAULT_START
    try:
        end = int(qp.get("cohort_end", DEFAULT_END))
    except (TypeError, ValueError):
        end = DEFAULT_END
    if end < start:
        start, end = end, start
    include_unverified = str(qp.get("include_unverified", "false")).lower() in {
        "1",
        "true",
        "yes",
    }
    return {
        "cohort_start": start,
        "cohort_end": end,
        "include_unverified": include_unverified,
    }


def _alumni_qs(filters: dict[str, Any]):
    """Build the prefetched AlumniAccount queryset filtered by the report filters."""
    qs = AlumniAccount.objects.all()
    if not filters["include_unverified"]:
        qs = qs.filter(account_status=AccountStatus.ACTIVE)
    qs = qs.filter(
        profile__graduation_year__gte=filters["cohort_start"],
        profile__graduation_year__lte=filters["cohort_end"],
    )
    return _alumni_dashboard_queryset(qs)


def _ok(title: str, sections: list[dict], filters: dict) -> Response:
    return Response(
        {
            "title": title,
            "generated_at": timezone.now().isoformat(),
            "filters": filters,
            "sections": sections,
        },
        status=status.HTTP_200_OK,
    )


def _full_name(account: AlumniAccount) -> str:
    try:
        prof = getattr(account, "profile", None)
        if prof:
            parts = [prof.first_name, prof.middle_name, prof.last_name]
            name = " ".join(p.strip() for p in parts if p and p.strip())
            if name:
                return name
    except Exception:  # pragma: no cover
        pass
    if account.master_record and account.master_record.full_name:
        return account.master_record.full_name
    if account.user and account.user.email:
        return account.user.email.split("@")[0]
    return "—"


def _grad_year(account: AlumniAccount) -> int | None:
    try:
        prof = getattr(account, "profile", None)
        if prof and prof.graduation_year:
            return int(prof.graduation_year)
    except Exception:  # pragma: no cover
        pass
    if account.master_record and account.master_record.batch_year:
        return int(account.master_record.batch_year)
    return None


def _is_employed(emp) -> bool:
    if not emp or not emp.employment_status:
        return False
    return emp.employment_status in {
        "employed_full_time",
        "employed_part_time",
        "self_employed",
    }


def _bool_label(v) -> str:
    if v is True:
        return "Yes"
    if v is False:
        return "No"
    return "—"


def _pct(num: float, denom: float) -> str:
    if not denom:
        return "—"
    return f"{(num / denom * 100):.1f}%"


def _avg(values: list[float]) -> str:
    if not values:
        return "—"
    return f"{(sum(values) / len(values)):.1f}"


# ── 1. Cohort Summary ──────────────────────────────────────────────────────


class CohortSummaryReportView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        filters = _parse_filters(request)
        qs = _alumni_qs(filters)

        buckets: dict[int, dict[str, Any]] = defaultdict(
            lambda: {
                "n": 0,
                "employed": 0,
                "tth": [],
                "bsis_first": [],
                "bsis_current": [],
            }
        )

        for acc in qs:
            year = _grad_year(acc)
            if year is None:
                continue
            emp = _first_prefetched(acc, "_prefetched_emp")
            b = buckets[year]
            b["n"] += 1
            if _is_employed(emp):
                b["employed"] += 1
            if emp is not None:
                if emp.time_to_hire_months is not None:
                    b["tth"].append(float(emp.time_to_hire_months))
                if emp.first_job_related_to_bsis is True:
                    b["bsis_first"].append(1)
                elif emp.first_job_related_to_bsis is False:
                    b["bsis_first"].append(0)
                if emp.current_job_related_to_bsis is True:
                    b["bsis_current"].append(1)
                elif emp.current_job_related_to_bsis is False:
                    b["bsis_current"].append(0)

        rows = []
        totals = {"n": 0, "employed": 0, "tth": [], "bsis_first": [], "bsis_current": []}
        for year in sorted(buckets):
            b = buckets[year]
            rows.append(
                [
                    year,
                    b["n"],
                    _pct(b["employed"], b["n"]),
                    _avg(b["tth"]),
                    _pct(sum(b["bsis_first"]), len(b["bsis_first"])),
                    _pct(sum(b["bsis_current"]), len(b["bsis_current"])),
                ]
            )
            totals["n"] += b["n"]
            totals["employed"] += b["employed"]
            totals["tth"].extend(b["tth"])
            totals["bsis_first"].extend(b["bsis_first"])
            totals["bsis_current"].extend(b["bsis_current"])

        if rows:
            rows.append(
                [
                    "Total",
                    totals["n"],
                    _pct(totals["employed"], totals["n"]),
                    _avg(totals["tth"]),
                    _pct(sum(totals["bsis_first"]), len(totals["bsis_first"])),
                    _pct(sum(totals["bsis_current"]), len(totals["bsis_current"])),
                ]
            )

        return _ok(
            "Cohort Summary",
            [
                {
                    "title": "Per-Cohort Outcomes",
                    "columns": [
                        "Cohort",
                        "Alumni (N)",
                        "Employment Rate",
                        "Avg Time-to-Hire (mo)",
                        "BSIS-Aligned (First)",
                        "BSIS-Aligned (Current)",
                    ],
                    "rows": rows,
                }
            ],
            filters,
        )


# ── 2. Employment Outcomes Roster ──────────────────────────────────────────


class EmploymentOutcomesReportView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        filters = _parse_filters(request)
        qs = _alumni_qs(filters)

        rows = []
        for acc in qs:
            emp = _first_prefetched(acc, "_prefetched_emp")
            addr = _first_prefetched(acc, "_prefetched_addr")
            year = _grad_year(acc)

            sector = ""
            if emp and emp.current_job_sector:
                sector = _SECTOR_LABELS.get(
                    emp.current_job_sector, emp.current_job_sector
                )

            location = ""
            if addr is not None:
                bits = [addr.city_municipality, addr.country]
                location = ", ".join(b for b in bits if b)
            elif emp and emp.location_type is not None:
                location = "Local (PH)" if emp.location_type else "Abroad / Remote"

            rows.append(
                [
                    _full_name(acc),
                    year if year else "—",
                    (emp.current_job_company if emp and emp.current_job_company else "—"),
                    (emp.current_job_title if emp and emp.current_job_title else "—"),
                    sector or "—",
                    (
                        f"{emp.time_to_hire_months:.1f}"
                        if emp and emp.time_to_hire_months is not None
                        else "—"
                    ),
                    location or "—",
                    _bool_label(
                        emp.current_job_related_to_bsis if emp is not None else None
                    ),
                ]
            )

        rows.sort(key=lambda r: (str(r[1]), str(r[0]).lower()))

        return _ok(
            "Employment Outcomes Roster",
            [
                {
                    "title": "Alumni Employment Records",
                    "columns": [
                        "Name",
                        "Cohort",
                        "Employer",
                        "Position",
                        "Sector",
                        "Time-to-Hire (mo)",
                        "Location",
                        "BSIS-Aligned",
                    ],
                    "rows": rows,
                }
            ],
            filters,
        )


# ── 3. Skills Inventory ────────────────────────────────────────────────────


def _selected_names(items) -> list[str]:
    if not isinstance(items, list):
        return []
    return [
        str(s.get("name")).strip()
        for s in items
        if isinstance(s, dict) and s.get("selected") and s.get("name")
    ]


class SkillsInventoryReportView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        filters = _parse_filters(request)
        qs = _alumni_qs(filters)

        tech_overall: Counter = Counter()
        soft_overall: Counter = Counter()
        per_cohort_tech: dict[int, Counter] = defaultdict(Counter)
        per_cohort_soft: dict[int, Counter] = defaultdict(Counter)
        n_overall = 0
        n_per_cohort: dict[int, int] = defaultdict(int)

        for acc in qs:
            comp = _first_prefetched(acc, "_prefetched_comp")
            year = _grad_year(acc)
            n_overall += 1
            if year is not None:
                n_per_cohort[year] += 1
            if comp is None:
                continue
            for name in _selected_names(comp.technical_skills):
                tech_overall[name] += 1
                if year is not None:
                    per_cohort_tech[year][name] += 1
            for name in _selected_names(comp.soft_skills):
                soft_overall[name] += 1
                if year is not None:
                    per_cohort_soft[year][name] += 1

        def _top_rows(counter: Counter, total: int, top_n: int = 12):
            out = []
            for name, freq in counter.most_common(top_n):
                out.append([name, freq, _pct(freq, total)])
            return out

        sections = [
            {
                "title": f"Top Technical Skills (Overall, N = {n_overall})",
                "columns": ["Skill", "Frequency", "% of Alumni"],
                "rows": _top_rows(tech_overall, n_overall),
            },
            {
                "title": f"Top Soft Skills (Overall, N = {n_overall})",
                "columns": ["Skill", "Frequency", "% of Alumni"],
                "rows": _top_rows(soft_overall, n_overall),
            },
        ]

        for year in sorted(per_cohort_tech):
            sections.append(
                {
                    "title": f"Top Technical Skills — Cohort {year} (N = {n_per_cohort[year]})",
                    "columns": ["Skill", "Frequency", "% of Alumni"],
                    "rows": _top_rows(per_cohort_tech[year], n_per_cohort[year], top_n=8),
                }
            )

        return _ok("Skills Inventory", sections, filters)


# ── 4. Geographic Distribution ─────────────────────────────────────────────


class GeographicDistributionReportView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        filters = _parse_filters(request)
        qs = _alumni_qs(filters)

        by_region: Counter = Counter()
        by_country: Counter = Counter()
        by_city: Counter = Counter()
        n_with_addr = 0

        for acc in qs:
            addr = _first_prefetched(acc, "_prefetched_addr")
            if addr is None:
                continue
            n_with_addr += 1
            if addr.region:
                by_region[addr.region] += 1
            if addr.country:
                by_country[addr.country] += 1
            if addr.city_municipality:
                by_city[addr.city_municipality] += 1

        def _rows(counter: Counter, top_n: int | None = None):
            items = counter.most_common(top_n) if top_n else counter.most_common()
            return [[name, freq, _pct(freq, n_with_addr)] for name, freq in items]

        sections = [
            {
                "title": f"By Region (N = {n_with_addr} with work address)",
                "columns": ["Region", "Alumni", "% Share"],
                "rows": _rows(by_region),
            },
            {
                "title": "By Country",
                "columns": ["Country", "Alumni", "% Share"],
                "rows": _rows(by_country),
            },
            {
                "title": "Top 20 Cities / Municipalities",
                "columns": ["City / Municipality", "Alumni", "% Share"],
                "rows": _rows(by_city, top_n=20),
            },
        ]

        return _ok("Geographic Distribution", sections, filters)


# ── 5. Academic-Employment Correlation ─────────────────────────────────────


_GPA_LABELS = {
    0: "Below 75",
    1: "75-79",
    2: "80-84",
    3: "85-89",
    4: "90-94",
    5: "95-100",
}
_HONORS_LABELS = {
    1: "None",
    2: "Cum Laude",
    3: "Magna Cum Laude",
    4: "Summa Cum Laude",
}


class AcademicEmploymentReportView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        filters = _parse_filters(request)
        qs = _alumni_qs(filters)

        gpa_buckets: dict[Any, dict[str, Any]] = defaultdict(
            lambda: {"n": 0, "employed": 0, "tth": [], "bsis": []}
        )
        honors_buckets: dict[Any, dict[str, Any]] = defaultdict(
            lambda: {"n": 0, "employed": 0, "tth": []}
        )

        for acc in qs:
            prof = getattr(acc, "profile", None)
            emp = _first_prefetched(acc, "_prefetched_emp")

            gpa_key = (
                prof.general_average_range
                if prof and prof.general_average_range is not None
                else None
            )
            honors_key = (
                prof.academic_honors
                if prof and prof.academic_honors is not None
                else None
            )

            for key, bucket in [(gpa_key, gpa_buckets[gpa_key]), (honors_key, honors_buckets[honors_key])]:
                bucket["n"] += 1
                if _is_employed(emp):
                    bucket["employed"] += 1
                if emp and emp.time_to_hire_months is not None:
                    bucket["tth"].append(float(emp.time_to_hire_months))
            if emp is not None and gpa_key is not None:
                if emp.current_job_related_to_bsis is True:
                    gpa_buckets[gpa_key]["bsis"].append(1)
                elif emp.current_job_related_to_bsis is False:
                    gpa_buckets[gpa_key]["bsis"].append(0)

        gpa_rows = []
        for key in sorted(gpa_buckets, key=lambda k: (k is None, k if k is not None else -1)):
            b = gpa_buckets[key]
            label = _GPA_LABELS.get(key, "Not reported") if key is not None else "Not reported"
            gpa_rows.append(
                [
                    label,
                    b["n"],
                    _pct(b["employed"], b["n"]),
                    _avg(b["tth"]),
                    _pct(sum(b["bsis"]), len(b["bsis"])),
                ]
            )

        honors_rows = []
        for key in sorted(honors_buckets, key=lambda k: (k is None, k if k is not None else -1)):
            b = honors_buckets[key]
            label = _HONORS_LABELS.get(key, "Not reported") if key is not None else "Not reported"
            honors_rows.append(
                [
                    label,
                    b["n"],
                    _pct(b["employed"], b["n"]),
                    _avg(b["tth"]),
                ]
            )

        return _ok(
            "Academic-Employment Correlation",
            [
                {
                    "title": "By General Average (GPA Range)",
                    "columns": [
                        "GPA Range",
                        "Alumni (N)",
                        "Employment Rate",
                        "Avg Time-to-Hire (mo)",
                        "BSIS-Aligned (Current)",
                    ],
                    "rows": gpa_rows,
                },
                {
                    "title": "By Academic Honors",
                    "columns": [
                        "Honors",
                        "Alumni (N)",
                        "Employment Rate",
                        "Avg Time-to-Hire (mo)",
                    ],
                    "rows": honors_rows,
                },
            ],
            filters,
        )


# ── 6. Survey Data Quality ─────────────────────────────────────────────────


class DataQualityReportView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        filters = _parse_filters(request)
        qs = _alumni_qs(filters)

        n_total = 0
        n_with_employment = 0
        n_with_address = 0
        n_with_skills = 0
        n_completed = 0

        missing_counters: Counter = Counter()
        per_cohort_total: dict[int, int] = defaultdict(int)
        per_cohort_completed: dict[int, int] = defaultdict(int)

        REQUIRED_FIELDS = [
            ("Employment status", lambda emp, addr, comp: emp and emp.employment_status),
            ("Time-to-hire", lambda emp, addr, comp: emp and emp.time_to_hire_months is not None),
            ("Current job sector", lambda emp, addr, comp: emp and emp.current_job_sector),
            ("Current job title", lambda emp, addr, comp: emp and emp.current_job_title),
            ("Work address", lambda emp, addr, comp: addr is not None),
            ("Technical skills", lambda emp, addr, comp: comp and comp.technical_skill_count > 0),
            ("Soft skills", lambda emp, addr, comp: comp and comp.soft_skill_count > 0),
        ]

        for acc in qs:
            n_total += 1
            year = _grad_year(acc)
            if year is not None:
                per_cohort_total[year] += 1

            emp = _first_prefetched(acc, "_prefetched_emp")
            addr = _first_prefetched(acc, "_prefetched_addr")
            comp = _first_prefetched(acc, "_prefetched_comp")

            if emp:
                n_with_employment += 1
            if addr:
                n_with_address += 1
            if comp and (comp.technical_skill_count or comp.soft_skill_count):
                n_with_skills += 1

            missing_for_this = []
            for label, check in REQUIRED_FIELDS:
                try:
                    ok = bool(check(emp, addr, comp))
                except Exception:
                    ok = False
                if not ok:
                    missing_counters[label] += 1
                    missing_for_this.append(label)

            if not missing_for_this:
                n_completed += 1
                if year is not None:
                    per_cohort_completed[year] += 1

        overall_rows = [
            ["Total alumni in scope", n_total, ""],
            ["With employment record", n_with_employment, _pct(n_with_employment, n_total)],
            ["With work address", n_with_address, _pct(n_with_address, n_total)],
            ["With at least one skill", n_with_skills, _pct(n_with_skills, n_total)],
            ["Fully completed surveys", n_completed, _pct(n_completed, n_total)],
        ]

        missing_rows = [
            [field, count, _pct(count, n_total)]
            for field, count in missing_counters.most_common()
        ]

        cohort_rows = []
        for year in sorted(per_cohort_total):
            cohort_rows.append(
                [
                    year,
                    per_cohort_total[year],
                    per_cohort_completed[year],
                    _pct(per_cohort_completed[year], per_cohort_total[year]),
                ]
            )

        return _ok(
            "Survey Data Quality",
            [
                {
                    "title": "Overall Coverage",
                    "columns": ["Metric", "Count", "% of Total"],
                    "rows": overall_rows,
                },
                {
                    "title": "Missing Field Summary",
                    "columns": ["Field", "Missing", "% of Total"],
                    "rows": missing_rows,
                },
                {
                    "title": "Completion Rate by Cohort",
                    "columns": ["Cohort", "Total", "Completed", "Completion Rate"],
                    "rows": cohort_rows,
                },
            ],
            filters,
        )


# ── 7. Predictive Employability Trend ──────────────────────────────────────


class PredictiveTrendReportView(APIView):
    """Capstone-titled report: bundles the model predictions across the
    four targets into a single document suitable for accreditation."""

    permission_classes = [AllowAny]

    def get(self, request):
        # Reuse the same model-loading helpers used by the Analytics tab so
        # the chart UI and this report can never disagree.
        from .api import _aggregate_for_cohort, _load_ml_artifacts

        filters = _parse_filters(request)
        artifacts = _load_ml_artifacts()
        if "error" in artifacts:
            logger.error("Predictive trend report: artifacts unavailable — %s", artifacts["error"])
            return Response(
                {
                    "error": "Predictive model artifacts unavailable",
                    "detail": artifacts["error"],
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        overall = _aggregate_for_cohort(artifacts, None)
        cohorts = sorted(int(c) for c in artifacts["df"]["cohort"].unique().tolist())
        cohorts = [
            c
            for c in cohorts
            if filters["cohort_start"] <= c <= filters["cohort_end"]
        ]

        per_cohort_rows = []
        for c in cohorts:
            agg = _aggregate_for_cohort(artifacts, c)
            per_cohort_rows.append(
                [
                    c,
                    agg.get("n_alumni", 0),
                    f"{agg.get('actual_employment_rate', 0) * 100:.1f}%",
                    f"{agg.get('predicted_employment_rate', 0) * 100:.1f}%",
                    f"{agg.get('actual_mean_time_to_hire_months', 0):.1f}",
                    f"{agg.get('predicted_mean_time_to_hire_months', 0):.1f}",
                    f"{agg.get('actual_bsis_first_rate', 0) * 100:.1f}%",
                    f"{agg.get('actual_bsis_current_rate', 0) * 100:.1f}%",
                ]
            )

        overall_rows = [
            ["Alumni in trained sample", overall.get("n_alumni", 0), ""],
            [
                "Employment rate",
                f"{overall.get('actual_employment_rate', 0) * 100:.1f}%",
                f"{overall.get('predicted_employment_rate', 0) * 100:.1f}%",
            ],
            [
                "Mean time-to-hire (months)",
                f"{overall.get('actual_mean_time_to_hire_months', 0):.1f}",
                f"{overall.get('predicted_mean_time_to_hire_months', 0):.1f}",
            ],
            [
                "BSIS-aligned first job (observed)",
                f"{overall.get('actual_bsis_first_rate', 0) * 100:.1f}%",
                "—",
            ],
            [
                "BSIS-aligned current job (observed)",
                f"{overall.get('actual_bsis_current_rate', 0) * 100:.1f}%",
                "—",
            ],
        ]

        meta = artifacts["meta"]
        best = meta.get("best_models") or {
            k: v.get("best_model") for k, v in meta.get("targets", {}).items()
        }
        model_rows = [
            ["Employment status", best.get("employment_status", "—")],
            ["Time-to-hire", best.get("time_to_hire", "—")],
        ]

        distribution_rows = [
            [bucket, count]
            for bucket, count in (overall.get("time_to_hire_distribution") or {}).items()
        ]

        return _ok(
            "Predictive Employability Trend",
            [
                {
                    "title": "Overall — Actual vs Predicted",
                    "columns": ["Metric", "Actual", "Predicted"],
                    "rows": overall_rows,
                },
                {
                    "title": "Per-Cohort Predictions",
                    "columns": [
                        "Cohort",
                        "N",
                        "Employment (Actual)",
                        "Employment (Predicted)",
                        "TTH Actual (mo)",
                        "TTH Predicted (mo)",
                        "BSIS-Aligned First (Obs)",
                        "BSIS-Aligned Current (Obs)",
                    ],
                    "rows": per_cohort_rows,
                },
                {
                    "title": "Predicted Time-to-Hire Distribution",
                    "columns": ["Bucket", "Count"],
                    "rows": distribution_rows,
                },
                {
                    "title": "Best Model per Target",
                    "columns": ["Target", "Algorithm"],
                    "rows": model_rows,
                },
            ],
            filters,
        )
