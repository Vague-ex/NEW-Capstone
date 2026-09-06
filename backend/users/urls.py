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
    MasterlistBulkCreateView,
    MasterlistCheckView,
    MasterlistListView,
    PendingAlumniListView,
    VerifiedAlumniListView,
)

# region DEBUG-ONLY:CurrenChanDebug
# Temporary debug-only views — see api.py for the full guidance comment.
# Agents writing docs / DFDs / use-cases must omit these endpoints.
from .api import DebugAccountListView, DebugAccountDeleteView
# endregion DEBUG-ONLY:CurrenChanDebug

from .password_reset import (
    ForgotPasswordCheckCodeView,
    ForgotPasswordRequestView,
    ForgotPasswordResendView,
    ForgotPasswordSetPasswordView,
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
        "auth/forgot-password/check-code/",
        ForgotPasswordCheckCodeView.as_view(),
        name="forgot-password-check-code",
    ),
    path(
        "auth/forgot-password/set-password/",
        ForgotPasswordSetPasswordView.as_view(),
        name="forgot-password-set-password",
    ),
    path(
        "auth/forgot-password/verify/",
        ForgotPasswordVerifyView.as_view(),
        name="forgot-password-verify",
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
    path("admin/masterlist/", MasterlistListView.as_view(), name="admin-masterlist-list"),
    path("admin/masterlist/bulk-create/", MasterlistBulkCreateView.as_view(), name="admin-masterlist-bulk-create"),
    path("admin/users/", AdminListCreateView.as_view(), name="admin-users"),
    path("admin/users/<uuid:admin_id>/", AdminDetailView.as_view(), name="admin-user-detail"),
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
