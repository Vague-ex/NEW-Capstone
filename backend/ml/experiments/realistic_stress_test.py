"""
Realistic-data stress test for the employability pipeline.

Question this answers: "If the pipeline were fed REAL CHMSU BSIS tracer data,
what could it honestly predict?"

The retired pipeline trained on a generated corpus that was clean by
construction. This script instead simulates what a real tracer survey would
return, then runs that pipeline's setup and a set of honest alternatives on it.
It is still used: the training command's simulated mode imports the generator
below (see tracer/employability.py, simulated_frame).

What makes the simulated data "realistic"
    - Population = the actual CHMSU BSIS masterlist batch sizes (2019-2024, 524 grads).
    - Base rates anchored to the 4th Philippine Graduate Tracer Study (PIDS):
      ~86% in the labor force, ~75% employed, median ~5 months to first job
      for non-licensure programs. The default "harsh" scenario is deliberately
      worse than PIDS (more unemployed, slower hiring) to reflect 2024-2026
      reports of rising graduate unemployment.
    - Pandemic batches (2020-2021) face a weaker market.
    - Most of what decides employment is NOT on the survey form (networks,
      location, interview skill, luck) - modelled as a large hidden factor.
    - Survey predictors have small, literature-sized effects.
    - Employed graduates are more likely to answer the survey (non-response bias,
      ~33% response rate).
    - Answers are messy: blanks, self-report noise in skill counts, recall error
      in the time-to-hire bucket, a few mis-reported employment statuses.
    - Form skip logic is reproduced: "Seeking" respondents still fill in their
      First Job, only employed respondents fill in Current Job.

Nothing here reads or writes ml/models, so the live dashboard is unaffected.

Run from backend/:
    python ml/experiments/realistic_stress_test.py                                   # harsh market, moderate signal
    python ml/experiments/realistic_stress_test.py --scenario pids --signal strong
    python ml/experiments/realistic_stress_test.py --quick                            # fewer repeats
"""

from __future__ import annotations

import argparse
import json
import math
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    f1_score,
    roc_auc_score,
)
from sklearn.model_selection import (
    KFold,
    RepeatedKFold,
    RepeatedStratifiedKFold,
    StratifiedKFold,
    cross_val_score,
    cross_validate,
)
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "results"

SEED = 20260915
RS = 42
BASE_YEAR = 2020
SURVEY_YEAR = 2026  # survey taken mid-2026; graduation assumed mid-year

# Real batch sizes from users_graduate_master_records (queried 2026-09-15).
MASTERLIST_BATCH_SIZES = {2019: 98, 2020: 82, 2021: 70, 2022: 68, 2023: 102, 2024: 104}

SCENARIOS = {
    "harsh": {
        "label": "Harsh market (more unemployed than PIDS)",
        "base_hazard": 0.045,  # monthly chance of landing a first job for an average graduate
        "not_in_lf": 0.15,     # not seeking work (studies, family, abroad plans)
        "stay_logit": 0.9,     # log-odds that an ever-employed graduate is employed NOW
    },
    "pids": {
        "label": "PIDS-like (~75% of graduates employed)",
        "base_hazard": 0.085,
        "not_in_lf": 0.13,
        "stay_logit": 2.0,
    },
}

# How much the survey's pre-graduation answers actually matter. Nobody knows the
# true value for CHMSU, so the test is run across the plausible range instead of
# assuming one (assuming one would make the conclusion circular).
#   weak     - small effects, most of the outcome is unobserved (networks, luck)
#              -> best achievable AUC ~0.57
#   moderate - form answers matter somewhat -> best achievable AUC ~0.65-0.70
#   strong   - comparable to the better published real-data studies
#              (~75-80% accuracy) -> best achievable AUC ~0.76-0.83
SIGNAL_LEVELS = {
    "weak": {"signal_label": "Weak signal in survey answers", "effect_scale": 1.0, "hidden_sd": 0.8},
    "moderate": {"signal_label": "Moderate signal in survey answers", "effect_scale": 2.5, "hidden_sd": 0.6},
    "strong": {"signal_label": "Strong signal in survey answers", "effect_scale": 5.0, "hidden_sd": 0.4},
}

# Market shock per batch (added to log-hazard). Pandemic cohorts are hit hardest.
BATCH_SHOCK = {2019: 0.0, 2020: -0.6, 2021: -0.4, 2022: -0.1, 2023: 0.0, 2024: -0.15, 2025: -0.15}

RESPONSE_INTERCEPT = -1.05  # gives ~33% survey response

