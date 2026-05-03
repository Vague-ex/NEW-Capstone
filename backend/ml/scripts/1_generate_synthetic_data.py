"""
Stage 1: Synthetic Dataset Generator for BSIS Graduate Tracer

Generates realistic alumni records (2020-2025 batches) based on the questionnaire
spec in PredictiveModelContext.md. Outputs:
    EyeOfTheTiger/data/raw_training_data.csv     - Human-readable labels
    EyeOfTheTiger/data/processed_training_data.csv - Model-ready numeric encoding

The data-generating process encodes realistic signal so downstream regression/
classification models can actually learn the coefficients described in the spec:
    - More recent batch, higher grades, portfolio, more skills => faster hire
    - Related OJT, more tech/soft skills => higher BSIS-related job probability
    - Scholarships, English proficiency => employment probability
"""

from __future__ import annotations

import csv
from pathlib import Path

import numpy as np

RNG_SEED = 20260424
# 230 rows total, slightly larger for more recent batches
BATCH_SIZES = {2020: 35, 2021: 38, 2022: 40, 2023: 40, 2024: 39, 2025: 38}
BATCHS = list(BATCH_SIZES.keys())

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# ── Label tables ──────────────────────────────────────────────────────────────

AVERAGE_RANGE_LABELS = {5: "95-100", 4: "90-94", 3: "85-89", 2: "80-84", 1: "75-79", 0: "Below 75"}
HONORS_LABELS = {4: "Summa Cum Laude", 3: "Magna Cum Laude", 2: "Cum Laude", 1: "No Academic Honors"}
OJT_LABELS = {3: "Yes, directly related", 2: "Somewhat related", 1: "Not related", 0: "Have not secured a job"}
ENGLISH_LABELS = {3: "Professional/Business", 2: "Conversational", 1: "Basic"}
APP_COUNT_LABELS = {1: "1-5", 2: "6-15", 3: "16-30", 4: "31+"}
JOB_SOURCE_LABELS = {
    1: "Personal Network/Referral",
    2: "Online Job Portal",
    3: "CHMSU Career Fair",
    4: "Company Walk-in/Direct Hire",
    5: "Social Media",
    6: "Started own business/Freelance",
    7: "Other",
}
SECTOR_LABELS = {1: "Government", 2: "Private", 3: "Entrepreneurial/Freelance/Self-Employed"}
STATUS_LABELS = {1: "Regular/Permanent", 2: "Probationary", 3: "Contractual/Casual/Job Order", 4: "Self-Employed/Freelance"}
TIME_MIDPOINTS = {
    "Within 1 month": 1.0,
    "1-3 months": 3.0,
    "3-6 months": 4.5,
    "6 months to 1 year": 9.0,
    "1-2 years": 18.0,
    "More than 2 years": 30.0,
}


def bucket_time(months: float) -> str:
    if months <= 1.0:
        return "Within 1 month"
    if months <= 3.0:
        return "1-3 months"
    if months <= 6.0:
        return "3-6 months"
    if months <= 12.0:
        return "6 months to 1 year"
    if months <= 24.0:
        return "1-2 years"
    return "More than 2 years"


def sigmoid(x: np.ndarray | float) -> np.ndarray | float:
    return 1.0 / (1.0 + np.exp(-x))


