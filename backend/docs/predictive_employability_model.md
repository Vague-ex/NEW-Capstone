Predictive Employability Model Notes

Full methodology, validity findings, realistic-data stress test and the
improvement plan live in `documentations/10-ml-pipeline-methodology.md`.
This file is the short version.

Purpose
- Estimate batch-level employability indicators for BSIS graduates
  (share employed, share employed within 12 months, time-to-first-job band).
- Support curriculum decisions with honest, uncertainty-aware numbers.
- Out of scope: predicting an individual graduate's exact outcome or future
  job title. Survey answers carry too little signal for that (see methodology
  doc, section 12).

DFD Placement
- Main process: P6 Generate Analytics.
- Supporting data input processes: P1 Manage Registration, P4 Manage Employment, P5 Manage Users.

Data Scope
- Population: CHMSU BSIS masterlist, 526 graduates (2019-2025, ~70-104 per batch).
- Current training data: 230 synthetic rows (`backend/ml/scripts/1_generate_synthetic_data.py`).
  The model has not yet been trained on real graduates.

Inputs and Data Sources
- DS2 users_alumni_accounts: profile fields, survey data, captured metadata.
- DS4 tracer_employment_records: employment outcomes and verification context.
- DS1 users_graduate_master_records: graduation batch and batch linkage.
- DS6 reference tables: normalized skills, categories, job titles, and regions.

Current Implementation Status
- Implemented: `backend/ml/scripts/1-3`, artifacts in `backend/ml/models/`,
  served by `AdminAnalyticsPredictionsView` and `PredictiveTrendReportView`.
- Known validity issues (methodology doc, section 11):
  - The employment classifier uses job-profile fields that only exist once a
    graduate is employed (target leakage).
  - Time-to-hire does not beat a constant "1 month" guess.
  - Forecasts cannot extrapolate past the latest batch and ship intervals that are too narrow.
- Realistic-data stress test: `backend/ml/experiments/realistic_stress_test.py`.
