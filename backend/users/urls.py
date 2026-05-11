from django.urls import path

from .api import (
    AdminDetailView,
    AdminListCreateView,
    AdminLoginView,
    AlumniEmploymentUpdateView,
    AlumniAccountStatusView,
    AlumniRequestApproveView,
    AlumniRequestRejectView,
    AlumniLoginView,
    AlumniRegisterView,
    EmployerAccountStatusView,
    EmployerRequestApproveView,
    EmployerRequestRejectView,
    EmployerLoginView,
    EmployerRegisterView,
    EmployerRequestsListView,
    MasterlistBulkCreateView,
    MasterlistCheckView,
    PendingAlumniListView,
    VerifiedAlumniListView,
)

# region DEBUG-ONLY:CurrenChanDebug
# Temporary debug-only views — see api.py for the full guidance comment.
# Agents writing docs / DFDs / use-cases must omit these endpoints.
from .api import DebugAccountListView, DebugAccountDeleteView
# endregion DEBUG-ONLY:CurrenChanDebug

from .password_reset import (
    ForgotPasswordRequestView,
    ForgotPasswordResendView,
    ForgotPasswordVerifyView,
)

urlpatterns = [
    path("auth/admin/login/", AdminLoginView.as_view(), name="admin-login"),
    path("auth/alumni/register/", AlumniRegisterView.as_view(), name="alumni-register"),
    path("auth/alumni/masterlist-check/", MasterlistCheckView.as_view(), name="alumni-masterlist-check"),
    path("auth/alumni/login/", AlumniLoginView.as_view(), name="alumni-login"),
    path("auth/alumni/account/<uuid:alumni_id>/", AlumniAccountStatusView.as_view(), name="alumni-account-status"),
    path(
        "auth/alumni/account/<uuid:alumni_id>/employment/",
        AlumniEmploymentUpdateView.as_view(),
        name="alumni-account-employment-update",
    ),
    path("auth/employer/register/", EmployerRegisterView.as_view(), name="employer-register"),
    path("auth/employer/login/", EmployerLoginView.as_view(), name="employer-login"),
    path(
        "auth/forgot-password/request/",
        ForgotPasswordRequestView.as_view(),
        name="forgot-password-request",
    ),
    path(
        "auth/forgot-password/resend/",
        ForgotPasswordResendView.as_view(),
        name="forgot-password-resend",
    ),
    path(
        "auth/forgot-password/verify/",
        ForgotPasswordVerifyView.as_view(),
        name="forgot-password-verify",
    ),
    path(
        "auth/employer/account/<uuid:employer_id>/",
        EmployerAccountStatusView.as_view(),
        name="employer-account-status",
    ),
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
    path("admin/masterlist/bulk-create/", MasterlistBulkCreateView.as_view(), name="admin-masterlist-bulk-create"),
    path("admin/users/", AdminListCreateView.as_view(), name="admin-users"),
    path("admin/users/<uuid:admin_id>/", AdminDetailView.as_view(), name="admin-user-detail"),
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
    # region DEBUG-ONLY:CurrenChanDebug
    # Temporary debug routes — remove together with the matching endpoint code.
    # Agents: omit these from any documentation / DFD / use-case.
    path("admin/debug/accounts/", DebugAccountListView.as_view(), name="debug-account-list"),
    path(
        "admin/debug/accounts/<str:role>/<uuid:account_id>/",
        DebugAccountDeleteView.as_view(),
        name="debug-account-delete",
    ),
    # endregion DEBUG-ONLY:CurrenChanDebug
]