TTH_UPPER = [1.0, 3.0, 6.0, 12.0, 24.0, math.inf]
TTH_LABELS = ["Within 1 month", "1-3 months", "3-6 months", "6 months to 1 year", "1-2 years", "More than 2 years"]
TTH_MIDPOINTS = [1.0, 3.0, 4.5, 9.0, 18.0, 30.0]

JOB_SOURCES = ["personal_network", "online_portal", "social_media", "career_fair", "walk_in", "entrepreneurship", "other"]
JOB_SOURCE_P = [0.25, 0.25, 0.17, 0.08, 0.15, 0.05, 0.05]
SECTORS = ["government", "private", "entrepreneurial"]
SECTOR_P = [0.25, 0.65, 0.10]
STATUSES = ["regular", "probationary", "contractual", "self_employed"]
STATUS_P = [0.30, 0.25, 0.35, 0.10]

IT_TITLES = {
    "IT Support / Technical Support": 0.26,
    "Web / Software Developer": 0.20,
    "Data Encoder / Data Analyst": 0.18,
    "MIS / IT Staff (Government)": 0.14,
    "Network / Systems Administrator": 0.08,
    "QA / Software Tester": 0.07,
    "UI/UX / Graphic Designer": 0.07,
}
NON_IT_TITLES = {
    "Customer Service Rep / Call Center Agent": 0.34,
    "Administrative / Office Staff": 0.22,
    "Sales / Marketing Staff": 0.10,
    "Government Clerk / Job Order": 0.10,
    "Virtual Assistant / Freelancer": 0.08,
    "Teacher / Instructor": 0.06,
    "Bank / Finance Staff": 0.06,
    "Other": 0.04,
}

PRE_GRAD_FEATURES = [
    "batch_code", "gender", "scholarship", "academic_honors", "prior_work_experience",
    "ojt_relevance", "has_portfolio", "pursuing_postgrad", "completed_postgrad",
    "technical_skill_count", "soft_skill_count",
]

# Exactly the 30 features the retired model used, in its metadata order.
CURRENT_PIPELINE_FEATURES = (
    PRE_GRAD_FEATURES
    + ["job_applications_count"]
    + [f"job_source_{k}" for k in range(1, 8)]
    + [f"first_sector_{k}" for k in range(1, 4)]
    + [f"first_status_{k}" for k in range(1, 5)]
    + ["location_type"]
    + [f"current_sector_{k}" for k in range(1, 4)]
)


def sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def bucket_index(months: float) -> int:
    for i, upper in enumerate(TTH_UPPER):
        if months <= upper:
            return i
    return len(TTH_UPPER) - 1


def pick(rng: np.random.Generator, weights: dict[str, float]) -> str:
    keys = list(weights)
    p = np.array([weights[k] for k in keys], dtype=float)
    return str(rng.choice(keys, p=p / p.sum()))


# ── 1. Population (the truth, including things a survey never sees) ────────────