def generate_row(rng: np.random.Generator, batch: int, alumni_idx: int) -> dict:
    batch_code = batch - 2020  # 0..5
    # Later batches skew marginally toward stronger signal (market improving)
    batch_boost = batch_code * 0.08

    gender = int(rng.random() < 0.55)  # 1 = Female (slight majority in BSIS)
    scholarship = int(rng.random() < 0.30)
    grade_range = int(np.clip(rng.normal(2.4 + batch_boost, 1.1), 0, 5))
    honors = 1
    if grade_range >= 5:
        honors = rng.choice([4, 3, 2, 1], p=[0.15, 0.25, 0.35, 0.25])
    elif grade_range == 4:
        honors = rng.choice([3, 2, 1], p=[0.20, 0.35, 0.45])
    elif grade_range == 3:
        honors = rng.choice([2, 1], p=[0.25, 0.75])
    prior_work = int(rng.random() < 0.45 + scholarship * 0.1)
    ojt_relevance = int(np.clip(rng.choice([3, 2, 1, 0], p=[0.45, 0.30, 0.20, 0.05]), 0, 3))
    portfolio = int(rng.random() < (0.35 + 0.08 * batch_code + 0.1 * (grade_range >= 3)))
    english = int(np.clip(rng.choice([3, 2, 1], p=[0.35, 0.50, 0.15]), 1, 3))

    tech_skill_count = int(np.clip(rng.normal(5 + batch_boost * 2 + portfolio * 1.5 + 0.5 * grade_range, 2.2), 0, 12))
    soft_skill_count = int(np.clip(rng.normal(5 + 0.3 * english + 0.4 * (honors >= 2), 1.8), 0, 10))

    # ── Employment status (Y2) depends on predictors ──────────────────────────
    employment_logit = (
        -1.0
        + 0.25 * batch_code
        + 0.35 * scholarship
        + 0.30 * grade_range
        + 0.20 * (honors - 1)
        + 0.55 * prior_work
        + 0.45 * (ojt_relevance >= 2)
        + 0.60 * portfolio
        + 0.40 * (english - 1)
        + 0.18 * tech_skill_count
        + 0.12 * soft_skill_count
    )
    employment_prob = sigmoid(employment_logit / 4.0)
    employed = int(rng.random() < employment_prob)

    # Employment status string
    if employed:
        emp_status_str = rng.choice(
            ["Yes, full-time", "Yes, part-time", "Yes, self-employed/freelance"],
            p=[0.70, 0.15, 0.15],
        )
    else:
        emp_status_str = rng.choice(
            ["No, currently seeking employment", "No, not seeking employment"],
            p=[0.70, 0.30],
        )

    if not employed:
        # Unemployed rows still have predictors but no employment outcomes
        return {
            "batch": batch,
            "alumni_id": f"SYN-{batch}-{alumni_idx:04d}",
            "gender": gender,
            "scholarship": scholarship,
            "general_average_range": grade_range,
            "academic_honors": honors,
            "prior_work_experience": prior_work,
            "ojt_relevance": ojt_relevance,
            "has_portfolio": portfolio,
            "english_proficiency": english,
            "technical_skill_count": tech_skill_count,
            "soft_skill_count": soft_skill_count,
            "job_applications_count": int(rng.choice([1, 2, 3, 4], p=[0.25, 0.35, 0.25, 0.15])),
            "job_source": 7,
            "first_job_sector": 0,
            "first_job_status": 0,
            "location_type": 1,
            "current_job_sector": 0,
            "time_to_hire_months": np.nan,
            "employment_status": 0,
            "bsis_related_job_first": np.nan,
            "bsis_related_job_current": np.nan,
            "label_employment": emp_status_str,
            "label_time_to_hire": "",
            "label_first_job_related": "",
            "label_current_job_related": "",
            "label_first_sector": "",
            "label_job_source": "",
        }

    # ── Time-to-hire (Y1) linear model ────────────────────────────────────────
    base = 10.0
    time = (
        base
        - 1.2 * batch_code
        - 1.1 * scholarship
        - 0.8 * grade_range
        - 0.9 * (honors - 1)
        - 2.0 * prior_work
        - 1.5 * ojt_relevance
        - 1.8 * portfolio
        - 1.0 * (english - 1)
        - 0.25 * tech_skill_count
        - 0.15 * soft_skill_count
    )
    applications = int(np.clip(1 + rng.poisson(max(0.5, time / 4)), 1, 4))
    time += 1.1 * (applications - 1)
    time = float(np.clip(time + rng.normal(0, 2.0), 0.5, 36.0))
    time_bucket = bucket_time(time)
    time_midpoint = TIME_MIDPOINTS[time_bucket]

    # Job source: portfolio + tech skills pull toward online portals / referrals
    source_weights = np.array([0.28, 0.30, 0.12, 0.10, 0.10, 0.05, 0.05])
    source_weights[1] += 0.05 * portfolio      # Online portal
    source_weights[0] += 0.05 * prior_work      # Referral
    source_weights = source_weights / source_weights.sum()
    job_source = int(rng.choice(np.arange(1, 8), p=source_weights))

    first_sector = int(rng.choice([1, 2, 3], p=[0.20, 0.65, 0.15]))
    first_status = int(rng.choice([1, 2, 3, 4], p=[0.40, 0.30, 0.20, 0.10]))

    # BSIS-related first job (Y3)
    rel_first_logit = (
        -0.5
        + 0.80 * (ojt_relevance >= 2)
        + 0.22 * tech_skill_count
        + 0.45 * portfolio
        + 0.25 * (first_sector == 2)
    )
    rel_first_prob = sigmoid(rel_first_logit / 3.0)
    bsis_first = int(rng.random() < rel_first_prob)

    # Current job sector: slight drift toward Private for experienced graduates
    current_sector = int(rng.choice([1, 2, 3], p=[0.18, 0.68, 0.14]))

    # BSIS-related current job (Y4) — more persistent if first was related
    rel_current_logit = (
        -0.3
        + 1.20 * bsis_first
        + 0.25 * tech_skill_count
        + 0.20 * portfolio
        + 0.15 * (current_sector == 2)
    )
    rel_current_prob = sigmoid(rel_current_logit / 3.0)
    bsis_current = int(rng.random() < rel_current_prob)

    location_type = int(rng.random() < 0.92)  # 92% local

    return {
        "batch": batch,
        "alumni_id": f"SYN-{batch}-{alumni_idx:04d}",
        "gender": gender,
        "scholarship": scholarship,
        "general_average_range": grade_range,
        "academic_honors": honors,
        "prior_work_experience": prior_work,
        "ojt_relevance": ojt_relevance,
        "has_portfolio": portfolio,
        "english_proficiency": english,
        "technical_skill_count": tech_skill_count,
        "soft_skill_count": soft_skill_count,
        "job_applications_count": applications,
        "job_source": job_source,
        "first_job_sector": first_sector,
        "first_job_status": first_status,
        "location_type": location_type,
        "current_job_sector": current_sector,
        "time_to_hire_months": round(time_midpoint, 2),
        "employment_status": 1,
        "bsis_related_job_first": bsis_first,
        "bsis_related_job_current": bsis_current,
        "label_employment": emp_status_str,
        "label_time_to_hire": time_bucket,
        "label_first_job_related": "Yes, directly related" if bsis_first else rng.choice(["Somewhat related", "Not related"]),
        "label_current_job_related": "Yes, directly related" if bsis_current else rng.choice(["Somewhat related", "Not related"]),
        "label_first_sector": SECTOR_LABELS[first_sector],
        "label_job_source": JOB_SOURCE_LABELS[job_source],
    }


