"""
URL configuration for core project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path


def healthz(_request):
    """Container liveness. Deliberately touches nothing.

    The Docker healthcheck used to curl /api/reference/, which is 46KB of PSGC
    rows out of Supabase. Every 30s that is roughly 4GB a month of egress
    against a 5GB free tier -- and it would have been spent proving only that
    Supabase was up. It never actually ran: curl sends Host 127.0.0.1, which
    production's ALLOWED_HOSTS did not include, so it died in middleware with a
    400 before reaching any view. The container has therefore never once
    reported healthy.

    No database on purpose. This answers "should this container be restarted",
    and restarting gunicorn does not fix a Supabase outage.
    """
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path('healthz/', healthz, name='healthz'),
    path('admin/', admin.site.urls),
    path('api/', include('users.urls')),
    path('api/', include('tracer.urls')),
]
