"""
Stage 2: Train Multiple Regression/Classification Models

Two targets:
    Y1 time_to_hire_months       - Regression (continuous, months)
    Y2 employment_status          - Binary classification (1 employed)

For each target we fit multiple candidate models and pick the best by 5-fold CV.
Everything (best models, scaler, metadata) is persisted via joblib so the Django
API can load them at request time.

Note: BSIS-alignment (first/current) used to be predicted targets but were dropped
in the Phase 2 analytics rework — they're now displayed as observed values only.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier, RandomForestRegressor
from sklearn.linear_model import LinearRegression, LogisticRegression, Ridge
from sklearn.metrics import accuracy_score, f1_score, mean_absolute_error, precision_score, r2_score, recall_score
from sklearn.model_selection import KFold, cross_val_score
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "processed_training_data.csv"
MODELS_DIR = ROOT / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)

RANDOM_STATE = 42

TARGETS = {
    "time_to_hire": {
        "col": "time_to_hire_months",
        "task": "regression",
        "requires_employed": True,
        "candidates": {
            "linear_regression": LinearRegression(),
            "ridge": Ridge(alpha=1.0, random_state=RANDOM_STATE),
            "random_forest": RandomForestRegressor(n_estimators=200, max_depth=6, random_state=RANDOM_STATE),
        },
        "scoring": "r2",
    },
    "employment_status": {
        "col": "employment_status",
        "task": "classification",
        "requires_employed": False,
        "candidates": {
            "logistic_regression": LogisticRegression(max_iter=2000, random_state=RANDOM_STATE),
            "random_forest": RandomForestClassifier(n_estimators=200, max_depth=6, random_state=RANDOM_STATE),
            "gradient_boosting": GradientBoostingClassifier(n_estimators=200, max_depth=3, random_state=RANDOM_STATE),
        },
        "scoring": "f1",
    },
}

NON_FEATURE_COLS = {
    "alumni_id", "batch",
    "time_to_hire_months", "employment_status",
    "bsis_related_job_first", "bsis_related_job_current",
}


def load_data() -> tuple[pd.DataFrame, list[str]]:
    df = pd.read_csv(DATA_PATH)
    feature_cols = [c for c in df.columns if c not in NON_FEATURE_COLS]
    return df, feature_cols


def cv_score(model, X, y, scoring: str) -> tuple[float, float]:
    cv = KFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    scores = cross_val_score(model, X, y, cv=cv, scoring=scoring)
    return float(scores.mean()), float(scores.std())


def train_target(name: str, spec: dict, df: pd.DataFrame, features: list[str], scaler: StandardScaler):
    # Drop rows with NaN target (e.g. time-to-hire for unemployed)
    subset = df.dropna(subset=[spec["col"]]) if spec["requires_employed"] else df
    X = scaler.transform(subset[features])
    y = subset[spec["col"]].to_numpy()
    if spec["task"] == "classification":
        y = y.astype(int)

    results: dict[str, dict] = {}
    best_name = None
    best_mean = -np.inf
    best_model = None

    for model_name, estimator in spec["candidates"].items():
        mean, std = cv_score(estimator, X, y, spec["scoring"])
        estimator.fit(X, y)
        preds = estimator.predict(X)

        model_info: dict = {
            "cv_mean": mean,
            "cv_std": std,
            "scoring": spec["scoring"],
            "n_samples": int(len(y)),
        }
        if spec["task"] == "regression":
            model_info["train_r2"] = float(r2_score(y, preds))
            model_info["train_mae"] = float(mean_absolute_error(y, preds))
        else:
            model_info["train_accuracy"] = float(accuracy_score(y, preds))
            model_info["train_precision"] = float(precision_score(y, preds, zero_division=0))
            model_info["train_recall"] = float(recall_score(y, preds, zero_division=0))
            model_info["train_f1"] = float(f1_score(y, preds, zero_division=0))

        results[model_name] = model_info

        if mean > best_mean:
            best_mean = mean
            best_name = model_name
            best_model = estimator

    return best_name, best_model, results


def main() -> None:
    df, features = load_data()

    scaler = StandardScaler()
    scaler.fit(df[features])

    best_models: dict[str, object] = {}
    metadata: dict = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "n_samples": int(len(df)),
        "n_features": len(features),
        "features": features,
        "random_state": RANDOM_STATE,
        "targets": {},
    }

    for target_key, spec in TARGETS.items():
        best_name, best_model, results = train_target(target_key, spec, df, features, scaler)
        best_models[target_key] = best_model
        metadata["targets"][target_key] = {
            "task": spec["task"],
            "target_column": spec["col"],
            "best_model": best_name,
            "candidates": results,
        }
        mean = results[best_name]["cv_mean"]
        std = results[best_name]["cv_std"]
        print(f"[{target_key:26s}] best={best_name:20s} cv {spec['scoring']}={mean:+.3f} ± {std:.3f}")

    joblib.dump(best_models, MODELS_DIR / "employability_model.joblib")
    joblib.dump(scaler, MODELS_DIR / "feature_scaler.joblib")
    with (MODELS_DIR / "model_metadata.json").open("w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    print()
    print(f"Saved joblib: {MODELS_DIR / 'employability_model.joblib'}")
    print(f"Saved joblib: {MODELS_DIR / 'feature_scaler.joblib'}")
    print(f"Saved meta:   {MODELS_DIR / 'model_metadata.json'}")


if __name__ == "__main__":
    main()
