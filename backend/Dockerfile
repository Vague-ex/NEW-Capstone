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

# ── Optional: server-side face recognition (FACE_ENGINE=insightface) ─────────
# Off by default, so an image that does not use it stays lean:
#
#   docker compose build --build-arg INSTALL_INSIGHTFACE=true backend
#
# Two pip calls on purpose. insightface declares opencv-python as a dependency
# while this project uses opencv-python-HEADLESS; both install a module named
# cv2, so a single resolve would silently swap the headless build for one that
# needs GUI libraries this slim image does not have.
ARG INSTALL_INSIGHTFACE=false
COPY requirements-insightface.txt .
RUN if [ "$INSTALL_INSIGHTFACE" = "true" ]; then \
      pip install --no-cache-dir --only-binary=:all: --no-deps insightface==2.0 && \
      pip install --no-cache-dir --only-binary=:all: \
        onnx onnxruntime scikit-image tqdm requests scipy ; \
    fi

# Bake the model pack in rather than letting it download at runtime, then drop
# the models the engine never loads.
#
# The container home directory is ephemeral, so a runtime download repeats on
# every redeploy -- which looks exactly like a hang, and fails outright if
# GitHub is unreachable from the VPS. And a pack ships landmark and gender/age
# models alongside the detector and recogniser; under
# allowed_modules=['detection','recognition'] those are never opened, so they
# are pure image weight. In buffalo_s that is 143MB of 158MB.
#
# Saves DISK, not memory: an unloaded ONNX file creates no session and costs
# nothing at runtime.
ENV INSIGHTFACE_ROOT=/opt/insightface
ARG INSIGHTFACE_MODEL_PACK=buffalo_s
ENV INSIGHTFACE_MODEL_PACK=${INSIGHTFACE_MODEL_PACK}
COPY scripts/prefetch_face_models.py ./scripts/
RUN if [ "$INSTALL_INSIGHTFACE" = "true" ]; then \
      mkdir -p "$INSIGHTFACE_ROOT" && \
      python scripts/prefetch_face_models.py ; \
    fi

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
 && chown -R appuser:appuser /app \
 && if [ -d /opt/insightface ]; then chown -R appuser:appuser /opt/insightface; fi
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/api/reference/ || exit 1

# Worker count is an env var because the right answer depends on the engine,
# not on the image.
#
# Default 2 suits the browser-side face-api engine, which costs the server
# nothing. With FACE_ENGINE=insightface each worker holds its own ONNX session,
# roughly 0.8-1.5 GB, and two of those on a 4 GB VPS already running Next.js and
# Caddy will be OOM-killed. Set GUNICORN_WORKERS=1 and GUNICORN_THREADS=4 there:
# the workload is I/O-bound on Supabase, so threads recover the concurrency a
# second process would have given.
#
# Do NOT add --preload with onnxruntime; forking after a session is initialised
# is a known source of hangs.
#
# Shell form so the vars expand, with exec so gunicorn still becomes PID 1 and
# receives SIGTERM directly.
ENV GUNICORN_WORKERS=2 \
    GUNICORN_THREADS=1
CMD exec gunicorn core.wsgi:application \
     --bind 0.0.0.0:8000 \
     --workers "$GUNICORN_WORKERS" \
     --threads "$GUNICORN_THREADS" \
     --timeout 120 \
     --access-logfile - \
     --error-logfile -