def generate_population(rng: np.random.Generator, batch_sizes: dict[int, int], sc: dict) -> pd.DataFrame:
    rows: list[dict] = []
    for batch, n in batch_sizes.items():
        months_since = max(0, (SURVEY_YEAR - batch) * 12)
        shock = BATCH_SHOCK.get(batch, 0.0)
        for _ in range(n):
            hidden = rng.normal()  # networks, location, interview skill, luck
            gender = int(rng.random() < 0.5)
            scholarship = int(rng.random() < 0.25)
            honors = int(rng.choice([1, 2, 3, 4], p=[0.85, 0.11, 0.035, 0.005]))
            prior_work = int(rng.random() < 0.35)
            ojt = int(rng.choice([0, 1, 2, 3], p=[0.05, 0.20, 0.35, 0.40]))
            portfolio = int(rng.random() < 0.20 + 0.10 * (ojt == 3) + 0.05 * (honors > 1))
            tech_true = int(np.clip(rng.poisson(4 + 2 * portfolio), 0, 12))
            soft_true = int(np.clip(rng.poisson(6), 0, 10))
            r = rng.random()
            postgrad = "completed" if r < 0.02 + 0.005 * months_since / 12 else ("enrolled" if r < 0.08 else "none")

            # Effects on the log-hazard of landing a first job. Covariates are
            # centred on their population means, so effect_scale changes how much
            # the form's answers matter without shifting the overall rates.
            k = sc["effect_scale"]
            lin = k * (
                0.10 * (scholarship - 0.25)
                + 0.15 * (honors - 1.2)
                + 0.30 * (prior_work - 0.35)
                + 0.12 * (ojt - 2.1)
                + 0.20 * (portfolio - 0.28)
                + 0.03 * (tech_true - 4.6)
                + 0.01 * (soft_true - 6.0)
                - 0.25 * ((postgrad == "enrolled") - 0.06)
            ) + shock
            not_in_lf_p = sc["not_in_lf"] * (1.6 if postgrad == "enrolled" else 1.0)
            in_lf = rng.random() >= not_in_lf_p
            hazard = sc["base_hazard"] * math.exp(lin + sc["hidden_sd"] * hidden)
            t_first = rng.exponential(1.0 / hazard) if in_lf else math.inf
            ever = t_first <= months_since

            employed_now = 0
            if ever:
                stay = sigmoid(sc["stay_logit"] + 0.6 * sc["hidden_sd"] * hidden
                               + k * (0.3 * (prior_work - 0.35) + 0.1 * (ojt - 2.1)) + 0.5 * shock)
                employed_now = int(rng.random() < stay)

            title, it_job = None, None
            if employed_now:
                it_p = sigmoid(-0.8 + k * (0.15 * (tech_true - 4.6) + 0.5 * (portfolio - 0.28) + 0.3 * ((ojt == 3) - 0.4))
                               + 0.3 * rng.normal())
                it_job = int(rng.random() < it_p)
                title = pick(rng, IT_TITLES if it_job else NON_IT_TITLES)

            rows.append({
                "batch": batch, "months_since_graduation": months_since, "hidden_factor": hidden,
                "gender": gender, "scholarship": scholarship, "academic_honors": honors,
                "prior_work_experience": prior_work, "ojt_relevance": ojt, "has_portfolio": portfolio,
                "tech_true": tech_true, "soft_true": soft_true, "postgrad": postgrad,
                "in_labor_force": int(in_lf), "t_first_job": t_first, "ever_employed": int(ever),
                "employed_now": employed_now, "it_related_job": it_job, "job_title": title,
            })
    return pd.DataFrame(rows)


# ── 2. Survey (what the tracer form would actually capture) ────────────────────

