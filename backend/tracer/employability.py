"""
Employability analytics: observed indicators and the gated prediction model.

This module holds two separate things:

1. Descriptive indicators computed straight from graduate records: employment
   rate, share employed within 12 months of graduation, time to first job,
   BSIS alignment, and response rate against the masterlist. Every rate
   carries its sample size and a Wilson 95% interval, and groups with fewer
   than MIN_GROUP graduates are suppressed rather than shown.

2. One predictive model, "employed within 12 months of graduation", fitted by
   logistic regression on answers known at graduation only. Each training run
   is saved as a version, and a version can be activated only if it passed the
   acceptance gate in evaluate_candidate().

The model this replaces used job-profile answers (how the first job was found,
first-job sector and status, current sector, work location) that only employed
graduates can give. It learned the registration form's skip logic instead of
employability. Those columns are listed in POST_OUTCOME_COLUMNS, and the gate
fails any candidate that uses them. See documentations/10-ml-pipeline-methodology.md,
sections 11 to 13.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
from pathlib import Path
from statistics import mean

logger = logging.getLogger(__name__)

# Groups smaller than this are suppressed: too few to estimate, and small
# enough to point at individual graduates.
MIN_GROUP = 5
# Acceptance gate: minimum data before a model can be trusted.
MIN_RESPONDENTS = 150
MIN_MINORITY = 40
# Expected-range settings for the next batch (see employment_outlook()).
OUTLOOK_WINDOW = 3
OUTLOOK_DEFAULT_HALF_WIDTH = 0.20
OUTLOOK_MIN_HALF_WIDTH = 0.10
# By default the range runs through next calendar year, at least two and at
# most four batches past the latest one with a reportable rate.
OUTLOOK_MIN_YEARS = 2
OUTLOOK_MAX_YEARS = 4
# Year-only graduation dates are treated as mid-year.
DEFAULT_GRADUATION_MONTH = 6

FRAME_CACHE_KEY = "employability_graduate_frame"
SAMPLE_EMAIL_DOMAIN = "sample.masterlist.local"

# Which graduates the analytics describe. "real" is every registered graduate
# except seeded accounts; "simulated" is only the seeded accounts made by
# `manage.py seed_simulated_graduates`. Chosen on the admin debug page.
SOURCE_REAL = "real"
SOURCE_SIMULATED = "simulated"
SOURCES = (SOURCE_REAL, SOURCE_SIMULATED)

EMPLOYED_STATUSES = frozenset({"employed_full_time", "employed_part_time", "self_employed"})
LOOKING_STATUSES = frozenset({"seeking", "never_employed"})
OUT_OF_LABOR_FORCE_STATUSES = frozenset({"not_seeking"})

TARGET = "employed_within_12mo"
TARGET_LABEL = "Employed within 12 months of graduation"

# Answers known at graduation.
#
# Left out on purpose:
#   - skill counts: the form asks which skills a graduate has NOW, which for
#     older batches includes what they learned on the job.
#   - ojt_relevance: it asks graduates to rate work they did years ago (a 2019
#     graduate is recalling 2018), and until 2026-09 the form only showed it to
#     graduates who reported prior work experience, so most older rows are
#     blank. It is still collected and shown to admins; it is just too
#     unreliable to model.
#
# prior_work_experience means paid work BESIDES the required OJT. The form was
# reworded in 2026-09 after testers read the old label as asking about the OJT.
MODEL_FEATURES = [
    "academic_honors",
    "prior_work_experience",
    "has_portfolio",
    "scholarship",
]
FEATURE_LABELS = {
    "academic_honors": "Latin honors (1 = none, 4 = summa cum laude)",
    "prior_work_experience": "Had paid work besides the OJT before graduating",
    "ojt_relevance": "OJT relevance to BSIS (1 = not related, 3 = directly related)",
    "has_portfolio": "Has a portfolio or GitHub profile",
    "scholarship": "Held a scholarship",
}

# Only graduates who already have (or had) a job can answer these, so using
# them to predict employment is target leakage.
POST_OUTCOME_COLUMNS = frozenset({
    "employment_status", "employed_now", "in_labor_force", "time_to_hire_months",
    "job_applications_count", "first_job_applications_count", "first_job_source",
    "first_job_sector", "first_job_status", "first_job_title", "first_job_related_to_bsis",
    "current_job_sector", "current_job_title", "current_job_company",
    "current_job_related_to_bsis", "location_type", "bsis_first", "bsis_current",
})
POST_OUTCOME_PREFIXES = ("job_source_", "first_sector_", "first_status_", "current_sector_")
# Asked about the present rather than about graduation.
SURVEY_TIME_COLUMNS = frozenset({
    "technical_skill_count", "soft_skill_count", "pursuing_postgrad",
    "completed_postgrad", "further_studies_status",
})

TIME_BANDS = (
    ("Within 3 months", 3.0),
    ("3-6 months", 6.0),
    ("6-12 months", 12.0),
    ("More than 12 months", math.inf),
)

FRAME_COLUMNS = [
    "alumni_id", "batch", "gender", "months_since_graduation",
    *MODEL_FEATURES,
    "employment_status", "has_outcome", "employed_now", "in_labor_force",
    "time_to_hire_months", TARGET, "bsis_first", "bsis_current", "is_sample",
    "future_graduation",
]

_YEAR_MONTH = re.compile(r"^(\d{4})-(\d{2})$")


def _is_missing(value) -> bool:
    return value is None or (isinstance(value, float) and math.isnan(value))


# ── Derived variables ─────────────────────────────────────────────────────────

def months_since_graduation(graduation_date, graduation_year, as_of) -> int | None:
    """Whole months between graduation and `as_of` (a date or datetime)."""
    match = _YEAR_MONTH.match((graduation_date or "").strip())
    if match:
        year, month = int(match.group(1)), int(match.group(2))
    elif graduation_year:
        year, month = int(graduation_year), DEFAULT_GRADUATION_MONTH
    else:
        return None
    return max(0, (as_of.year - year) * 12 + (as_of.month - month))


def is_future_graduation(graduation_date, graduation_year, as_of) -> bool:
    """A graduation month (or, without one, a year) later than `as_of`.

    Such records are data-entry mistakes. Registration now refuses them, but
    older rows exist, so analytics leaves them out and reports how many.
    """
    match = _YEAR_MONTH.match((graduation_date or "").strip())
    if match:
        return (int(match.group(1)), int(match.group(2))) > (as_of.year, as_of.month)
    return bool(graduation_year) and int(graduation_year) > as_of.year


def employed_within_12_months(status, time_to_hire_months, months_since) -> int | None:
    """1 or 0 when the answer is known, None when it is not.

    - A reported time to first job decides it: the brackets up to "6 months to
      1 year" (stored as 1, 3, 4.5, 9) count as within 12 months; "1-2 years"
      and "More than 2 years" (18, 30) do not.
    - A graduate who is looking for work and never reported a first job counts
      as 0 once 12 months have passed, and is unknown before that (still
      inside the window).
    - Employed graduates without a hire time, graduates not in the labor force,
      and graduates with no answer are unknown.
    """
    if not _is_missing(time_to_hire_months):
        return 1 if float(time_to_hire_months) <= 12 else 0
    if status in LOOKING_STATUSES and months_since is not None and months_since >= 12:
        return 0
    return None


def is_sample_account(account) -> bool:
    """Seeded demonstration accounts (seed_sample_alumni)."""
    user = getattr(account, "user", None)
    email = (getattr(user, "email", "") or "").lower()
    if email.endswith("@" + SAMPLE_EMAIL_DOMAIN):
        return True
    template = getattr(account, "biometric_template", None)
    if isinstance(template, str):
        try:
            template = json.loads(template)
        except ValueError:
            return False
    return bool(isinstance(template, dict) and template.get("is_sample"))


def sample_q(prefix: str = ""):
    """Q matching seeded accounts, for a queryset on AlumniAccount (prefix "")
    or on a model that points at one (e.g. prefix "alumni__")."""
    from django.db.models import Q

    # `contains` (jsonb @>) is false, not NULL, for templates without the key,
    # so exclude() keeps real graduates. A key lookup would drop them all.
    return (
        Q(**{f"{prefix}biometric_template__contains": {"is_sample": True}})
        | Q(**{f"{prefix}user__email__iendswith": "@" + SAMPLE_EMAIL_DOMAIN})
    )


# region DEBUG-ONLY:CurrenChanDebug
# Demo graduates (/admin/debug/a, users/demo_accounts.py): one account per UI
# state, for walking a panel through the system. They use the sample email
# domain, so sample_q already keeps them out of real analytics.
DEMO_EMAIL_PREFIX = "demo."


def demo_q(prefix: str = ""):
    """Q matching the demo graduates, same prefix rule as sample_q."""
    from django.db.models import Q

    return Q(**{
        f"{prefix}user__email__istartswith": DEMO_EMAIL_PREFIX,
        f"{prefix}user__email__iendswith": "@" + SAMPLE_EMAIL_DOMAIN,
    })
# endregion DEBUG-ONLY:CurrenChanDebug


def filter_source(queryset, source: str | None, prefix: str = ""):
    """Keep only real graduates, only seeded ones, or (source None) everyone.
    Demo graduates are in neither source: they are UI states, not data. Both
    sources also stop at latest_graduation_year(), so while current-year
    graduates are switched off their accounts stay but analytics skip them."""
    if source not in SOURCES:
        return queryset
    if source == SOURCE_REAL:
        queryset = queryset.exclude(sample_q(prefix))
    else:
        queryset = queryset.filter(sample_q(prefix)).exclude(demo_q(prefix))
    return queryset.exclude(**{f"{prefix}profile__graduation_year__gt": latest_graduation_year()})


def latest_graduation_year() -> int:
    """The newest batch the tracer takes in: this year, or last year while
    "Allow current-year graduates" is off on /admin/debug/a (the study's scope
    is the batches up to last year)."""
    from django.utils import timezone

    year = timezone.now().year
    return year if debug_settings()["allow_current_year_graduates"] else year - 1


# ── Admin debug settings (analytics source, sample visibility) ────────────────

_SETTINGS_DEFAULTS = {"source": SOURCE_REAL, "show_samples_in_verified": False, "allow_current_year_graduates": True}


def _settings_path() -> Path:
    # Kept with the model versions: ml/models is a mounted volume on the VPS,
    # so the choice survives image rebuilds the same way active.json does.
    return model_root() / "analytics_source.json"


def debug_settings() -> dict:
    try:
        stored = json.loads(_settings_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        stored = {}
    settings = {**_SETTINGS_DEFAULTS, **{k: v for k, v in stored.items() if k in _SETTINGS_DEFAULTS}}
    if settings["source"] not in SOURCES:
        settings["source"] = SOURCE_REAL
    settings["show_samples_in_verified"] = bool(settings["show_samples_in_verified"])
    settings["allow_current_year_graduates"] = bool(settings["allow_current_year_graduates"])
    return settings


def update_debug_settings(**changes) -> dict:
    settings = debug_settings()
    if "source" in changes:
        if changes["source"] not in SOURCES:
            raise ValueError(f"source must be one of {', '.join(SOURCES)}")
        settings["source"] = changes["source"]
    for key in ("show_samples_in_verified", "allow_current_year_graduates"):
        if key in changes:
            settings[key] = bool(changes[key])
    path = _settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(settings, indent=2), encoding="utf-8")
    return settings


def analytics_source() -> str:
    return debug_settings()["source"]


def frame_cache_key(source: str | None) -> str:
    return f"{FRAME_CACHE_KEY}:{source or 'all'}"


def clear_frame_caches() -> None:
    """Drop every cached graduate frame so the next analytics load rebuilds it."""
    from django.core.cache import cache

    cache.delete_many([frame_cache_key(source) for source in (*SOURCES, None)])


def _scholarship(text) -> int:
    value = (text or "").strip().lower()
    return 0 if value in {"", "none", "no", "n/a", "na", "not applicable"} else 1


def leaked_features(features) -> list[str]:
    """Features that are measured after, or because of, the outcome."""
    return [
        f for f in features
        if f == TARGET
        or f in POST_OUTCOME_COLUMNS
        or f in SURVEY_TIME_COLUMNS
        or f.startswith(POST_OUTCOME_PREFIXES)
    ]


def build_graduate_frame(as_of=None, source: str | None = None):
    """One row per active graduate with a graduation year.

    `source` narrows it to real graduates or seeded ones (see SOURCES); None
    keeps both, with the is_sample column telling them apart.
    """
    import pandas as pd
    from django.db.models import BooleanField, ExpressionWrapper
    from django.utils import timezone
    from users.models import AccountStatus, AlumniProfile

    now = as_of or timezone.now()
    profiles = filter_source(
        AlumniProfile.objects
        .filter(alumni__account_status=AccountStatus.ACTIVE, graduation_year__isnull=False)
        .select_related("alumni", "alumni__user")
        # The face template (40-80 KB per real graduate) was loaded only to
        # read is_sample; the query answers that with sample_q instead.
        .defer("alumni__biometric_template")
        .annotate(_is_sample=ExpressionWrapper(sample_q("alumni__"), output_field=BooleanField()))
        .prefetch_related("alumni__employment_profiles"),
        source,
        prefix="alumni__",
    )

    rows: list[dict] = []
    for profile in profiles:
        account = profile.alumni
        employments = list(account.employment_profiles.all())
        emp = max(employments, key=lambda e: e.updated_at) if employments else None
        status = (emp.employment_status or "") if emp else ""
        # The survey answers describe the moment they were last submitted.
        answered_at = emp.updated_at if emp else now
        months = months_since_graduation(profile.graduation_date, profile.graduation_year, answered_at)
        tth = emp.time_to_hire_months if emp else None

        if status in EMPLOYED_STATUSES:
            employed_now, in_labor_force = 1, 1
        elif status in LOOKING_STATUSES:
            employed_now, in_labor_force = 0, 1
        elif status in OUT_OF_LABOR_FORCE_STATUSES:
            employed_now, in_labor_force = 0, 0
        else:
            # No employment answer is "unknown", not "unemployed".
            employed_now, in_labor_force = None, None

        gender = (profile.gender or "").strip().lower()
        rows.append({
            "alumni_id": str(account.pk),
            "batch": int(profile.graduation_year),
            "gender": "female" if gender.startswith("f") else "male" if gender.startswith("m") else None,
            "months_since_graduation": months,
            "academic_honors": profile.academic_honors,
            "prior_work_experience": (
                None if profile.prior_work_experience is None else int(bool(profile.prior_work_experience))
            ),
            # 0 is the form's "Not applicable", so 0 and blank both mean unknown.
            "ojt_relevance": profile.ojt_relevance if profile.ojt_relevance else None,
            "has_portfolio": None if profile.has_portfolio is None else int(bool(profile.has_portfolio)),
            "scholarship": _scholarship(profile.scholarship),
            "employment_status": status or None,
            "has_outcome": int(employed_now is not None),
            "employed_now": employed_now,
            "in_labor_force": in_labor_force,
            "time_to_hire_months": tth,
            TARGET: employed_within_12_months(status, tth, months),
            "bsis_first": (
                None if not emp or emp.first_job_related_to_bsis is None else int(emp.first_job_related_to_bsis)
            ),
            "bsis_current": (
                None if not emp or emp.current_job_related_to_bsis is None else int(emp.current_job_related_to_bsis)
            ),
            "is_sample": profile._is_sample,
            "future_graduation": is_future_graduation(profile.graduation_date, profile.graduation_year, now),
        })
    return pd.DataFrame(rows, columns=FRAME_COLUMNS)


def masterlist_counts(source: str = SOURCE_REAL) -> dict[int, int]:
    """Graduates per batch on the masterlist: the denominator for response rates.

    Seeded graduates are not on the real masterlist. They are a simulated
    census of it, so their own batch sizes stand in as its denominator.
    """
    from django.db.models import Count
    from users.models import AccountStatus, AlumniProfile, GraduateMasterRecord

    if source == SOURCE_SIMULATED:
        rows = filter_source(
            AlumniProfile.objects.filter(alumni__account_status=AccountStatus.ACTIVE, graduation_year__isnull=False),
            SOURCE_SIMULATED,
            prefix="alumni__",
        ).values("graduation_year").annotate(n=Count("id"))
        return {int(row["graduation_year"]): int(row["n"]) for row in rows}

    return {
        int(row["batch_year"]): int(row["n"])
        for row in (
            GraduateMasterRecord.objects
            .filter(batch_year__lte=latest_graduation_year())
            .values("batch_year")
            .annotate(n=Count("id"))
        )
        if row["batch_year"]
    }


def reportable(frame):
    """Rows that can be analyzed: records with a future graduation date are left out."""
    if "future_graduation" not in frame.columns:
        return frame
    return frame[~frame["future_graduation"].fillna(False).astype(bool)]


# ── Descriptive indicators ────────────────────────────────────────────────────

def wilson_interval(k: int, n: int, z: float = 1.96) -> tuple[float | None, float | None]:
    if not n:
        return (None, None)
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


def rate_estimate(values) -> dict:
    """Proportion of 1s among the known values.

    `rate` is None both when there is no data (n = 0) and when the group is
    suppressed (n < MIN_GROUP). Neither may be displayed as 0%.
    """
    known = [int(v) for v in values if not _is_missing(v)]
    n = len(known)
    if n == 0:
        return {"n": 0, "k": 0, "rate": None, "ci_low": None, "ci_high": None, "suppressed": False}
    if n < MIN_GROUP:
        return {"n": n, "k": None, "rate": None, "ci_low": None, "ci_high": None, "suppressed": True}
    k = sum(known)
    low, high = wilson_interval(k, n)
    return {"n": n, "k": k, "rate": k / n, "ci_low": low, "ci_high": high, "suppressed": False}


def time_to_first_job(values) -> dict:
    known = [float(v) for v in values if not _is_missing(v)]
    n = len(known)
    if 0 < n < MIN_GROUP:
        return {"n": n, "suppressed": True, "bands": [{"label": label, "count": None} for label, _ in TIME_BANDS]}
    counts = {label: 0 for label, _ in TIME_BANDS}
    for months in known:
        for label, upper in TIME_BANDS:
            if months <= upper:
                counts[label] += 1
                break
    return {"n": n, "suppressed": False, "bands": [{"label": label, "count": counts[label]} for label, _ in TIME_BANDS]}


def _expected_rate(frame, active) -> dict | None:
    """Mean predicted chance of finding work within 12 months, over graduates
    whose actual 12-month outcome is known, so the two can be compared."""
    if not active:
        return None
    known = frame[frame[TARGET].notna()]
    n = int(len(known))
    if n == 0:
        return {"rate": None, "n": 0, "suppressed": False}
    if n < MIN_GROUP:
        return {"rate": None, "n": n, "suppressed": True}
    features = active["meta"]["features"]
    probabilities = active["model"].predict_proba(known[features].astype(float))[:, 1]
    return {"rate": float(probabilities.mean()), "n": n, "suppressed": False}


def group_indicators(frame, graduates: int | None = None, active=None) -> dict:
    respondents = int(len(frame))
    labor_force = frame[frame["in_labor_force"] == 1]
    # More respondents than masterlist records means the masterlist is missing
    # graduates for these batches, so no meaningful response rate exists.
    masterlist_incomplete = bool(graduates) and respondents > graduates
    return {
        "respondents": respondents,
        "graduates": int(graduates) if graduates else None,
        "response_rate": (respondents / graduates) if graduates and not masterlist_incomplete else None,
        "masterlist_incomplete": masterlist_incomplete,
        "sample_accounts": int(frame["is_sample"].astype(bool).sum()) if respondents else 0,
        "n_with_outcome": int(frame["has_outcome"].fillna(0).sum()) if respondents else 0,
        # Standard labor-force definition: employed among graduates who are
        # working or looking for work.
        "employment_rate": rate_estimate(labor_force["employed_now"].tolist()),
        "employed_within_12_months": rate_estimate(frame[TARGET].tolist()),
        "bsis_aligned_first_job": rate_estimate(frame["bsis_first"].tolist()),
        "bsis_aligned_current_job": rate_estimate(frame["bsis_current"].tolist()),
        "time_to_first_job": time_to_first_job(frame["time_to_hire_months"].tolist()),
        "model_expected_within_12_months": _expected_rate(frame, active),
    }


def employment_outlook(
    per_batch: list[dict], horizon: int | None = None, current_year: int | None = None,
) -> dict:
    """Expected range for the next batches' employment rate.

    Not a forecast from features. The centre is the mean of the last
    OUTLOOK_WINDOW batches with a reportable rate. The half-width comes from a
    backtest: how far each past batch landed from the mean of the batches
    before it (80% interval, 1.2816 times the root-mean-square error). With
    fewer than three backtest errors it falls back to +/-20 points, the
    uncertainty the realistic-data stress test found for six batches.

    `horizon` fixes the number of years. Left as None, the range covers every
    batch from the one after the latest reported batch through next calendar
    year (OUTLOOK_MIN_YEARS to OUTLOOK_MAX_YEARS of them), so a dashboard whose
    newest data is two years old still looks past the current year.
    """
    points = [
        (entry["batch"], entry["employment_rate"]["rate"])
        for entry in per_batch
        if entry["employment_rate"]["rate"] is not None
    ]
    if len(points) < 2:
        return {
            "available": False,
            "reason": "Needs at least two batches with five or more graduates in the labor force.",
            "years": [],
        }

    errors = []
    for i in range(1, len(points)):
        previous = [rate for _, rate in points[max(0, i - OUTLOOK_WINDOW):i]]
        errors.append(points[i][1] - mean(previous))

    recent = points[-OUTLOOK_WINDOW:]
    centre = mean(rate for _, rate in recent)
    if len(errors) >= 3:
        half = max(1.2816 * math.sqrt(mean(e * e for e in errors)), OUTLOOK_MIN_HALF_WIDTH)
        basis = "backtest"
    else:
        half = OUTLOOK_DEFAULT_HALF_WIDTH
        basis = "default"

    # Anchor on the latest batch with a reportable rate, not the latest batch
    # of any kind: a few records with a mistyped future graduation year would
    # otherwise push the expected range years ahead.
    latest = points[-1][0]
    if horizon is None:
        if current_year is None:
            from django.utils import timezone

            current_year = timezone.now().year
        horizon = min(OUTLOOK_MAX_YEARS, max(OUTLOOK_MIN_YEARS, current_year + 1 - latest))
    years = []
    for step in range(1, horizon + 1):
        width = half * math.sqrt(step)
        years.append({
            "batch": latest + step,
            "centre": centre,
            "low": max(0.0, centre - width),
            "high": min(1.0, centre + width),
        })
    return {
        "available": True,
        "basis": basis,
        "batches_used": [batch for batch, _ in recent],
        "backtest_errors": len(errors),
        "half_width": half,
        "years": years,
    }


def model_summary(active, source: str = SOURCE_REAL) -> dict:
    if not active:
        command = (
            "python manage.py train_employability_model --source simulated-accounts --activate"
            if source == SOURCE_SIMULATED
            else "python manage.py train_employability_model"
        )
        return {
            "status": "none",
            "message": (
                "No model has passed the acceptance gate yet, so only observed values are shown. "
                f"Train one with: {command}"
            ),
        }
    meta = active["meta"]
    return {
        "status": "active",
        **{key: meta.get(key) for key in (
            "version", "trained_at", "source", "source_details", "target_label",
            "features", "passed", "metrics", "checks", "factors",
        )},
    }


def analytics_payload(
    frame, masterlist: dict[int, int], active=None, batch: int | None = None, horizon: int | None = None,
    source: str = SOURCE_REAL,
) -> dict:
    future_graduation = (
        int(frame["future_graduation"].fillna(False).astype(bool).sum()) if "future_graduation" in frame.columns else 0
    )
    frame = reportable(frame)
    batches = sorted({int(b) for b in frame["batch"].dropna().unique()} | set(masterlist))
    per_batch = []
    for value in batches:
        entry = group_indicators(frame[frame["batch"] == value], masterlist.get(value), active)
        entry["batch"] = value
        per_batch.append(entry)

    if batch is None:
        overall = group_indicators(frame, sum(masterlist.values()) or None, active)
    else:
        overall = group_indicators(frame[frame["batch"] == batch], masterlist.get(batch), active)

    return {
        "batch": batch,
        "overall": overall,
        "per_batch": per_batch,
        "outlook": employment_outlook(per_batch, horizon),
        "model": model_summary(active, source),
        "data_issues": {"future_graduation": future_graduation},
        "data_source": source,
    }


# ── Skills ────────────────────────────────────────────────────────────────────

# The registration form's checklists. Stored skill lists also contain free-text
# entries and a few soft skills saved under technical, so the type comes from
# these lists whenever a name matches.
TECHNICAL_SKILLS = (
    "Programming/Software Development", "Web Development", "Mobile App Development",
    "Database Management", "Network Administration", "Cloud Computing",
    "Data Analytics/Business Intelligence", "System Analysis and Design",
    "Technical Support/Troubleshooting", "Project Management", "UI/UX Design",
    "Cybersecurity/Information Security",
)
SOFT_SKILLS = (
    "Oral Communication", "Written Communication", "Teamwork/Collaboration",
    "Problem-solving/Critical Thinking", "Adaptability/Flexibility", "Leadership",
    "Customer Service Orientation", "Attention to Detail", "Ability to Work Under Pressure",
    "Time Management",
)


def skill_key(name: str) -> str:
    """Case- and spacing-insensitive key, so "Technical Support / Troubleshooting"
    and "Technical Support/Troubleshooting" count as one skill."""
    return re.sub(r"\s+", " ", re.sub(r"\s*/\s*", "/", (name or "").strip())).casefold()


_CANONICAL_SKILLS = {
    **{skill_key(name): (name, "technical") for name in TECHNICAL_SKILLS},
    **{skill_key(name): (name, "soft") for name in SOFT_SKILLS},
}


def canonical_skill(name: str, kind: str) -> tuple[str, str]:
    """(name, "technical" | "soft") to show for a listed skill: the form list's
    spelling and type when the name matches one, otherwise as stored."""
    return _CANONICAL_SKILLS.get(skill_key(name), (name, kind))


def rate_difference(k1: int, n1: int, k2: int, n2: int) -> tuple[float, float, float]:
    """Difference of two proportions with a Newcombe 95% interval (from the two
    Wilson intervals), which stays sensible when a group is all 1s or all 0s."""
    p1, p2 = k1 / n1, k2 / n2
    low1, high1 = wilson_interval(k1, n1)
    low2, high2 = wilson_interval(k2, n2)
    difference = p1 - p2
    low = difference - math.sqrt((p1 - low1) ** 2 + (high2 - p2) ** 2)
    high = difference + math.sqrt((high1 - p1) ** 2 + (p2 - low2) ** 2)
    return difference, low, high


def graduate_skills(alumni_ids) -> dict[str, list[tuple[str, str]]]:
    """alumni_id -> [(skill name, "technical" | "soft")].

    AlumniSkill is what registration and the My Skills page write. Graduates
    with no AlumniSkill rows fall back to the legacy CompetencyProfile lists,
    so records saved before AlumniSkill existed still count.
    """
    from tracer.models import AlumniSkill, CompetencyProfile

    ids = {str(a) for a in alumni_ids}
    found: dict[str, list[tuple[str, str]]] = {}
    rows = AlumniSkill.objects.filter(alumni_id__in=ids).values_list("alumni_id", "skill__name", "skill__category__name")
    for alumni_id, name, category in rows:
        if name and name.strip():
            kind = "soft" if (category or "").strip().lower() == "soft" else "technical"
            found.setdefault(str(alumni_id), []).append((name.strip(), kind))

    missing = ids - set(found)
    if missing:
        legacy = CompetencyProfile.objects.filter(alumni_id__in=missing).values("alumni_id", "technical_skills", "soft_skills")
        for profile in legacy:
            alumni = str(profile["alumni_id"])
            for kind, items in (("technical", profile["technical_skills"]), ("soft", profile["soft_skills"])):
                for item in items or []:
                    if isinstance(item, dict) and item.get("selected") and str(item.get("name") or "").strip():
                        found.setdefault(alumni, []).append((str(item["name"]).strip(), kind))
    return found


def skill_summary(frame, top_n: int = 10) -> dict:
    """The skills graduates listed most, and how employment compares with and
    without each one.

    - share: graduates who listed the skill, out of graduates who listed any skill.
    - comparison: employment rate of graduates in the labor force who listed the
      skill vs those who did not, with a 95% interval for the difference. Given
      only when both groups have MIN_GROUP or more graduates. It is a link, not a
      cause: graduates also pick up skills at work.
    Skills listed by fewer than MIN_GROUP graduates are counted but not shown.
    """
    ids = {str(a) for a in frame["alumni_id"]}
    employed = {
        str(row.alumni_id): int(row.employed_now)
        for row in frame.itertuples()
        if row.in_labor_force == 1 and not _is_missing(row.employed_now)
    }

    holders: dict[str, set[str]] = {}
    names: dict[str, tuple[str, str]] = {}
    listed_any: set[str] = set()
    for alumni, listed in graduate_skills(ids).items():
        for name, list_kind in listed:
            key = skill_key(name)
            names.setdefault(key, _CANONICAL_SKILLS.get(key, (name, list_kind)))
            holders.setdefault(key, set()).add(alumni)
            listed_any.add(alumni)

    respondents = len(listed_any)
    labor_force = {a for a in listed_any if a in employed}
    rows = []
    for key, people in holders.items():
        if len(people) < MIN_GROUP:
            continue
        name, kind = names[key]
        with_skill = [employed[a] for a in people & labor_force]
        without_skill = [employed[a] for a in labor_force - people]
        comparison = None
        if len(with_skill) >= MIN_GROUP and len(without_skill) >= MIN_GROUP:
            difference, low, high = rate_difference(sum(with_skill), len(with_skill), sum(without_skill), len(without_skill))
            comparison = {
                "with_rate": sum(with_skill) / len(with_skill),
                "with_n": len(with_skill),
                "without_rate": sum(without_skill) / len(without_skill),
                "without_n": len(without_skill),
                "difference_points": difference * 100,
                "difference_low_points": low * 100,
                "difference_high_points": high * 100,
                "clear": bool(low > 0 or high < 0),
            }
        rows.append({
            "skill": name,
            "kind": kind,
            "graduates": len(people),
            "share": len(people) / respondents,
            "comparison": comparison,
        })
    rows.sort(key=lambda r: (-r["graduates"], r["skill"]))
    return {
        "respondents": respondents,
        "labor_force": len(labor_force),
        "min_group": MIN_GROUP,
        "hidden_skills": sum(1 for people in holders.values() if len(people) < MIN_GROUP),
        "skills": rows[:top_n],
    }


def skills_by_batch(frame, top_n: int = 8) -> dict:
    """Share of each batch's graduates who listed each of the most common skills.

    Built for a batch-by-skill heatmap shown beside each batch's employment
    rate. It describes what each batch reports; batches also differ in job
    market and years since graduating, so a pattern is a trend, not proof.

    - A skill appears only if at least MIN_GROUP graduates listed it overall.
    - A batch column is hidden (shares None) when fewer than MIN_GROUP of its
      graduates filled in the skills checklist.
    """
    batch_of = {
        str(row.alumni_id): int(row.batch)
        for row in frame.itertuples()
        if not _is_missing(row.batch)
    }
    names: dict[str, tuple[str, str]] = {}
    holders: dict[str, dict[int, set[str]]] = {}
    listers: dict[int, set[str]] = {}
    for alumni, listed in graduate_skills(batch_of).items():
        batch = batch_of.get(alumni)
        if batch is None or not listed:
            continue
        listers.setdefault(batch, set()).add(alumni)
        for name, list_kind in listed:
            key = skill_key(name)
            names.setdefault(key, _CANONICAL_SKILLS.get(key, (name, list_kind)))
            holders.setdefault(key, {}).setdefault(batch, set()).add(alumni)

    batches = sorted(listers)
    totals = {key: sum(len(people) for people in per.values()) for key, per in holders.items()}
    columns = [
        {"batch": b, "respondents": len(listers[b]), "suppressed": len(listers[b]) < MIN_GROUP}
        for b in batches
    ]

    def rows_for(kind: str) -> list[dict]:
        # Technical and soft skills are ranked separately: the soft-skill list is
        # shorter, so its entries would otherwise crowd every technical skill out.
        common = [key for key in holders if names[key][1] == kind and totals[key] >= MIN_GROUP]
        common.sort(key=lambda key: (-totals[key], names[key][0]))
        rows = []
        for key in common[:top_n]:
            cells = []
            for column in columns:
                count = len(holders[key].get(column["batch"], ()))
                cells.append({
                    "batch": column["batch"],
                    "count": None if column["suppressed"] else count,
                    "share": None if column["suppressed"] else count / column["respondents"],
                })
            rows.append({"skill": names[key][0], "graduates": totals[key], "cells": cells})
        return rows

    return {
        "min_group": MIN_GROUP,
        "batches": columns,
        "technical": rows_for("technical"),
        "soft": rows_for("soft"),
    }


# ── Model: training, acceptance gate, versions ────────────────────────────────

def model_root() -> Path:
    from django.conf import settings

    configured = getattr(settings, "EMPLOYABILITY_MODEL_DIR", None)
    return Path(configured) if configured else Path(settings.BASE_DIR) / "ml" / "models" / "employability"


def _pipeline():
    from sklearn.impute import SimpleImputer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline

    # No scaling, so each coefficient is a log odds ratio per unit of the
    # original answer. Missing answers get an indicator column instead of
    # being silently read as a real value.
    return make_pipeline(
        SimpleImputer(strategy="median", add_indicator=True),
        LogisticRegression(C=1.0, max_iter=2000),
    )


def _coefficients(pipeline) -> dict[str, float]:
    names = pipeline[0].get_feature_names_out()
    return {str(name): float(coef) for name, coef in zip(names, pipeline[-1].coef_[0])}


def evaluate_candidate(frame, features=None, repeats: int = 10, n_boot: int = 200, seed: int = 42) -> dict:
    """Fit the model and run every acceptance check.

    Returns {"features", "metrics", "checks", "factors", "passed", "model"}.
    `model` is the pipeline refitted on all eligible rows, or None when there
    is too little data to fit one.
    """
    import numpy as np
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import brier_score_loss, roc_auc_score
    from sklearn.model_selection import RepeatedStratifiedKFold

    features = list(features or MODEL_FEATURES)
    data = frame.dropna(subset=[TARGET]).reset_index(drop=True)
    X = data[features].astype(float)
    y = data[TARGET].astype(int).to_numpy()
    n = int(len(y))
    positives = int(y.sum())
    minority = min(positives, n - positives)

    checks: list[dict] = []

    def check(key, label, passed, value, rule):
        checks.append({"key": key, "label": label, "passed": bool(passed), "value": value, "rule": rule})

    leaked = leaked_features(features)
    check("leakage", "No input measured after the outcome", not leaked,
          ", ".join(leaked) if leaked else "All inputs are known at graduation",
          "Every input is known at graduation")

    need = max(MIN_MINORITY, 10 * len(features))
    check("sample_size", "Enough graduates", n >= MIN_RESPONDENTS and minority >= need,
          f"{n} graduates, {minority} in the smaller outcome group",
          f"At least {MIN_RESPONDENTS} graduates and {need} in the smaller outcome group")

    metrics: dict = {"n": n, "n_positive": positives, "outcome_rate": (positives / n) if n else None}
    remaining = [
        ("baseline", "Beats the no-model baseline", "Brier score lower than the baseline's"),
        ("discrimination", "Separates the two outcomes", "Mean AUC at least 0.65, 5th percentile above 0.55"),
        ("temporal", "Holds up on the latest batches", "On batches it never saw: AUC within 0.10 of cross-validation, calibration slope 0.7 to 1.3"),
        ("calibration", "Predicted chances match reality", "Calibration slope between 0.7 and 1.3"),
        ("stability", "Reported factors are stable", "Each factor with a clear direction keeps it in at least 80% of bootstrap refits"),
        ("fairness", "Works similarly for female and male graduates", "No group of 30 or more with AUC more than 0.10 below overall"),
    ]
    if minority < 5:
        for key, label, rule in remaining:
            check(key, label, False, "Not evaluated: too few graduates in one outcome group", rule)
        return {"features": features, "metrics": metrics, "checks": checks, "factors": [], "passed": False, "model": None}

    # Repeated stratified cross-validation, with out-of-fold probabilities kept
    # for the calibration and fairness checks.
    splitter = RepeatedStratifiedKFold(n_splits=min(5, minority), n_repeats=repeats, random_state=seed)
    aucs, briers, baseline_briers = [], [], []
    oof_sum = np.zeros(n)
    oof_count = np.zeros(n)
    for train_idx, test_idx in splitter.split(X, y):
        fitted = _pipeline().fit(X.iloc[train_idx], y[train_idx])
        p = fitted.predict_proba(X.iloc[test_idx])[:, 1]
        oof_sum[test_idx] += p
        oof_count[test_idx] += 1
        if len(set(y[test_idx])) == 2:
            aucs.append(roc_auc_score(y[test_idx], p))
        briers.append(brier_score_loss(y[test_idx], p))
        baseline_briers.append(brier_score_loss(y[test_idx], np.full(len(test_idx), y[train_idx].mean())))
    oof = oof_sum / np.maximum(oof_count, 1)

    auc_mean = float(np.mean(aucs)) if aucs else 0.5
    auc_p05 = float(np.percentile(aucs, 5)) if aucs else 0.5
    brier = float(np.mean(briers))
    baseline_brier = float(np.mean(baseline_briers))
    metrics.update(cv_auc_mean=auc_mean, cv_auc_p05=auc_p05, brier=brier, baseline_brier=baseline_brier)

    check("baseline", "Beats the no-model baseline", brier < baseline_brier,
          f"Brier {brier:.3f} vs baseline {baseline_brier:.3f}", "Brier score lower than the baseline's")
    check("discrimination", "Separates the two outcomes", auc_mean >= 0.65 and auc_p05 > 0.55,
          f"AUC {auc_mean:.2f} (5th percentile {auc_p05:.2f})",
          "Mean AUC at least 0.65, 5th percentile above 0.55")

    # Temporal holdout: learn from older batches, test on the two latest.
    #
    # This asks whether the RELATIONSHIPS hold on batches the model never saw:
    # ranking (AUC close to cross-validation) and strength (calibration slope).
    # The gap between the predicted and observed average is reported as drift
    # but does not fail the check, for three reasons: the shipped model is refit
    # on every batch and so carries the current base rate; a base-rate shift
    # between cohorts is a labor-market change rather than a broken model, and
    # the dashboard reports each batch's rate observationally anyway; and a rule
    # demanding the average land inside the observed interval gets stricter as
    # the sample grows (±4 points at n=500, ±14 at n=50), which is backwards.
    batches = sorted(int(b) for b in data["batch"].dropna().unique())
    temporal_ok, temporal_value = False, "Needs at least four batches"
    if len(batches) >= 4:
        test_mask = data["batch"].isin(batches[-2:]).to_numpy()
        y_train, y_test = y[~test_mask], y[test_mask]
        if min(y_train.sum(), len(y_train) - y_train.sum()) >= 5 and len(set(y_test)) == 2:
            fitted = _pipeline().fit(X[~test_mask], y_train)
            p = fitted.predict_proba(X[test_mask])[:, 1]
            temporal_auc = float(roc_auc_score(y_test, p))
            predicted = float(p.mean())
            observed = float(y_test.mean())
            held = np.clip(p, 1e-6, 1 - 1e-6)
            temporal_slope = float(
                LogisticRegression(C=1e6, max_iter=1000)
                .fit(np.log(held / (1 - held)).reshape(-1, 1), y_test)
                .coef_[0][0]
            )
            drift = (predicted - observed) * 100
            temporal_ok = abs(temporal_auc - auc_mean) <= 0.10 and 0.7 <= temporal_slope <= 1.3
            temporal_value = (
                f"AUC {temporal_auc:.2f} (cross-validation {auc_mean:.2f}), slope {temporal_slope:.2f} "
                f"on batches {batches[-2]}-{batches[-1]}; base rate drifted {drift:+.0f} points "
                f"(predicted {predicted:.0%} vs observed {observed:.0%})"
            )
            metrics.update(
                temporal_auc=temporal_auc, temporal_slope=temporal_slope,
                temporal_predicted_rate=predicted, temporal_observed_rate=observed,
                temporal_drift_points=drift,
            )
        else:
            temporal_value = "Too few graduates in one outcome group to test on the latest batches"
    check("temporal", "Holds up on the latest batches", temporal_ok, temporal_value,
          "On batches it never saw: AUC within 0.10 of cross-validation, calibration slope 0.7 to 1.3")

    clipped = np.clip(oof, 1e-6, 1 - 1e-6)
    logit = np.log(clipped / (1 - clipped)).reshape(-1, 1)
    slope = float(LogisticRegression(C=1e6, max_iter=1000).fit(logit, y).coef_[0][0])
    metrics["calibration_slope"] = slope
    check("calibration", "Predicted chances match reality", 0.7 <= slope <= 1.3,
          f"Calibration slope {slope:.2f}", "Calibration slope between 0.7 and 1.3")

    # Final model and bootstrap factors.
    model = _pipeline().fit(X, y)
    full = _coefficients(model)
    rng = np.random.default_rng(seed)
    boot: dict[str, list[float]] = {f: [] for f in features}
    for _ in range(n_boot):
        idx = rng.integers(0, n, n)
        if len(set(y[idx])) < 2:
            continue
        coefs = _coefficients(_pipeline().fit(X.iloc[idx], y[idx]))
        for f in features:
            if f in coefs:
                boot[f].append(coefs[f])

    factors = []
    for f in features:
        if f not in full or not boot[f]:
            continue
        estimate = full[f]
        samples = np.array(boot[f])
        low, high = np.percentile(samples, [2.5, 97.5])
        consistency = float(np.mean(np.sign(samples) == np.sign(estimate))) if estimate else 0.0
        factors.append({
            "feature": f,
            "label": FEATURE_LABELS.get(f, f),
            "odds_ratio": float(math.exp(estimate)),
            "ci_low": float(math.exp(low)),
            "ci_high": float(math.exp(high)),
            "direction_consistency": consistency,
            "stable": consistency >= 0.8,
            # The 95% interval excludes "no association" (an odds ratio of 1).
            "clear": bool(low > 0 or high < 0),
        })
    clear = [f for f in factors if f["clear"]]
    check("stability", "Reported factors are stable", all(f["stable"] for f in clear),
          f"{len(clear)} factor(s) with a clear direction, {sum(f['stable'] for f in clear)} stable",
          "Each factor with a clear direction keeps it in at least 80% of bootstrap refits")

    overall_auc = float(roc_auc_score(y, oof)) if len(set(y)) == 2 else 0.5
    groups = []
    for group in ("female", "male"):
        mask = (data["gender"] == group).to_numpy()
        if mask.sum() >= 30 and len(set(y[mask])) == 2:
            groups.append((group, float(roc_auc_score(y[mask], oof[mask]))))
    check("fairness", "Works similarly for female and male graduates",
          all(overall_auc - auc <= 0.10 for _, auc in groups),
          "; ".join(f"{g} AUC {auc:.2f}" for g, auc in groups) + f"; overall {overall_auc:.2f}"
          if groups else "No group of 30 or more to compare",
          "No group of 30 or more with AUC more than 0.10 below overall")

    return {
        "features": features,
        "metrics": metrics,
        "checks": checks,
        "factors": factors,
        "passed": all(c["passed"] for c in checks),
        "model": model,
    }


def save_version(result: dict, frame, source: str, source_details: dict | None = None) -> tuple[str, dict]:
    """Save a training run, passed or not. Failed runs are kept as a record."""
    import joblib
    from django.utils import timezone

    root = model_root()
    root.mkdir(parents=True, exist_ok=True)
    now = timezone.now()
    base = now.strftime("v%Y%m%d-%H%M%S")
    folder, suffix = root / base, 1
    while folder.exists():
        folder = root / f"{base}-{suffix}"
        suffix += 1
    folder.mkdir()

    if result.get("model") is not None:
        joblib.dump(result["model"], folder / "model.joblib")

    features = result["features"]
    columns = [c for c in ["batch", *features, TARGET] if c in frame.columns]
    digest = hashlib.sha256(frame[columns].to_csv(index=False).encode("utf-8")).hexdigest()
    meta = {
        "version": folder.name,
        "trained_at": now.isoformat(),
        "source": source,
        "source_details": source_details or {},
        "target": TARGET,
        "target_label": TARGET_LABEL,
        "features": features,
        "feature_labels": {f: FEATURE_LABELS.get(f, f) for f in features},
        "passed": bool(result["passed"]),
        "has_model_file": result.get("model") is not None,
        "metrics": result["metrics"],
        "checks": result["checks"],
        "factors": result["factors"],
        "dataset_sha256": digest,
    }
    (folder / "metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return folder.name, meta


def _pointer_name(source: str) -> str:
    return "active-simulated.json" if source == SOURCE_SIMULATED else "active.json"


def activate_version(version: str, source: str = SOURCE_REAL) -> None:
    """Make a passing version the active model for real or seeded graduates.
    Each source has its own pointer, so switching the analytics source on the
    debug page never swaps a real-data model for a simulated one."""
    from django.utils import timezone

    root = model_root()
    meta_path = root / version / "metadata.json"
    if not meta_path.exists():
        raise ValueError(f"Unknown model version: {version}")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if not meta.get("passed") or not meta.get("has_model_file"):
        raise ValueError(f"{version} did not pass the acceptance gate and cannot be activated")
    pointer = root / _pointer_name(source)
    previous = None
    if pointer.exists():
        try:
            previous = json.loads(pointer.read_text(encoding="utf-8")).get("version")
        except ValueError:
            previous = None
    pointer.write_text(
        json.dumps({"version": version, "activated_at": timezone.now().isoformat(), "previous": previous}, indent=2),
        encoding="utf-8",
    )


_ACTIVE_CACHE: dict = {}


def load_active_model(source: str = SOURCE_REAL) -> dict | None:
    """The active model for a source, reloaded whenever its pointer changes."""
    import joblib

    root = model_root()
    pointer = root / _pointer_name(source)
    try:
        stamp = pointer.stat().st_mtime_ns
    except OSError:
        return None
    key = (str(root), stamp)
    cached = _ACTIVE_CACHE.get(source)
    if cached and cached["key"] == key:
        return cached["value"]

    value = None
    try:
        version = json.loads(pointer.read_text(encoding="utf-8"))["version"]
        folder = root / version
        meta = json.loads((folder / "metadata.json").read_text(encoding="utf-8"))
        if meta.get("passed"):
            value = {"version": version, "meta": meta, "model": joblib.load(folder / "model.joblib")}
        else:
            logger.warning("Active employability model %s did not pass the gate; ignoring it", version)
    except (OSError, ValueError, KeyError):
        logger.exception("Could not load the active employability model")
    _ACTIVE_CACHE[source] = {"key": key, "value": value}
    return value


# ── Simulated graduates (for demonstrating the pipeline before real data) ──────

def load_simulator():
    """The realistic-data generator in ml/experiments/realistic_stress_test.py.
    Also used by `manage.py seed_simulated_graduates`."""
    import importlib.util

    from django.conf import settings

    path = Path(settings.BASE_DIR) / "ml" / "experiments" / "realistic_stress_test.py"
    spec = importlib.util.spec_from_file_location("realistic_stress_test", path)
    sim = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sim)
    return sim


def simulated_frame(scenario: str = "harsh", signal: str = "moderate", respondents: int | None = None, seed: int = 20260916):
    """Graduate frame from the realistic-data stress test generator."""
    import numpy as np
    import pandas as pd

    sim = load_simulator()

    params = {**sim.SCENARIOS[scenario], **sim.SIGNAL_LEVELS[signal]}
    sizes = dict(sim.MASTERLIST_BATCH_SIZES)
    if respondents:
        scale = respondents / (sum(sizes.values()) * 0.33)
        sizes = {batch: max(5, round(count * scale)) for batch, count in sizes.items()}
    rng = np.random.default_rng(seed)
    survey = sim.run_survey(rng, sim.generate_population(rng, sizes, params))

    status = survey["status"]
    frame = pd.DataFrame({
        "alumni_id": [f"SIM-{i:05d}" for i in range(len(survey))],
        "batch": survey["batch"].astype(int),
        "gender": np.where(survey["gender"] == 1, "female", "male"),
        "months_since_graduation": (sim.SURVEY_YEAR - survey["batch"]) * 12,
        "academic_honors": survey["academic_honors"],
        "prior_work_experience": survey["prior_work_experience"],
        # The simulation's lowest OJT level stands in for the form's "Not applicable".
        "ojt_relevance": survey["ojt_relevance"].where(survey["ojt_relevance"] > 0),
        "has_portfolio": survey["has_portfolio"],
        "scholarship": survey["scholarship"],
        "employment_status": status.map({"employed": "employed_full_time"}).fillna(status),
        "has_outcome": 1,
        "employed_now": survey["employment_status"],
        "in_labor_force": (status != "not_seeking").astype(int),
        "time_to_hire_months": survey["time_to_hire_months"],
        TARGET: survey["employed_within_12mo"],
        "bsis_first": np.nan,
        "bsis_current": np.nan,
        "is_sample": False,
        "future_graduation": False,
    })
    details = {"scenario": scenario, "signal": signal, "respondents": int(len(frame)), "seed": seed}
    return frame[FRAME_COLUMNS], details
