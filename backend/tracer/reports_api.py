"""Report-data endpoints powering the admin Reports tab.

Each endpoint returns a JSON document of the form:

    {
        "title":       "<report title>",
        "generated_at": "<iso timestamp>",
        "filters":     {... echo of batch_start / batch_end / include_unverified},
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
import re
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

from .models import VerificationDecision

logger = logging.getLogger(__name__)


# Numeric scoring for rating choices (excellent → 5, unsatisfactory → 1).
_RATING_TO_SCORE: dict[str, int] = {
    "excellent": 5,
    "very_good": 4,
    "good": 3,
    "fair": 2,
    "unsatisfactory": 1,
}

_RATING_FIELDS_LABELS: list[tuple[str, str]] = [
    ("rating_quality_of_work", "Quality"),
    ("rating_work_habits", "Habits"),
    ("rating_relationship_with_people", "Relationships"),
    ("rating_dependability", "Dependability"),
    ("rating_quantity_of_work", "Quantity"),
    ("rating_initiative", "Initiative"),
    ("rating_analytical_ability", "Analytical"),
    ("rating_ability_as_supervisor", "Supervisor"),
    ("rating_administrative_ability", "Admin"),
    ("rating_safety", "Safety"),
    ("rating_commitment_to_social_equity", "Social Equity"),
]

# Stop-word filter for the Common Themes section. Keeps tokenization-cheap
# without bringing in nltk or similar.
_THEMES_STOP_WORDS: set[str] = {
    "philippines", "corp", "corporation", "inc", "ltd", "company", "the", "and",
    "with", "that", "they", "their", "from", "this", "have", "also", "would",
    "should", "very", "much", "more", "most", "such", "into", "when", "what",
    "which", "where", "while", "than", "then", "there", "these", "those",
    "been", "being", "your", "ours", "them", "some", "other", "could",
    "good", "well", "make", "made", "does", "doing",
}


def _avg_2dp(values: list[float]) -> float | None:
    if not values:
        return None
    return round(sum(values) / len(values), 2)


def _top_words(texts: list[str], k: int = 5) -> list[tuple[str, int]]:
    counter: Counter[str] = Counter()
    for raw in texts:
        if not raw:
            continue
        for token in re.findall(r"[a-z]+", raw.lower()):
            if len(token) >= 4 and token not in _THEMES_STOP_WORDS:
                counter[token] += 1
    return counter.most_common(k)


DEFAULT_START = 2018
DEFAULT_END = 2030


# ── shared helpers ─────────────────────────────────────────────────────────


def _parse_filters(request) -> dict[str, Any]:
    qp = request.query_params
    try:
        start = int(qp.get("batch_start", DEFAULT_START))
    except (TypeError, ValueError):
        start = DEFAULT_START
    try:
        end = int(qp.get("batch_end", DEFAULT_END))
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
        "batch_start": start,
        "batch_end": end,
        "include_unverified": include_unverified,
    }


def _alumni_qs(filters: dict[str, Any]):
    """Build the prefetched AlumniAccount queryset filtered by the report filters."""
    qs = AlumniAccount.objects.all()
    if not filters["include_unverified"]:
        qs = qs.filter(account_status=AccountStatus.ACTIVE)
    qs = qs.filter(
        profile__graduation_year__gte=filters["batch_start"],
        profile__graduation_year__lte=filters["batch_end"],
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


# ── 1. Batch Summary ──────────────────────────────────────────────────────


class BatchSummaryReportView(APIView):
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

        section_a = {
            "title": "Per-Batch Outcomes",
            "columns": [
                "Batch",
                "Alumni (N)",
                "Employment Rate",
                "Avg Time-to-Hire (mo)",
                "BSIS-Aligned (First)",
                "BSIS-Aligned (Current)",
            ],
            "rows": rows,
        }

        # ── Section B: Employer Feedback Aggregates per Batch ───────────────────
        eval_qs = (
            VerificationDecision.objects.filter(
                evaluation_submitted=True,
                token__alumni__profile__graduation_year__gte=filters["batch_start"],
                token__alumni__profile__graduation_year__lte=filters["batch_end"],
            )
            .values_list(
                "token__alumni__profile__graduation_year",
                *[f for f, _ in _RATING_FIELDS_LABELS],
                "assessment_strengths",
                "assessment_improvements",
            )
        )

        eval_buckets: dict[int, dict[str, Any]] = defaultdict(
            lambda: {
                "n": 0,
                "ratings": defaultdict(list),
                "strengths_texts": [],
                "improvements_texts": [],
            }
        )
        for row in eval_qs:
            year_value = row[0]
            if year_value is None:
                continue
            year = int(year_value)
            bucket = eval_buckets[year]
            bucket["n"] += 1
            for idx, (field_name, _label) in enumerate(_RATING_FIELDS_LABELS, start=1):
                score = _RATING_TO_SCORE.get(row[idx])
                if score is not None:
                    bucket["ratings"][field_name].append(score)
            strengths_text = row[1 + len(_RATING_FIELDS_LABELS)]
            improvements_text = row[2 + len(_RATING_FIELDS_LABELS)]
            if strengths_text:
                bucket["strengths_texts"].append(strengths_text)
            if improvements_text:
                bucket["improvements_texts"].append(improvements_text)

        feedback_rows: list[list[Any]] = []
        composites_by_year: dict[int, float | None] = {}
        for year in sorted(eval_buckets):
            bucket = eval_buckets[year]
            field_means: list[float] = []
            row_cells: list[Any] = [year, bucket["n"]]
            for field_name, _label in _RATING_FIELDS_LABELS:
                mean = _avg_2dp(bucket["ratings"][field_name])
                row_cells.append(f"{mean:.2f}" if mean is not None else "—")
                if mean is not None:
                    field_means.append(mean)
            composite = _avg_2dp(field_means) if field_means else None
            composites_by_year[year] = composite
            row_cells.append(f"{composite:.2f}" if composite is not None else "—")
            feedback_rows.append(row_cells)

        section_b = {
            "title": "Employer Feedback Aggregates",
            "columns": [
                "Batch",
                "Evaluations",
                *[label for _f, label in _RATING_FIELDS_LABELS],
                "Composite",
            ],
            "rows": feedback_rows,
        }

        # ── Section C: Cross-Batch Timeline (one row per metric, columns = batches) ───
        timeline_years = sorted(set(buckets) | set(eval_buckets))
        timeline_rows: list[list[Any]] = []
        if timeline_years:
            employment_row: list[Any] = ["Employment Rate %"]
            tth_row: list[Any] = ["Avg Time-to-Hire (mo)"]
            composite_row: list[Any] = ["Avg Composite Rating"]
            for year in timeline_years:
                outcome = buckets.get(year)
                if outcome and outcome["n"]:
                    employment_row.append(_pct(outcome["employed"], outcome["n"]))
                    tth_row.append(_avg(outcome["tth"]))
                else:
                    employment_row.append("—")
                    tth_row.append("—")
                composite = composites_by_year.get(year)
                composite_row.append(f"{composite:.2f}" if composite is not None else "—")
            timeline_rows = [employment_row, tth_row, composite_row]

        section_c = {
            "title": "Cross-Batch Timeline",
            "columns": ["Metric", *[str(y) for y in timeline_years]],
            "rows": timeline_rows,
        }

        # ── Section D: Common Themes (two tables, top 5 words per batch) ──────
        themes_columns = ["Batch", "#1", "#2", "#3", "#4", "#5"]
        strengths_rows: list[list[Any]] = []
        improvements_rows: list[list[Any]] = []
        for year in sorted(eval_buckets):
            bucket = eval_buckets[year]
            top_strengths = _top_words(bucket["strengths_texts"], k=5)
            top_improvements = _top_words(bucket["improvements_texts"], k=5)

            def _format(words: list[tuple[str, int]]) -> list[str]:
                return [f"{w} ({c})" for w, c in words] + [""] * (5 - len(words))

            strengths_rows.append([year, *_format(top_strengths)])
            improvements_rows.append([year, *_format(top_improvements)])

        section_d_strengths = {
            "title": "Common Themes — Strengths",
            "columns": themes_columns,
            "rows": strengths_rows,
        }
        section_d_improvements = {
            "title": "Common Themes — Areas to Improve",
            "columns": themes_columns,
            "rows": improvements_rows,
        }

        return _ok(
            "Batch Summary",
            [section_a, section_b, section_c, section_d_strengths, section_d_improvements],
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
                        "Batch",
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
        per_batch_tech: dict[int, Counter] = defaultdict(Counter)
        per_batch_soft: dict[int, Counter] = defaultdict(Counter)
        n_overall = 0
        n_per_batch: dict[int, int] = defaultdict(int)

        for acc in qs:
            comp = _first_prefetched(acc, "_prefetched_comp")
            year = _grad_year(acc)
            n_overall += 1
            if year is not None:
                n_per_batch[year] += 1
            if comp is None:
                continue
            for name in _selected_names(comp.technical_skills):
                tech_overall[name] += 1
                if year is not None:
                    per_batch_tech[year][name] += 1
            for name in _selected_names(comp.soft_skills):
                soft_overall[name] += 1
                if year is not None:
                    per_batch_soft[year][name] += 1

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

        for year in sorted(per_batch_tech):
            sections.append(
                {
                    "title": f"Top Technical Skills — Batch {year} (N = {n_per_batch[year]})",
                    "columns": ["Skill", "Frequency", "% of Alumni"],
                    "rows": _top_rows(per_batch_tech[year], n_per_batch[year], top_n=8),
                }
            )

        return _ok("Skills Inventory", sections, filters)


# ── 4. Further Studies (post-baccalaureate) ────────────────────────────────


class FurtherStudiesReportView(APIView):
    """Distribution of post-baccalaureate study status across the filtered batches.

    Captures three populations adviser asked for:
      - Graduates who went straight to work (status = "none" or blank).
      - Graduates currently enrolled in further studies.
      - Graduates who already completed further studies.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        filters = _parse_filters(request)
        qs = _alumni_qs(filters)

        status_counts: dict[str, int] = {"none": 0, "enrolled": 0, "completed": 0}
        program_counter: Counter = Counter()
        school_counter: Counter = Counter()
        per_batch: dict[int, dict[str, int]] = defaultdict(
            lambda: {"n": 0, "none": 0, "enrolled": 0, "completed": 0}
        )

        completed_durations: list[int] = []  # years started → completed
        n_total = 0

        for acc in qs:
            prof = getattr(acc, "profile", None)
            if not prof:
                continue
            n_total += 1
            raw = (getattr(prof, "further_studies_status", None) or "none").strip().lower()
            if raw not in status_counts:
                raw = "none"
            status_counts[raw] += 1

            year = _grad_year(acc)
            if year is not None:
                bucket = per_batch[year]
                bucket["n"] += 1
                bucket[raw] += 1

            if raw in {"enrolled", "completed"}:
                program = (getattr(prof, "postgrad_program", "") or "").strip()
                school = (getattr(prof, "postgrad_school", "") or getattr(prof, "graduate_school", "") or "").strip()
                if program:
                    program_counter[program] += 1
                if school:
                    school_counter[school] += 1

            if raw == "completed":
                ystart = getattr(prof, "postgrad_year_started", None)
                yend = getattr(prof, "postgrad_year_completed", None)
                if ystart and yend and yend >= ystart:
                    completed_durations.append(int(yend) - int(ystart))

        overview_rows = [
            ["Bachelor's only (no further studies)", status_counts["none"], _pct(status_counts["none"], n_total)],
            ["Currently enrolled in further studies", status_counts["enrolled"], _pct(status_counts["enrolled"], n_total)],
            ["Completed further studies", status_counts["completed"], _pct(status_counts["completed"], n_total)],
            ["Total alumni", n_total, "100%" if n_total else "—"],
        ]

        per_batch_rows = []
        for year in sorted(per_batch):
            b = per_batch[year]
            per_batch_rows.append(
                [
                    year,
                    b["n"],
                    b["none"],
                    b["enrolled"],
                    b["completed"],
                    _pct(b["enrolled"] + b["completed"], b["n"]),
                ]
            )

        program_rows = [[name, count] for name, count in program_counter.most_common(20)]
        school_rows = [[name, count] for name, count in school_counter.most_common(20)]

        avg_duration = (
            f"{sum(completed_durations) / len(completed_durations):.1f}"
            if completed_durations else "—"
        )
        duration_rows = [
            ["Completed graduates with start/end dates", len(completed_durations)],
            ["Average years to complete further studies", avg_duration],
        ]

        sections = [
            {
                "title": f"Further-Studies Status (N = {n_total})",
                "columns": ["Status", "Alumni", "% Share"],
                "rows": overview_rows,
            },
            {
                "title": "Per-Batch Breakdown",
                "columns": ["Batch", "Alumni (N)", "Bachelor's only", "Enrolled", "Completed", "% Pursuing/Completed"],
                "rows": per_batch_rows,
            },
            {
                "title": "Top Programs (Top 20)",
                "columns": ["Program / Degree", "Alumni"],
                "rows": program_rows or [["No further-studies records yet", 0]],
            },
            {
                "title": "Top Schools / Universities (Top 20)",
                "columns": ["School / University", "Alumni"],
                "rows": school_rows or [["No further-studies records yet", 0]],
            },
            {
                "title": "Completion Duration",
                "columns": ["Metric", "Value"],
                "rows": duration_rows,
            },
        ]

        return _ok("Further Studies", sections, filters)


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
        per_batch_total: dict[int, int] = defaultdict(int)
        per_batch_completed: dict[int, int] = defaultdict(int)

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
                per_batch_total[year] += 1

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
                    per_batch_completed[year] += 1

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

        batch_rows = []
        for year in sorted(per_batch_total):
            batch_rows.append(
                [
                    year,
                    per_batch_total[year],
                    per_batch_completed[year],
                    _pct(per_batch_completed[year], per_batch_total[year]),
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
                    "title": "Completion Rate by Batch",
                    "columns": ["Batch", "Total", "Completed", "Completion Rate"],
                    "rows": batch_rows,
                },
            ],
            filters,
        )