def run_survey(rng: np.random.Generator, pop: pd.DataFrame, census: bool = False, noisy: bool = True) -> pd.DataFrame:
    if census:
        df = pop.copy()
    else:
        logit = RESPONSE_INTERCEPT + 0.6 * pop["employed_now"] + 0.15 * (pop["batch"] >= SURVEY_YEAR - 3)
        responded = rng.random(len(pop)) < 1.0 / (1.0 + np.exp(-logit))
        df = pop[responded].copy()
    df = df.reset_index(drop=True)
    n = len(df)

    def blank(values: np.ndarray, rate: float) -> np.ndarray:
        out = values.astype(float).copy()
        if noisy:
            out[rng.random(n) < rate] = np.nan
        return out

    tech = df["tech_true"].to_numpy(float)
    soft = df["soft_true"].to_numpy(float)
    ojt = df["ojt_relevance"].to_numpy(float).copy()
    employed_obs = df["employed_now"].to_numpy(int).copy()
    if noisy:
        tech = np.clip(np.rint(tech + rng.normal(0, 1.5, n)), 0, 12)
        soft = np.clip(np.rint(soft + rng.normal(0, 1.5, n)), 0, 10)
        shift = rng.random(n) < 0.20
        ojt[shift] = np.clip(ojt[shift] + rng.choice([-1, 1], shift.sum()), 0, 3)
        flip = rng.random(n) < 0.03  # e.g. freelancers unsure whether they "count" as employed
        employed_obs[flip] = 1 - employed_obs[flip]

    obs = pd.DataFrame({
        "batch": df["batch"],
        "batch_code": df["batch"] - BASE_YEAR,
        "gender": df["gender"].astype(float),
        "scholarship": df["scholarship"].astype(float),  # blank is encoded as 0 on the form
        "academic_honors": blank(df["academic_honors"].to_numpy(), 0.05),
        "prior_work_experience": blank(df["prior_work_experience"].to_numpy(), 0.06),
        "ojt_relevance": blank(ojt, 0.12),
        "has_portfolio": blank(df["has_portfolio"].to_numpy(), 0.08),
        "pursuing_postgrad": (df["postgrad"] == "enrolled").astype(float),
        "completed_postgrad": (df["postgrad"] == "completed").astype(float),
        "technical_skill_count": blank(tech, 0.15),
        "soft_skill_count": blank(soft, 0.15),
    })

    status, has_first, has_current = [], [], []
    for i in range(n):
        ever = bool(df.at[i, "ever_employed"])
        if employed_obs[i] == 1:
            s = "employed"
        elif ever:
            s = "seeking" if rng.random() < 0.8 else "not_seeking"
        elif df.at[i, "in_labor_force"]:
            s = "seeking" if rng.random() < 0.6 else "never_employed"
        else:
            s = "not_seeking"
        status.append(s)
        # Form skip logic: Seeking still fills First Job; Never Employed / Not Seeking skip it.
        has_first.append(ever and s in ("employed", "seeking"))
        has_current.append(ever and s == "employed")
    obs["status"] = status
    obs["employment_status"] = employed_obs

    bucket = np.full(n, np.nan)
    applications = np.full(n, np.nan)
    source, first_sector, first_status = [None] * n, [None] * n, [None] * n
    current_sector, location_type, title = [None] * n, np.full(n, np.nan), [None] * n
    for i in range(n):
        if has_first[i]:
            t = df.at[i, "t_first_job"]
            b = bucket_index(t)
            if noisy and rng.random() < 0.25:  # recall error: off by one bucket
                b = int(np.clip(b + rng.choice([-1, 1]), 0, 5))
            if not (noisy and rng.random() < 0.10):
                bucket[i] = b
            applications[i] = int(np.clip(1 + rng.poisson(t / 6.0), 1, 4))
            if not (noisy and rng.random() < 0.05):
                source[i] = str(rng.choice(JOB_SOURCES, p=JOB_SOURCE_P))
            first_sector[i] = str(rng.choice(SECTORS, p=SECTOR_P))
            first_status[i] = str(rng.choice(STATUSES, p=STATUS_P))
        if has_current[i]:
            current_sector[i] = str(rng.choice(SECTORS, p=[0.22, 0.68, 0.10]))
            location_type[i] = float(rng.random() < 0.93)
            if not (noisy and rng.random() < 0.08):
                title[i] = df.at[i, "job_title"]
    obs["tth_bucket"] = bucket
    obs["job_applications_count"] = applications
    obs["job_source"] = source
    obs["first_job_sector"] = first_sector
    obs["first_job_status"] = first_status
    obs["current_job_sector"] = current_sector
    obs["location_type"] = location_type
    obs["job_title"] = title
    obs["it_related_job"] = df["it_related_job"]

    # Targets derived the way an analyst would from the form.
    no_job_in_lf = obs["status"].isin(["seeking", "never_employed"]) & ~pd.Series(has_first)
    obs["employed_within_12mo"] = np.where(
        obs["tth_bucket"].notna(), (obs["tth_bucket"] <= 3).astype(float),
        np.where(no_job_in_lf, 0.0, np.nan),
    )
    obs["tth_3class"] = np.where(
        obs["tth_bucket"].notna(),
        np.select([obs["tth_bucket"] <= 1, obs["tth_bucket"] <= 3], [0.0, 1.0], 2.0),
        np.where(no_job_in_lf, 2.0, np.nan),
    )
    obs["time_to_hire_months"] = obs["tth_bucket"].map(lambda b: TTH_MIDPOINTS[int(b)] if pd.notna(b) else np.nan)
    obs["true_employed_now"] = df["employed_now"]
    return obs


def encode_current_pipeline(obs: pd.DataFrame) -> pd.DataFrame:
    """Mirror tracer/api.py::_build_live_df + _aggregate_for_batch encoding."""
    X = obs[PRE_GRAD_FEATURES].copy()
    X["job_applications_count"] = obs["job_applications_count"].fillna(0)
    for k, s in enumerate(JOB_SOURCES, start=1):
        X[f"job_source_{k}"] = (obs["job_source"] == s).astype(int)
    for k, s in enumerate(SECTORS, start=1):
        X[f"first_sector_{k}"] = (obs["first_job_sector"] == s).astype(int)
    for k, s in enumerate(STATUSES, start=1):
        X[f"first_status_{k}"] = (obs["first_job_status"] == s).astype(int)
    X["location_type"] = obs["location_type"].fillna(0)
    for k, s in enumerate(SECTORS, start=1):
        X[f"current_sector_{k}"] = (obs["current_job_sector"] == s).astype(int)
    X = X[CURRENT_PIPELINE_FEATURES]
    return X.fillna(X.median())


# ── 3. Evaluation helpers ──────────────────────────────────────────────────────

def summ(values) -> dict:
    a = np.asarray(values, dtype=float)
    return {"mean": round(float(a.mean()), 3), "sd": round(float(a.std()), 3),
            "p05": round(float(np.percentile(a, 5)), 3), "p95": round(float(np.percentile(a, 95)), 3)}


