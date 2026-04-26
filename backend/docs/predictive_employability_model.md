Predictive Employability Model Notes

Purpose
- Predict time-to-hire and employability trends for a target batch (for example Batch 2025).
- Convert model outputs into admin-friendly timeline buckets.

DFD Placement
- Main process: P6 Generate Analytics.
- Supporting data input processes: P1 Manage Registration, P4 Manage Employment, P5 Manage Users.

Planned Data Scope
- Historical population: about 500 alumni profiles (for example 487 from Batches 2020-2024).
- Prediction target: selected upcoming batch (for example Batch 2025).

Inputs and Data Sources
- DS2 users_alumni_accounts: profile fields, survey data, captured metadata.
- DS4 tracer_employment_records: employment outcomes and verification context.
- DS1 users_graduate_master_records: graduation batch and batch linkage.
- DS6 reference tables: normalized skills, categories, job titles, and regions.

Predictor Variables

| Predictor Variable | Data Type | Collection Method | Why It Helps |
| --- | --- | --- | --- |
| Skill Count Technical | Continuous | Count of technical skills in profile | More technical skills often reduce hiring time |
| Skill Count Soft Skills | Continuous | Count of soft skills in profile | Soft skills correlate with interview success |
| Has High Demand Skill | Binary (0/1) | Skill-level indicator (for example SQL) | High-demand skills increase employability |
| Graduation Year Batch | Categorical | Graduation year | Market conditions vary by batch |
| Scholarship Status | Binary (0/1) | Scholarship yes/no | Proxy for academic support and performance |
| Certification Count | Continuous | Count of credentials (PRC/TESDA/Civil Service/etc.) | Certifications signal job readiness |
| Gender | Categorical | Profile field | Used for trend segmentation and monitoring |
| Internship Relevance Score | Ordinal (1-5) | Survey question | Related internship usually improves job fit |

Target Variables

| Target Variable | Type | Method | Example Output |
| --- | --- | --- | --- |
| Time-to-Hire (Months) | Continuous | Multiple Linear Regression | Predicted 2.3 months |
| Employment Status | Binary (0/1) | Logistic Regression | Probability of Employment 87% |
| Job-Skill Match Score | Continuous | Linear Regression | Alignment Score 78% |

Planned Modeling Flow
1. Collect verified historical alumni records.
2. Build feature matrix from predictors.
3. Train linear regression for time-to-hire.
4. Train logistic regression for employment probability.
5. Predict outcomes for target batch.
6. Aggregate results into timeline buckets.
7. Display projection on admin analytics dashboard.

Expected Output Format (Example)
- Within 1 month: 68% (332 graduates)
- 1-3 months: 24% (117 graduates)
- 3-6 months: 6% (29 graduates)
- 6+ months: 2% (10 graduates)
- Average Time-to-Hire: 2.1 months

Interpretation Example
- Graduate A: 5 technical skills, 2 certifications -> faster expected hire.
- Graduate B: 2 technical skills, 0 certifications -> slower expected hire.
- Example relationship learned by model:
  - +1 technical skill -> about 0.8 month lower predicted time-to-hire.
  - +1 certification -> about 1.2 months lower predicted time-to-hire.

Current Implementation Status
- This model is planned design documentation.
- Backend training/inference endpoints are not yet implemented.
- Current analytics UI uses static/mock projected values.
