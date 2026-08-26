# ── Django API ────────────────────────────────────────────────────────────────
# Python 3.11 to match the virtualenv the project was developed and tested on.
# slim (not alpine): scikit-learn, pandas, numpy and opencv ship manylinux
# wheels that do not exist for musl, so alpine would force a source build that
# takes tens of minutes and often fails.
FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# libpq5    -> psycopg2-binary runtime
# libglib2.0-0, libgl1 -> opencv-python-headless still links these
# curl      -> container healthcheck
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libpq5 libglib2.0-0 libgl1 curl \
 && rm -rf /var/lib/apt/lists/*

# Requirements first so dependency layers cache across code changes. These are
# heavy wheels — rebuilding them on every edit would make deploys painful.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Collect admin CSS/JS into STATIC_ROOT. Without this the Django admin renders
# as unstyled HTML behind gunicorn, which has no static file server of its own.
# Dummy env vars: collectstatic imports settings, which requires them, but it
# touches neither the database nor the mail server.
RUN SECRET_KEY=build-only \
    DEBUG=False \
    DJANGO_COLLECTSTATIC=1 \
    python manage.py collectstatic --noinput --clear

# Never run as root in a container.
RUN useradd --create-home --uid 10001 appuser \
 && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/api/reference/ || exit 1

# 2 workers matches the Procfile. Raise it on a larger VPS: a common starting
# point is (2 x CPU cores) + 1.
CMD ["gunicorn", "core.wsgi:application", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "2", \
     "--timeout", "120", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]
