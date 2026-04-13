from django.urls import path

from .api import AdminLoginView, AlumniLoginView, AlumniRegisterView

urlpatterns = [
    path("auth/admin/login/", AdminLoginView.as_view(), name="admin-login"),
    path("auth/alumni/register/", AlumniRegisterView.as_view(), name="alumni-register"),
    path("auth/alumni/login/", AlumniLoginView.as_view(), name="alumni-login"),
]
