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
from users.auth import require_admin, require_alumni
from users.models import AccountStatus, AlumniAccount

from . import employability
from .alignment import resolve_alignment, summarize, verified_titles_by_alumni
from .models import JobTitle, VerificationDecision

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
        # Real graduates or the seeded simulated ones, as set on /admin/debug/a.
        "data_source": employability.analytics_source(),
    }


def _alumni_qs(filters: dict[str, Any]):
    """Build the prefetched AlumniAccount queryset filtered by the report filters."""
    qs = employability.filter_source(AlumniAccount.objects.all(), filters["data_source"])
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


def _fmt_rate(rate: float | None) -> str:
    """Format an already-computed percentage, or the em-dash used elsewhere."""
    return "—" if rate is None else f"{rate:.1f}%"


# ── 1. Batch Summary ──────────────────────────────────────────────────────


class BatchSummaryReportView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
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
            employability.filter_source(
                VerificationDecision.objects.filter(
                    evaluation_submitted=True,
                    token__alumni__profile__graduation_year__gte=filters["batch_start"],
                    token__alumni__profile__graduation_year__lte=filters["batch_end"],
                ),
                filters["data_source"],
                prefix="token__alumni__",
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

        # ── Curriculum alignment ──────────────────────────────────────────
        # The panel asked that analytics answer "is this graduate's job aligned
        # with the BSIS curriculum" rather than merely describing the job. This
        # section reports the employer-verified rate SEPARATELY from the
        # self-reported one, because blending them would present unverifiable
        # tick-boxes as fact. Graduates whose alignment cannot be determined are
        # counted as unknown, never as not-aligned.
        accounts = list(qs)
        verified_titles = verified_titles_by_alumni(a.id for a in accounts)

        align_buckets: dict[int, list] = defaultdict(list)
        field_counts: dict[str, int] = defaultdict(int)
        for acc in accounts:
            year = _grad_year(acc)
            if year is None:
                continue
            emp = _first_prefetched(acc, "_prefetched_emp")
            resolved = resolve_alignment(
                verified_job_title=verified_titles.get(acc.id),
                self_reported=(emp.current_job_related_to_bsis if emp is not None else None),
            )
            align_buckets[year].append(resolved)
            if resolved.is_field:
                field_counts[resolved.is_field] += 1

        align_rows = []
        for year in sorted(align_buckets):
            s = summarize(align_buckets[year])
            align_rows.append([
                year, s["total"],
                _fmt_rate(s["verified_rate"]), s["verified_n"],
                _fmt_rate(s["self_reported_rate"]), s["self_reported_n"],
                _fmt_rate(s["overall_rate"]), s["unknown"],
            ])
        if align_rows:
            everything = [a for bucket in align_buckets.values() for a in bucket]
            s = summarize(everything)
            align_rows.append([
                "Total", s["total"],
                _fmt_rate(s["verified_rate"]), s["verified_n"],
                _fmt_rate(s["self_reported_rate"]), s["self_reported_n"],
                _fmt_rate(s["overall_rate"]), s["unknown"],
            ])

        section_e = {
            "title": "Curriculum Alignment (BSIS)",
            "columns": [
                "Batch", "Alumni (N)",
                "Verified Aligned", "Verified (n)",
                "Self-Reported Aligned", "Self-Reported (n)",
                "Overall Aligned", "Unknown",
            ],
            "rows": align_rows,
        }

        # Which IS fields verified graduates actually landed in — the diagnostic
        # behind "check the alignment of the job field in IS".
        field_rows = [
            [JobTitle.ISField(f).label, n]
            for f, n in sorted(field_counts.items(), key=lambda kv: -kv[1])
        ]
        section_f = {
            "title": "IS Field Distribution (employer-verified titles)",
            "columns": ["IS Field", "Graduates"],
            "rows": field_rows,
        }

        return _ok(
            "Batch Summary",
            [
                section_a, section_b, section_c,
                section_d_strengths, section_d_improvements,
                section_e, section_f,
            ],
            filters,
        )


# ── 2. Employment Outcomes Roster ──────────────────────────────────────────


class EmploymentOutcomesReportView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
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


class SkillsInventoryReportView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        filters = _parse_filters(request)
        qs = _alumni_qs(filters)

        tech_overall: Counter = Counter()
        soft_overall: Counter = Counter()
        per_batch_tech: dict[int, Counter] = defaultdict(Counter)
        per_batch_soft: dict[int, Counter] = defaultdict(Counter)
        n_overall = 0
        n_per_batch: dict[int, int] = defaultdict(int)

        accounts = list(qs)
        # AlumniSkill is what registration and My Skills write; the old
        # CompetencyProfile lists are only a fallback for older records.
        listed = employability.graduate_skills(acc.id for acc in accounts)
        for acc in accounts:
            year = _grad_year(acc)
            n_overall += 1
            if year is not None:
                n_per_batch[year] += 1
            for name, kind in listed.get(str(acc.id), []):
                overall, per_batch = (soft_overall, per_batch_soft) if kind == "soft" else (tech_overall, per_batch_tech)
                overall[name] += 1
                if year is not None:
                    per_batch[year][name] += 1

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
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
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
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
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

        # The form only asks about a first job of graduates who have worked, and
        # about the current job and workplace of graduates employed now, so
        # those answers only count as missing for them.
        employed_now = {"employed_full_time", "employed_part_time", "self_employed"}

        def _is_employed_now(emp) -> bool:
            return bool(emp and emp.employment_status in employed_now)

        def _has_worked(emp) -> bool:
            return bool(emp and (emp.employment_status in employed_now or emp.first_job_title))

        REQUIRED_FIELDS = [
            ("Employment status", lambda emp, addr, skills: emp and emp.employment_status),
            ("Time-to-hire", lambda emp, addr, skills: not _has_worked(emp) or emp.time_to_hire_months is not None),
            ("Current job sector", lambda emp, addr, skills: not _is_employed_now(emp) or emp.current_job_sector),
            ("Current job title", lambda emp, addr, skills: not _is_employed_now(emp) or emp.current_job_title),
            ("Work address", lambda emp, addr, skills: not _is_employed_now(emp) or addr is not None),
            ("Technical skills", lambda emp, addr, skills: any(kind == "technical" for _, kind in skills)),
            ("Soft skills", lambda emp, addr, skills: any(kind == "soft" for _, kind in skills)),
        ]

        accounts = list(qs)
        listed = employability.graduate_skills(acc.id for acc in accounts)
        for acc in accounts:
            n_total += 1
            year = _grad_year(acc)
            if year is not None:
                per_batch_total[year] += 1

            emp = _first_prefetched(acc, "_prefetched_emp")
            addr = _first_prefetched(acc, "_prefetched_addr")
            skills = listed.get(str(acc.id), [])

            if emp:
                n_with_employment += 1
            if addr:
                n_with_address += 1
            if skills:
                n_with_skills += 1

            missing_for_this = []
            for label, check in REQUIRED_FIELDS:
                try:
                    ok = bool(check(emp, addr, skills))
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


def _rate_text(estimate: dict) -> str:
    if estimate["suppressed"]:
        return f"Hidden (n={estimate['n']})"
    if estimate["rate"] is None:
        return "-"
    return f"{estimate['rate'] * 100:.1f}%"


def _interval_text(estimate: dict) -> str:
    if estimate["rate"] is None or estimate["ci_low"] is None:
        return "-"
    return f"{estimate['ci_low'] * 100:.0f}-{estimate['ci_high'] * 100:.0f}%"


def _employability_summary(batches: list[dict], overall: dict, outlook: dict, model: dict) -> str:
    parts: list[str] = []
    employment = overall["employment_rate"]
    if not overall["respondents"]:
        parts.append("No graduates in the selected batches have answered the tracer survey yet.")
    elif employment["rate"] is None:
        parts.append(
            f"{overall['respondents']} graduates answered the tracer survey, too few in the labor force "
            f"to report an employment rate."
        )
    else:
        response = (
            f" ({overall['response_rate'] * 100:.0f}% of the masterlist)" if overall["response_rate"] else ""
        )
        parts.append(
            f"{overall['respondents']} graduates answered the tracer survey{response}. Among those working or "
            f"looking for work, {employment['rate'] * 100:.0f}% are employed (95% interval "
            f"{employment['ci_low'] * 100:.0f}-{employment['ci_high'] * 100:.0f}%)."
        )

    shown = [b for b in batches if b["employment_rate"]["rate"] is not None]
    if len(shown) >= 2:
        first, last = shown[0], shown[-1]
        parts.append(
            f"Across batches {first['batch']}-{last['batch']} the observed rate moved from "
            f"{first['employment_rate']['rate'] * 100:.0f}% to {last['employment_rate']['rate'] * 100:.0f}%; "
            f"overlapping intervals mean a difference may be sampling noise."
        )

    if outlook["available"] and outlook["years"]:
        basis = (
            "how far past batch rates moved from one batch to the next"
            if outlook["basis"] == "backtest"
            else "a default range of plus or minus 20 points until more batches are available"
        )
        ranges = "; ".join(
            f"batch {year['batch']}: {year['low'] * 100:.0f}-{year['high'] * 100:.0f}%" for year in outlook["years"]
        )
        parts.append(
            f"The expected employment range is {ranges}, based on {basis}. Each year further ahead is wider. "
            f"It is a range, not a forecast."
        )

    if model["status"] == "active":
        source = (
            "simulated graduates" if model.get("source") in {"simulated", "simulated-accounts"} else "graduate records"
        )
        parts.append(f"The active model ({model['version']}, trained on {source}) passed every acceptance check.")
    else:
        parts.append("No predictive model has passed the acceptance gate, so this report shows observed values only.")
    return " ".join(parts)


class PredictiveTrendReportView(APIView):
    """Predictive Employability Trend report.

    Observed indicators per batch with 95% intervals, time to first job, the
    expected employment range for the next batches, and the active model's
    factors and acceptance checks. Built from tracer/employability.py, the same
    source as the Analytics tab, so the report and the dashboard never disagree.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        _admin_user, _auth_error = require_admin(request)
        if _auth_error:
            return _auth_error
        filters = _parse_filters(request)
        source = filters["data_source"]
        # One batch ahead, like the Analytics tab: a second batch was only a
        # wider copy of the first, not new information.
        # Absent: through next calendar year, the same as the analytics page.
        forecast_years = None
        if request.query_params.get("forecast_years"):
            try:
                forecast_years = max(1, min(int(request.query_params["forecast_years"]), employability.OUTLOOK_MAX_YEARS))
            except (TypeError, ValueError):
                forecast_years = None

        try:
            frame = employability.build_graduate_frame(source=source)
        except Exception as exc:  # noqa: BLE001
            logger.error("Predictive trend report: graduate records failed to load - %s", exc)
            return Response(
                {"error": "Graduate records could not be loaded", "detail": str(exc)},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        future_graduation = int(frame["future_graduation"].astype(bool).sum())
        frame = employability.reportable(frame)
        masterlist = employability.masterlist_counts(source)
        active = employability.load_active_model(source)
        payload = employability.analytics_payload(frame, masterlist, active, horizon=forecast_years, source=source)
        in_range = lambda b: filters["batch_start"] <= b <= filters["batch_end"]  # noqa: E731
        batches = [b for b in payload["per_batch"] if in_range(b["batch"])]
        selected = frame[frame["batch"].apply(lambda b: in_range(int(b)))] if len(frame) else frame
        overall = employability.group_indicators(
            selected,
            sum(count for batch, count in masterlist.items() if in_range(batch)) or None,
            active,
        )
        outlook = payload["outlook"]
        model = payload["model"]
        years = [str(b["batch"]) for b in batches]

        def timeline_cell(estimate: dict) -> str:
            return "-" if estimate["rate"] is None else f"{estimate['rate'] * 100:.1f}%"

        if batches:
            simulated_note = (
                "These are SIMULATED graduates generated for demonstration, not real CHMSU graduates. "
                if source == employability.SOURCE_SIMULATED else ""
            )
            intro_text = simulated_note + (
                f"This report summarizes the employability of BSIS graduates for batches "
                f"{batches[0]['batch']}-{batches[-1]['batch']} from the graduate tracer records. Every rate is "
                f"shown with the number of graduates behind it and a 95% interval, and groups of fewer than "
                f"{employability.MIN_GROUP} graduates are hidden. The next-batch figure is an expected range "
                f"based on how much past batches varied, not a forecast. Factors are shown only from a model "
                f"that passed every acceptance check."
            )
        else:
            intro_text = "No graduating batches fall within the selected year range."

        indicator_rows = [
            [
                b["batch"],
                b["graduates"] if b["graduates"] is not None else "-",
                b["respondents"],
                f"{b['response_rate'] * 100:.0f}%" if b["response_rate"] is not None else "-",
                _rate_text(b["employment_rate"]),
                _interval_text(b["employment_rate"]),
                _rate_text(b["employed_within_12_months"]),
                _interval_text(b["employed_within_12_months"]),
                _rate_text(b["bsis_aligned_current_job"]),
            ]
            for b in batches
        ]

        tfj = overall["time_to_first_job"]
        if tfj["suppressed"]:
            time_rows = [["Hidden", f"Fewer than {employability.MIN_GROUP} graduates reported a first job"]]
        else:
            time_rows = [[band["label"], band["count"]] for band in tfj["bands"]]

        if outlook["available"]:
            basis = "Backtest of past batches" if outlook["basis"] == "backtest" else "Default +/-20 points"
            outlook_rows = [
                [y["batch"], f"{y['low'] * 100:.0f}-{y['high'] * 100:.0f}%", basis] for y in outlook["years"]
            ]
        else:
            outlook_rows = [["-", outlook["reason"], ""]]

        if model["status"] == "active" and model.get("factors"):
            factor_rows = []
            for f in model["factors"]:
                if not f["clear"]:
                    reading = "No clear association"
                elif f["odds_ratio"] >= 1:
                    reading = f"{f['odds_ratio']:.1f} times the odds of finding work within a year"
                else:
                    reading = f"{1 / f['odds_ratio']:.1f} times lower odds of finding work within a year"
                factor_rows.append(
                    [f["label"], f"{f['odds_ratio']:.2f}", f"{f['ci_low']:.2f}-{f['ci_high']:.2f}", reading]
                )
        else:
            factor_rows = [[model.get("message") or "No active model.", "", "", ""]]

        check_rows = [
            [c["label"], "Pass" if c["passed"] else "Fail", c["value"], c["rule"]]
            for c in (model.get("checks") or [])
        ] or [["No active model", "-", "Train one with python manage.py train_employability_model", ""]]

        sections: list[dict[str, Any]] = [
            {"title": "Introduction", "columns": ["Overview"], "rows": [[intro_text]]},
            {
                "title": "Executive Summary",
                "columns": ["Summary"],
                "rows": [[_employability_summary(batches, overall, outlook, model)]],
            },
            {
                # Title kept verbatim so the PDF exporter draws the trend line chart.
                "title": "Cross-Batch Timeline",
                "columns": ["Metric", *years],
                "rows": [
                    ["Employment rate", *[timeline_cell(b["employment_rate"]) for b in batches]],
                    ["Employed within 12 months", *[timeline_cell(b["employed_within_12_months"]) for b in batches]],
                ] if batches else [],
            },
            {
                "title": "Observed Indicators by Batch",
                "columns": [
                    "Batch", "Graduates", "Respondents", "Response Rate", "Employment Rate", "95% Interval",
                    "Employed Within 12 Months", "95% Interval", "BSIS-Aligned Current Job",
                ],
                "rows": indicator_rows,
            },
            {"title": "Time to First Job (Observed)", "columns": ["Time Range", "Graduates"], "rows": time_rows},
            {
                "title": f"Expected Employment Range - Next {forecast_years} Batch(es)",
                "columns": ["Batch", "Expected Range", "Basis"],
                "rows": outlook_rows,
            },
            {
                "title": "Factors Associated with Finding Work Within a Year",
                "columns": ["Factor", "Odds Ratio", "95% Interval", "Reading"],
                "rows": factor_rows,
            },
            {"title": "Model Acceptance Checks", "columns": ["Check", "Result", "Value", "Rule"], "rows": check_rows},
            {
                "title": "How to Read This Report",
                "columns": ["Note"],
                "rows": [
                    ["A 95% interval is the range the true rate probably lies in, given how many graduates answered."],
                    [f"Groups of fewer than {employability.MIN_GROUP} graduates are hidden, never shown as 0%."],
                    ["Employment rate counts graduates who are working or looking for work."],
                    ["An odds ratio above 1 means graduates with that answer were more likely to find work within a "
                     "year. It shows an association, not a cause."],
                    ["The expected range reflects how much batch rates have moved in the past. It is not a forecast."],
                ],
            },
        ]

        if future_graduation:
            sections[-1]["rows"].append([
                f"{future_graduation} graduate record(s) with a graduation date in the future were left out. "
                f"Correct their dates in Verified Graduates."
            ])

        return _ok("Predictive Employability Trend", sections, filters)