# ── 7. Predictive Employability Trend ──────────────────────────────────────


def _linear_forecast(years: list[int], values: list[float], horizon: int) -> list[tuple[int, float]]:
    """Least-squares linear projection of `values` indexed by `years`.

    Returns up to `horizon` (year, projected_value) tuples for the years
    immediately following max(years). Returns an empty list when the input
    has fewer than two distinct points (a slope can't be defined).
    """
    if horizon <= 0 or len(years) < 2 or len(years) != len(values):
        return []
    n = len(years)
    mean_x = sum(years) / n
    mean_y = sum(values) / n
    num = sum((years[i] - mean_x) * (values[i] - mean_y) for i in range(n))
    den = sum((years[i] - mean_x) ** 2 for i in range(n))
    if den == 0:
        return []
    slope = num / den
    intercept = mean_y - slope * mean_x
    last_year = max(years)
    return [(last_year + i, slope * (last_year + i) + intercept) for i in range(1, horizon + 1)]


def _summarize_trend(
    employment_history: list[tuple[int, float]],
    employment_forecast: list[tuple[int, float]],
    tth_history: list[tuple[int, float]],
    tth_forecast: list[tuple[int, float]],
) -> str:
    """Build a 1–2 sentence narrative describing the trend direction."""
    parts: list[str] = []

    if employment_history and employment_forecast:
        first_rate = employment_history[0][1]
        last_rate = employment_history[-1][1]
        forecast_rate = employment_forecast[-1][1]
        delta_obs = (last_rate - first_rate) * 100
        delta_fwd = (forecast_rate - last_rate) * 100
        direction_obs = "rose" if delta_obs > 1 else "fell" if delta_obs < -1 else "held steady"
        direction_fwd = "continue rising" if delta_fwd > 1 else "decline" if delta_fwd < -1 else "stay flat"
        parts.append(
            f"Employment rate {direction_obs} by {abs(delta_obs):.1f} pts across observed batches "
            f"({employment_history[0][0]}–{employment_history[-1][0]}) and is projected to {direction_fwd} "
            f"to {forecast_rate * 100:.1f}% by {employment_forecast[-1][0]}."
        )

    if tth_history and tth_forecast:
        first_tth = tth_history[0][1]
        last_tth = tth_history[-1][1]
        forecast_tth = tth_forecast[-1][1]
        delta_obs = last_tth - first_tth
        direction_obs = "shortened" if delta_obs < -0.2 else "lengthened" if delta_obs > 0.2 else "remained stable"
        parts.append(
            f"Time-to-hire {direction_obs} from {first_tth:.1f} to {last_tth:.1f} months over the same "
            f"window and is projected at {forecast_tth:.1f} months by {tth_forecast[-1][0]}."
        )

    if not parts:
        return "Not enough historical batches in the selected range to project a trend — broaden the year filter to include more graduating batches."
    return " ".join(parts)