def lr_clf():
    return make_pipeline(SimpleImputer(strategy="median", add_indicator=True), StandardScaler(),
                         LogisticRegression(max_iter=2000, C=0.5))


def rf_clf():
    return make_pipeline(SimpleImputer(strategy="median", add_indicator=True),
                         RandomForestClassifier(n_estimators=200, max_depth=6, random_state=RS, n_jobs=1))


def baseline_clf():
    return make_pipeline(SimpleImputer(strategy="median"), DummyClassifier(strategy="prior"))


def eval_binary(X: pd.DataFrame, y: pd.Series, repeats: int) -> dict:
    cv = RepeatedStratifiedKFold(n_splits=5, n_repeats=repeats, random_state=RS)
    scoring = {"auc": "roc_auc", "accuracy": "accuracy", "balanced_accuracy": "balanced_accuracy",
               "f1": "f1", "brier": "neg_brier_score"}
    out = {}
    for name, est in (("majority_baseline", baseline_clf()), ("logistic_regression", lr_clf()), ("random_forest", rf_clf())):
        s = cross_validate(est, X, y, cv=cv, scoring=scoring)
        res = {k: summ(s[f"test_{k}"]) for k in scoring}
        res["brier"] = summ(-s["test_brier"])
        out[name] = res
    return out


def eval_multiclass(X: pd.DataFrame, y: pd.Series, repeats: int, top_k: int = 3) -> dict:
    y = y.reset_index(drop=True)
    X = X.reset_index(drop=True)
    cv = RepeatedKFold(n_splits=5, n_repeats=repeats, random_state=RS)
    models = {
        "majority_baseline": baseline_clf,
        "logistic_regression": lr_clf,
        "random_forest": rf_clf,
    }
    out = {}
    for name, factory in models.items():
        acc, bal, mf1, topk = [], [], [], []
        for tr, te in cv.split(X):
            est = factory().fit(X.iloc[tr], y.iloc[tr])
            proba = est.predict_proba(X.iloc[te])
            classes = est.classes_
            pred = classes[np.argmax(proba, axis=1)]
            yt = y.iloc[te].to_numpy()
            acc.append(accuracy_score(yt, pred))
            bal.append(balanced_accuracy_score(yt, pred))
            mf1.append(f1_score(yt, pred, average="macro"))
            k = min(top_k, len(classes))
            top = classes[np.argsort(-proba, axis=1)[:, :k]]
            topk.append(float(np.mean([yt[i] in top[i] for i in range(len(yt))])))
        out[name] = {"accuracy": summ(acc), "balanced_accuracy": summ(bal), "macro_f1": summ(mf1),
                     f"top{top_k}_accuracy": summ(topk)}
    return out


def eval_regression(X: pd.DataFrame, y: pd.Series, repeats: int) -> dict:
    cv = RepeatedKFold(n_splits=5, n_repeats=repeats, random_state=RS)
    models = {
        "median_baseline": make_pipeline(SimpleImputer(strategy="median"), DummyRegressor(strategy="median")),
        "ridge": make_pipeline(SimpleImputer(strategy="median", add_indicator=True), StandardScaler(), Ridge(alpha=1.0)),
        "random_forest": make_pipeline(SimpleImputer(strategy="median", add_indicator=True),
                                       RandomForestRegressor(n_estimators=200, max_depth=6, random_state=RS, n_jobs=1)),
    }
    out = {}
    for name, est in models.items():
        s = cross_validate(est, X, y, cv=cv, scoring={"r2": "r2", "mae": "neg_mean_absolute_error"})
        out[name] = {"r2": summ(s["test_r2"]), "mae_months": summ(-s["test_mae"])}
    return out


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (float("nan"), float("nan"))
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (round(centre - half, 3), round(centre + half, 3))


# ── 4. Experiments ─────────────────────────────────────────────────────────────