def main() -> None:
    rng = np.random.default_rng(RNG_SEED)
    rows: list[dict] = []
    for batch in BATCHS:
        for i in range(BATCH_SIZES[batch]):
            rows.append(generate_row(rng, batch, i))

    # Raw CSV with labels
    raw_path = DATA_DIR / "raw_training_data.csv"
    raw_fields = [
        "alumni_id", "batch", "gender", "scholarship",
        "general_average_range", "academic_honors", "prior_work_experience",
        "ojt_relevance", "has_portfolio", "english_proficiency",
        "technical_skill_count", "soft_skill_count",
        "job_applications_count", "job_source",
        "first_job_sector", "first_job_status",
        "location_type", "current_job_sector",
        "time_to_hire_months", "employment_status",
        "bsis_related_job_first", "bsis_related_job_current",
        "label_employment", "label_time_to_hire",
        "label_first_job_related", "label_current_job_related",
        "label_first_sector", "label_job_source",
    ]
    with raw_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=raw_fields)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)

    # Processed numeric-only CSV (training-ready)
    processed_path = DATA_DIR / "processed_training_data.csv"
    processed_fields = [
        "alumni_id", "batch",
        "batch_code", "gender", "scholarship",
        "general_average_range", "academic_honors", "prior_work_experience",
        "ojt_relevance", "has_portfolio", "english_proficiency",
        "technical_skill_count", "soft_skill_count",
        "job_applications_count",
        "job_source_1", "job_source_2", "job_source_3", "job_source_4",
        "job_source_5", "job_source_6", "job_source_7",
        "first_sector_1", "first_sector_2", "first_sector_3",
        "first_status_1", "first_status_2", "first_status_3", "first_status_4",
        "location_type", "current_sector_1", "current_sector_2", "current_sector_3",
        # targets
        "time_to_hire_months", "employment_status",
        "bsis_related_job_first", "bsis_related_job_current",
    ]
    with processed_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=processed_fields)
        writer.writeheader()
        for row in rows:
            out = {
                "alumni_id": row["alumni_id"],
                "batch": row["batch"],
                "batch_code": row["batch"] - 2020,
                "gender": row["gender"],
                "scholarship": row["scholarship"],
                "general_average_range": row["general_average_range"],
                "academic_honors": row["academic_honors"],
                "prior_work_experience": row["prior_work_experience"],
                "ojt_relevance": row["ojt_relevance"],
                "has_portfolio": row["has_portfolio"],
                "english_proficiency": row["english_proficiency"],
                "technical_skill_count": row["technical_skill_count"],
                "soft_skill_count": row["soft_skill_count"],
                "job_applications_count": row["job_applications_count"],
                "location_type": row["location_type"],
                "time_to_hire_months": row["time_to_hire_months"],
                "employment_status": row["employment_status"],
                "bsis_related_job_first": row["bsis_related_job_first"],
                "bsis_related_job_current": row["bsis_related_job_current"],
            }
            for k in range(1, 8):
                out[f"job_source_{k}"] = int(row["job_source"] == k)
            for k in range(1, 4):
                out[f"first_sector_{k}"] = int(row["first_job_sector"] == k)
            for k in range(1, 5):
                out[f"first_status_{k}"] = int(row["first_job_status"] == k)
            for k in range(1, 4):
                out[f"current_sector_{k}"] = int(row["current_job_sector"] == k)
            writer.writerow(out)

    employed_count = sum(1 for r in rows if r["employment_status"] == 1)
    print(f"Wrote {len(rows)} rows across {len(BATCHS)} batches")
    print(f"  Employed: {employed_count} ({employed_count / len(rows):.1%})")
    print(f"  Raw:       {raw_path}")
    print(f"  Processed: {processed_path}")


if __name__ == "__main__":
    main()
