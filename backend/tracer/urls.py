from django.urls import path

from .api import (
    AdminAnalyticsPredictionsView,
    ComprehensiveSurveySubmissionView,
    EmployerVerifiableGraduateListView,
    IndustryDetailView,
    IndustryListView,
    JobTitleDetailView,
    JobTitleListView,
    ReferenceDataView,
    RegionDetailView,
    RegionListView,
    SkillCategoryDetailView,
    SkillCategoryListView,
    SkillDetailView,
    SkillListView,
    SurveyDataRetrievalView,
    TrainingDataExportView,
    VerificationTokenDecisionView,
    VerificationTokenDetailView,
    VerificationTokenIssueView,
)
from .reports_api import (
    AcademicEmploymentReportView,
    BatchSummaryReportView,
    DataQualityReportView,
    EmploymentOutcomesReportView,
    GeographicDistributionReportView,
    PredictiveTrendReportView,
    SkillsInventoryReportView,
)

urlpatterns = [
    # All reference data in one shot
    path("reference/", ReferenceDataView.as_view(), name="reference-data"),

    # Skills
    path("reference/skills/", SkillListView.as_view(), name="skill-list"),
    path("reference/skills/<uuid:pk>/", SkillDetailView.as_view(), name="skill-detail"),

    # Skill categories
    path("reference/skill-categories/", SkillCategoryListView.as_view(), name="skill-category-list"),
    path("reference/skill-categories/<uuid:pk>/", SkillCategoryDetailView.as_view(), name="skill-category-detail"),

    # Industries
    path("reference/industries/", IndustryListView.as_view(), name="industry-list"),
    path("reference/industries/<uuid:pk>/", IndustryDetailView.as_view(), name="industry-detail"),

    # Job titles
    path("reference/job-titles/", JobTitleListView.as_view(), name="job-title-list"),
    path("reference/job-titles/<uuid:pk>/", JobTitleDetailView.as_view(), name="job-title-detail"),

    # Regions
    path("reference/regions/", RegionListView.as_view(), name="region-list"),
    path("reference/regions/<uuid:pk>/", RegionDetailView.as_view(), name="region-detail"),

    # Employer verification tokens / decisions (DS7)
    path("verification/tokens/issue/", VerificationTokenIssueView.as_view(), name="verification-token-issue"),
    path(
        "verification/employer/graduates/",
        EmployerVerifiableGraduateListView.as_view(),
        name="verification-employer-graduates",
    ),
    path("verification/tokens/<uuid:token_id>/", VerificationTokenDetailView.as_view(), name="verification-token-detail"),
    path(
        "verification/tokens/<uuid:token_id>/decision/",
        VerificationTokenDecisionView.as_view(),
        name="verification-token-decision",
    ),

    # Survey submission and data retrieval (Phase 3)
    path("survey/submit/", ComprehensiveSurveySubmissionView.as_view(), name="survey-submit"),
    path("survey/", SurveyDataRetrievalView.as_view(), name="survey-retrieve"),

    # Admin analytics endpoints (Phase 3)
    path("admin/analytics/employability-predictions/", AdminAnalyticsPredictionsView.as_view(), name="admin-predictions"),
    path("admin/analytics/export-training-data/", TrainingDataExportView.as_view(), name="admin-export-training"),

    # Admin report-data endpoints (powering admin-reports.tsx)
    path("admin/reports/batch-summary/", BatchSummaryReportView.as_view(), name="admin-report-batch-summary"),
    path("admin/reports/employment-outcomes/", EmploymentOutcomesReportView.as_view(), name="admin-report-employment-outcomes"),
    path("admin/reports/skills-inventory/", SkillsInventoryReportView.as_view(), name="admin-report-skills-inventory"),
    path("admin/reports/geographic-distribution/", GeographicDistributionReportView.as_view(), name="admin-report-geographic"),
    path("admin/reports/academic-employment/", AcademicEmploymentReportView.as_view(), name="admin-report-academic-employment"),
    path("admin/reports/data-quality/", DataQualityReportView.as_view(), name="admin-report-data-quality"),
    path("admin/reports/predictive-trend/", PredictiveTrendReportView.as_view(), name="admin-report-predictive-trend"),
]