def describe(pop: pd.DataFrame, survey: pd.DataFrame) -> dict:
    per_batch = []
    for b in sorted(pop["batch"].unique()):
        p = pop[pop["batch"] == b]
        s = survey[survey["batch"] == b]
        k = int(s["employment_status"].sum())
        per_batch.append({
            "batch": int(b), "graduates": int(len(p)), "respondents": int(len(s)),
            "true_employment_rate": round(float(p["employed_now"].mean()), 3),
            "survey_employment_rate": round(k / len(s), 3) if len(s) else None,
            "survey_95ci": wilson(k, len(s)),
        })
    ever = pop[pop["ever_employed"] == 1]
    first = ever["t_first_job"].map(bucket_index).value_counts(normalize=True).sort_index()
    return {
        "population": int(len(pop)),
        "respondents": int(len(survey)),
        "response_rate": round(len(survey) / len(pop), 3),
        "true_employment_rate": round(float(pop["employed_now"].mean()), 3),
        "survey_employment_rate": round(float(survey["employment_status"].mean()), 3),
        "true_labor_force_share": round(float(pop["in_labor_force"].mean()), 3),
        "true_median_months_to_first_job": round(float(ever["t_first_job"].median()), 1),
        "true_first_job_bucket_share": {TTH_LABELS[int(i)]: round(float(v), 3) for i, v in first.items()},
        "true_it_related_share_of_employed": round(float(pop.loc[pop["employed_now"] == 1, "it_related_job"].mean()), 3),
        "missing_share_in_survey": {c: round(float(survey[c].isna().mean()), 3)
                                    for c in ["ojt_relevance", "technical_skill_count", "has_portfolio", "tth_bucket"]},
        "per_batch": per_batch,
    }


def current_pipeline_as_is(survey: pd.DataFrame) -> dict:
    """Rebuild the retired pipeline's employment setup (30 features, scaler + RF, KFold F1)."""
    X = encode_current_pipeline(survey)
    y = survey["employment_status"].astype(int)
    cv = KFold(n_splits=5, shuffle=True, random_state=RS)
    rf = make_pipeline(StandardScaler(), RandomForestClassifier(n_estimators=200, max_depth=6, random_state=RS, n_jobs=1))
    f1 = cross_val_score(rf, X, y, cv=cv, scoring="f1")
    auc = cross_val_score(rf, X, y, cv=cv, scoring="roc_auc")
    base_f1 = f1_score(y, np.ones_like(y)) if y.mean() >= 0.5 else 0.0
    rf.fit(X, y)
    imp = rf[-1].feature_importances_
    top = [{"feature": CURRENT_PIPELINE_FEATURES[i], "importance": round(float(imp[i]), 3)} for i in np.argsort(-imp)[:5]]
    rule = (X[[f"current_sector_{k}" for k in range(1, 4)]].sum(axis=1) > 0).astype(int)
    return {
        "cv_f1": summ(f1), "cv_auc": summ(auc),
        "always_employed_f1": round(float(base_f1), 3),
        "top_features": top,
        "one_line_rule_current_sector_filled_accuracy": round(float(accuracy_score(y, rule)), 3),
    }


def temporal_holdout(survey: pd.DataFrame, pop: pd.DataFrame, target: str) -> dict:
    d = survey.dropna(subset=[target])
    train, test = d[d["batch"] <= 2022], d[d["batch"] >= 2023]
    out = {"train_n": int(len(train)), "test_n": int(len(test)),
           "test_observed_rate": round(float(test[target].mean()), 3)}
    if target == "employment_status":
        out["test_true_population_rate"] = round(float(pop.loc[pop["batch"] >= 2023, "employed_now"].mean()), 3)
    for name, factory in (("logistic_regression", lr_clf), ("random_forest", rf_clf)):
        est = factory().fit(train[PRE_GRAD_FEATURES], train[target].astype(int))
        p = est.predict_proba(test[PRE_GRAD_FEATURES])[:, 1]
        out[name] = {"auc": round(float(roc_auc_score(test[target].astype(int), p)), 3),
                     "predicted_rate": round(float(p.mean()), 3)}
    return out


def ceiling(rng: np.random.Generator, sc: dict) -> dict:
    """Best AUC achievable from the form's pre-graduation answers with unlimited clean data."""
    big = {b: n * 60 for b, n in MASTERLIST_BATCH_SIZES.items()}
    pop = generate_population(rng, big, sc)
    s = run_survey(rng, pop, census=True, noisy=False)
    half = len(s) // 2
    idx = rng.permutation(len(s))
    tr, te = s.iloc[idx[:half]], s.iloc[idx[half:]]
    out = {"n": int(len(s))}
    for target in ("employment_status", "employed_within_12mo"):
        a, b = tr.dropna(subset=[target]), te.dropna(subset=[target])
        est = lr_clf().fit(a[PRE_GRAD_FEATURES], a[target].astype(int))
        out[target] = round(float(roc_auc_score(b[target].astype(int), est.predict_proba(b[PRE_GRAD_FEATURES])[:, 1])), 3)
    return out


