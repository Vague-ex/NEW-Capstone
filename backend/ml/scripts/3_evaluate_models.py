"""
Stage 3: Evaluate Trained Models

Loads joblib artifacts + processed CSV and produces:
    - evaluation_report.json with per-target metrics
    - residual plot for time_to_hire
    - confusion matrices for the three classifiers
    - coefficient tables for any linear/logistic winners
"""

from __future__ import annotations

import json
from pathlib import Path

import joblib
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    precision_score,
    r2_score,
    recall_score,
)

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "processed_training_data.csv"
MODELS_DIR = ROOT / "models"
REPORTS_DIR = MODELS_DIR / "reports"
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

TARGETS = {
    "time_to_hire": {"col": "time_to_hire_months", "task": "regression", "requires_employed": True},
    "employment_status": {"col": "employment_status", "task": "classification", "requires_employed": False},
    "bsis_related_first_job": {"col": "bsis_related_job_first", "task": "classification", "requires_employed": True},
    "bsis_related_current_job": {"col": "bsis_related_job_current", "task": "classification", "requires_employed": True},
}

NON_FEATURE = {"alumni_id", "batch", "time_to_hire_months", "employment_status",
               "bsis_related_job_first", "bsis_related_job_current"}


def plot_residuals(y_true, y_pred, path: Path) -> None:
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.scatter(y_pred, y_true - y_pred, alpha=0.5, s=14)
    ax.axhline(0, color="red", linewidth=1)
    ax.set_xlabel("Predicted time-to-hire (months)")
    ax.set_ylabel("Residual")
    ax.set_title("Residuals — time_to_hire")
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)


def plot_confusion(cm: np.ndarray, title: str, path: Path) -> None:
    fig, ax = plt.subplots(figsize=(3.5, 3.2))
    im = ax.imshow(cm, cmap="Blues")
    ax.set_xticks([0, 1]); ax.set_yticks([0, 1])
    ax.set_xticklabels(["0", "1"]); ax.set_yticklabels(["0", "1"])
    ax.set_xlabel("Predicted"); ax.set_ylabel("True")
    ax.set_title(title)
    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            ax.text(j, i, int(cm[i, j]), ha="center", va="center",
                    color="white" if cm[i, j] > cm.max() / 2 else "black")
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)


def top_coefficients(model, features: list[str], n: int = 10) -> list[dict]:
    if hasattr(model, "coef_"):
        coef = np.ravel(model.coef_)
        order = np.argsort(-np.abs(coef))[:n]
        return [{"feature": features[i], "coef": float(coef[i])} for i in order]
    if hasattr(model, "feature_importances_"):
        imp = model.feature_importances_
        order = np.argsort(-imp)[:n]
        return [{"feature": features[i], "importance": float(imp[i])} for i in order]
    return []


def main() -> None:
    df = pd.read_csv(DATA_PATH)
    features = [c for c in df.columns if c not in NON_FEATURE]
    scaler = joblib.load(MODELS_DIR / "feature_scaler.joblib")
    models = joblib.load(MODELS_DIR / "employability_model.joblib")

    report: dict = {"targets": {}}

    for name, spec in TARGETS.items():
        subset = df.dropna(subset=[spec["col"]]) if spec["requires_employed"] else df
        X = scaler.transform(subset[features])
        y = subset[spec["col"]].to_numpy()
        model = models[name]
        preds = model.predict(X)

        entry: dict = {"n_samples": int(len(y)), "model": type(model).__name__}

        if spec["task"] == "regression":
            entry["r2"] = float(r2_score(y, preds))
            entry["mae"] = float(mean_absolute_error(y, preds))
            entry["residual_summary"] = {
                "mean": float(np.mean(y - preds)),
                "std": float(np.std(y - preds)),
                "min": float(np.min(y - preds)),
                "max": float(np.max(y - preds)),
            }
            plot_residuals(y, preds, REPORTS_DIR / f"{name}_residuals.png")
            print(f"[{name}] R2={entry['r2']:.3f}  MAE={entry['mae']:.3f}")
        else:
            y = y.astype(int); preds = preds.astype(int)
            entry["accuracy"] = float(accuracy_score(y, preds))
            entry["precision"] = float(precision_score(y, preds, zero_division=0))
            entry["recall"] = float(recall_score(y, preds, zero_division=0))
            entry["f1"] = float(f1_score(y, preds, zero_division=0))
            cm = confusion_matrix(y, preds, labels=[0, 1])
            entry["confusion_matrix"] = cm.tolist()
            plot_confusion(cm, f"Confusion — {name}", REPORTS_DIR / f"{name}_cm.png")
            print(f"[{name}] acc={entry['accuracy']:.3f}  prec={entry['precision']:.3f}  "
                  f"rec={entry['recall']:.3f}  f1={entry['f1']:.3f}")

        entry["top_features"] = top_coefficients(model, features)
        report["targets"][name] = entry

    out = MODELS_DIR / "evaluation_report.json"
    with out.open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(f"\nWrote {out}")
    print(f"Plots in {REPORTS_DIR}")


if __name__ == "__main__":
    main()
