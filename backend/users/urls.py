from django.urls import path

from .api import (
    AdminLoginView,
    AlumniAccountStatusView,
    AlumniRequestApproveView,
    AlumniRequestRejectView,
    AlumniLoginView,
    AlumniRegisterView,
    EmployerRequestApproveView,
    EmployerRequestRejectView,
    EmployerLoginView,
    EmployerRegisterView,
    EmployerRequestsListView,
    PendingAlumniListView,
    VerifiedAlumniListView,
)

urlpatterns = [
    path("auth/admin/login/", AdminLoginView.as_view(), name="admin-login"),
    path("auth/alumni/register/", AlumniRegisterView.as_view(), name="alumni-register"),
    path("auth/alumni/login/", AlumniLoginView.as_view(), name="alumni-login"),
    path("auth/alumni/account/<uuid:alumni_id>/", AlumniAccountStatusView.as_view(), name="alumni-account-status"),
    path("auth/employer/register/", EmployerRegisterView.as_view(), name="employer-register"),
    path("auth/employer/login/", EmployerLoginView.as_view(), name="employer-login"),
    path("admin/alumni/pending/", PendingAlumniListView.as_view(), name="admin-pending-alumni"),
    path("admin/alumni/verified/", VerifiedAlumniListView.as_view(), name="admin-verified-alumni"),
    path(
        "admin/alumni/requests/<uuid:alumni_id>/approve/",
        AlumniRequestApproveView.as_view(),
        name="admin-alumni-request-approve",
    ),
    path(
        "admin/alumni/requests/<uuid:alumni_id>/reject/",
        AlumniRequestRejectView.as_view(),
        name="admin-alumni-request-reject",
    ),
    path("admin/employers/requests/", EmployerRequestsListView.as_view(), name="admin-employer-requests"),
    path(
        "admin/employers/requests/<uuid:employer_id>/approve/",
        EmployerRequestApproveView.as_view(),
        name="admin-employer-request-approve",
    ),
    path(
        "admin/employers/requests/<uuid:employer_id>/reject/",
        EmployerRequestRejectView.as_view(),
        name="admin-employer-request-reject",
    ),
]