def learning_curve(rng: np.random.Generator, sc: dict, sizes: list[int], worlds: int) -> dict:
    out = {}
    for n in sizes:
        scale = n / (sum(MASTERLIST_BATCH_SIZES.values()) * 0.30)
        batch_sizes = {b: max(5, int(round(c * scale))) for b, c in MASTERLIST_BATCH_SIZES.items()}
        aucs = {"employment_status": [], "employed_within_12mo": []}
        for _ in range(worlds):
            s = run_survey(rng, generate_population(rng, batch_sizes, sc))
            if len(s) > n:
                s = s.sample(n, random_state=int(rng.integers(1_000_000))).reset_index(drop=True)
            for target in aucs:
                d = s.dropna(subset=[target])
                y = d[target].astype(int)
                if y.nunique() < 2 or y.value_counts().min() < 5:
                    continue
                cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=int(rng.integers(1_000_000)))
                aucs[target].append(cross_val_score(lr_clf(), d[PRE_GRAD_FEATURES], y, cv=cv, scoring="roc_auc").mean())
        out[str(n)] = {t: summ(v) for t, v in aucs.items() if v}
    return out


def forecast_backtest(rng: np.random.Generator, sc: dict, worlds: int) -> dict:
    """Predict batch 2024's true employment rate from surveyed 2019-2023 batches."""
    hist = [2019, 2020, 2021, 2022, 2023]
    errs = {"linear_trend": [], "mean_of_past_batches": [], "last_batch": []}
    widths = []
    for _ in range(worlds):
        pop = generate_population(rng, MASTERLIST_BATCH_SIZES, sc)
        s = run_survey(rng, pop)
        rates = np.array([s.loc[s["batch"] == b, "employment_status"].mean() for b in hist])
        truth = pop.loc[pop["batch"] == 2024, "employed_now"].mean()
        x = np.array(hist, dtype=float)
        slope, intercept = np.polyfit(x, rates, 1)
        pred = slope * 2024 + intercept
        resid = rates - (slope * x + intercept)
        se = math.sqrt((resid ** 2).sum() / (len(x) - 2)) * math.sqrt(1 + 1 / len(x) + (2024 - x.mean()) ** 2 / ((x - x.mean()) ** 2).sum())
        widths.append(2 * 1.638 * se)  # 80% PI, t with 3 df
        errs["linear_trend"].append(abs(pred - truth))
        errs["mean_of_past_batches"].append(abs(rates.mean() - truth))
        errs["last_batch"].append(abs(rates[-1] - truth))
    return {
        "worlds": worlds,
        "mean_abs_error_pct_points": {k: round(100 * float(np.mean(v)), 1) for k, v in errs.items()},
        "p90_abs_error_pct_points": {k: round(100 * float(np.percentile(v, 90)), 1) for k, v in errs.items()},
        "linear_trend_80pct_interval_width_pct_points": summ(np.array(widths) * 100),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", choices=sorted(SCENARIOS), default="harsh")
    ap.add_argument("--signal", choices=list(SIGNAL_LEVELS), default="moderate")
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args()
    sc = {**SCENARIOS[args.scenario], **SIGNAL_LEVELS[args.signal]}
    repeats = 3 if args.quick else 5
    worlds = 8 if args.quick else 20
    rng = np.random.default_rng(SEED)

    pop = generate_population(rng, MASTERLIST_BATCH_SIZES, sc)
    survey = run_survey(rng, pop)

    report: dict = {"scenario": args.scenario, "scenario_label": sc["label"],
                    "signal": args.signal, "signal_label": sc["signal_label"], "seed": SEED}
    print(f"Scenario: {sc['label']} | {sc['signal_label']}")

    report["data_profile"] = describe(pop, survey)
    dp = report["data_profile"]
    print(f"\n[data] {dp['respondents']} of {dp['population']} graduates responded ({dp['response_rate']:.0%})."
          f" True employed {dp['true_employment_rate']:.0%}, survey shows {dp['survey_employment_rate']:.0%}."
          f" Median first job {dp['true_median_months_to_first_job']} mo.")

    report["current_pipeline_as_is"] = current_pipeline_as_is(survey)
    cp = report["current_pipeline_as_is"]
    print(f"[current pipeline] CV F1 {cp['cv_f1']['mean']} / AUC {cp['cv_auc']['mean']}"
          f" | 'current sector filled' rule acc {cp['one_line_rule_current_sector_filled_accuracy']}"
          f" | top feature {cp['top_features'][0]['feature']}")

    y_now = survey["employment_status"].astype(int)
    report["employment_now_pre_graduation"] = eval_binary(survey[PRE_GRAD_FEATURES], y_now, repeats)
    d12 = survey.dropna(subset=["employed_within_12mo"])
    report["employed_within_12mo_pre_graduation"] = eval_binary(d12[PRE_GRAD_FEATURES], d12["employed_within_12mo"].astype(int), repeats)
    report["employed_within_12mo_pre_graduation"]["n"] = int(len(d12))
    for key in ("employment_now_pre_graduation", "employed_within_12mo_pre_graduation"):
        r = report[key]
        print(f"[{key}] AUC LR {r['logistic_regression']['auc']['mean']} RF {r['random_forest']['auc']['mean']}"
              f" | bal.acc LR {r['logistic_regression']['balanced_accuracy']['mean']}"
              f" | Brier LR {r['logistic_regression']['brier']['mean']} vs baseline {r['majority_baseline']['brier']['mean']}")

    report["temporal_holdout_employment_now"] = temporal_holdout(survey, pop, "employment_status")
    report["temporal_holdout_within_12mo"] = temporal_holdout(survey, pop, "employed_within_12mo")
    th = report["temporal_holdout_employment_now"]
    print(f"[temporal holdout 2019-22 -> 2023-24] AUC LR {th['logistic_regression']['auc']}"
          f" predicted {th['logistic_regression']['predicted_rate']} vs survey {th['test_observed_rate']}"
          f" vs true {th['test_true_population_rate']}")

    dt = survey.dropna(subset=["time_to_hire_months"])
    report["time_to_hire_regression"] = eval_regression(dt[PRE_GRAD_FEATURES], dt["time_to_hire_months"], repeats)
    report["time_to_hire_regression"]["n"] = int(len(dt))
    d3 = survey.dropna(subset=["tth_3class"])
    report["time_to_hire_3class"] = eval_multiclass(d3[PRE_GRAD_FEATURES], d3["tth_3class"].astype(int), repeats, top_k=1)
    report["time_to_hire_3class"]["n"] = int(len(d3))
    tr = report["time_to_hire_regression"]
    print(f"[time-to-hire regression n={tr['n']}] MAE RF {tr['random_forest']['mae_months']['mean']}"
          f" vs median {tr['median_baseline']['mae_months']['mean']} | R2 RF {tr['random_forest']['r2']['mean']}")
    t3 = report["time_to_hire_3class"]
    print(f"[time-to-hire 3-class n={t3['n']}] bal.acc LR {t3['logistic_regression']['balanced_accuracy']['mean']}"
          f" vs baseline {t3['majority_baseline']['balanced_accuracy']['mean']}")

    dj = survey.dropna(subset=["job_title"])
    report["job_title"] = eval_multiclass(dj[PRE_GRAD_FEATURES], dj["job_title"], repeats, top_k=3)
    report["job_title"]["n"] = int(len(dj))
    report["job_title"]["n_classes"] = int(dj["job_title"].nunique())
    report["it_related_job"] = eval_binary(dj[PRE_GRAD_FEATURES], dj["it_related_job"].astype(int), repeats)
    jt = report["job_title"]
    print(f"[job title n={jt['n']}, {jt['n_classes']} titles] top-1 LR {jt['logistic_regression']['accuracy']['mean']}"
          f" vs 'always most common' {jt['majority_baseline']['accuracy']['mean']}"
          f" | top-3 LR {jt['logistic_regression']['top3_accuracy']['mean']}"
          f" | IT-related AUC {report['it_related_job']['logistic_regression']['auc']['mean']}")

    report["ceiling_auc_unlimited_clean_data"] = ceiling(rng, sc)
    print(f"[ceiling, n={report['ceiling_auc_unlimited_clean_data']['n']} clean rows] AUC now"
          f" {report['ceiling_auc_unlimited_clean_data']['employment_status']}"
          f" | within 12 mo {report['ceiling_auc_unlimited_clean_data']['employed_within_12mo']}")

    report["learning_curve_lr_auc"] = learning_curve(rng, sc, [80, 170, 500, 1500], worlds)
    for n, v in report["learning_curve_lr_auc"].items():
        e = v.get("employment_status", {})
        print(f"[learning curve n={n}] AUC now mean {e.get('mean')} (5-95%: {e.get('p05')}-{e.get('p95')})")

    report["batch_rate_forecast_backtest"] = forecast_backtest(rng, sc, worlds * 5)
    fb = report["batch_rate_forecast_backtest"]
    print(f"[batch forecast backtest] mean abs error (pct pts): {fb['mean_abs_error_pct_points']}"
          f" | trend 80% PI width ~{fb['linear_trend_80pct_interval_width_pct_points']['mean']} pts")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"realistic_stress_test_{args.scenario}_{args.signal}.json"
    with out.open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