class PredictiveTrendReportView(APIView):
    """Predictive Employability Trend — historical actual vs predicted plus a
    forward forecast for the next several years."""

    permission_classes = [AllowAny]

    def get(self, request):
        # Reuse the same model-loading helpers used by the Analytics tab so
        # the chart UI and this report can never disagree.
        from .api import _aggregate_for_batch, _load_ml_artifacts

        filters = _parse_filters(request)
        try:
            forecast_years = int(request.query_params.get("forecast_years", 3))
        except (TypeError, ValueError):
            forecast_years = 3
        forecast_years = max(1, min(forecast_years, 10))

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

        overall = _aggregate_for_batch(artifacts, None)
        batches = sorted(int(c) for c in artifacts["df"]["batch"].unique().tolist())
        batches = [
            c
            for c in batches
            if filters["batch_start"] <= c <= filters["batch_end"]
        ]

        per_batch_rows = []
        employment_history: list[tuple[int, float]] = []
        tth_history: list[tuple[int, float]] = []
        for c in batches:
            agg = _aggregate_for_batch(artifacts, c)
            predicted_emp = float(agg.get("predicted_employment_rate", 0))
            predicted_tth = float(agg.get("predicted_mean_time_to_hire_months", 0))
            employment_history.append((c, predicted_emp))
            tth_history.append((c, predicted_tth))
            per_batch_rows.append(
                [
                    c,
                    agg.get("n_alumni", 0),
                    f"{agg.get('actual_employment_rate', 0) * 100:.1f}%",
                    f"{predicted_emp * 100:.1f}%",
                    f"{agg.get('actual_mean_time_to_hire_months', 0):.1f}",
                    f"{predicted_tth:.1f}",
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

        # Forward forecast — linear-trend projection on top of the per-batch
        # model predictions. Clamps employment rate to [0, 1] and TTH to >= 0.
        emp_years = [y for y, _ in employment_history]
        emp_values = [v for _, v in employment_history]
        tth_years = [y for y, _ in tth_history]
        tth_values = [v for _, v in tth_history]

        emp_forecast_raw = _linear_forecast(emp_years, emp_values, forecast_years)
        tth_forecast_raw = _linear_forecast(tth_years, tth_values, forecast_years)

        emp_forecast = [(y, max(0.0, min(1.0, v))) for y, v in emp_forecast_raw]
        tth_forecast = [(y, max(0.0, v)) for y, v in tth_forecast_raw]

        if emp_forecast or tth_forecast:
            forecast_year_set = sorted({y for y, _ in emp_forecast} | {y for y, _ in tth_forecast})
            emp_map = dict(emp_forecast)
            tth_map = dict(tth_forecast)
            forecast_rows = [
                [
                    y,
                    f"{emp_map[y] * 100:.1f}%" if y in emp_map else "—",
                    f"{tth_map[y]:.1f}" if y in tth_map else "—",
                ]
                for y in forecast_year_set
            ]
        else:
            forecast_rows = []

        narrative = _summarize_trend(
            employment_history, emp_forecast, tth_history, tth_forecast,
        )

        distribution_rows = [
            [bucket, count]
            for bucket, count in (overall.get("time_to_hire_distribution") or {}).items()
        ]

        sections: list[dict[str, Any]] = [
            {
                "title": "Narrative Summary",
                "columns": ["Insight"],
                "rows": [[narrative]],
            },
            {
                "title": "Overall — Actual vs Predicted",
                "columns": ["Metric", "Actual", "Predicted"],
                "rows": overall_rows,
            },
            {
                "title": "Per-Batch Predictions",
                "columns": [
                    "Batch",
                    "N",
                    "Employment (Actual)",
                    "Employment (Predicted)",
                    "TTH Actual (mo)",
                    "TTH Predicted (mo)",
                    "BSIS-Aligned First (Obs)",
                    "BSIS-Aligned Current (Obs)",
                ],
                "rows": per_batch_rows,
            },
            {
                "title": f"Forecast — Next {forecast_years} Year(s)",
                "columns": ["Year (forecast)", "Employment Rate", "Time-to-Hire (mo)"],
                "rows": forecast_rows or [["—", "Insufficient data to forecast", ""]],
            },
            {
                "title": "Predicted Time-to-Hire Distribution",
                "columns": ["Bucket", "Count"],
                "rows": distribution_rows,
            },
        ]

        return _ok("Predictive Employability Trend", sections, filters)
