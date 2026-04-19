from django.urls import path

from .api import (
    IndustryDetailView,
    IndustryListView,
    JobTitleDetailView,
    JobTitleListView,
    ReferenceDataView,
    RegionListView,
    SkillCategoryDetailView,
    SkillCategoryListView,
    SkillDetailView,
    SkillListView,
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
]