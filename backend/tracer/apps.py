import logging
import os
import sys
import threading

from django.apps import AppConfig


class TracerConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'tracer'

    def ready(self):
        """Warm the ML artifact cache once at server startup.

        Loading the joblib model + scaler + training CSV is the slow part of
        the first analytics request. Doing it here (in a daemon thread so it
        never blocks startup) means the first admin who opens the dashboard
        isn't the one who pays for it. Skipped for management commands that
        don't serve requests, and any failure is swallowed — the request-time
        loader still works as a fallback.
        """
        skip_cmds = {
            "migrate", "makemigrations", "collectstatic", "shell",
            "test", "loaddata", "dumpdata", "createsuperuser", "check",
        }
        if any(cmd in sys.argv for cmd in skip_cmds):
            return
        # Under runserver autoreload only the child (RUN_MAIN=true) serves;
        # avoid warming twice in the reloader parent.
        if "runserver" in sys.argv and os.environ.get("RUN_MAIN") != "true":
            return

        def _warm():
            try:
                from tracer.api import _load_ml_artifacts
                _load_ml_artifacts()
            except Exception:  # noqa: BLE001
                logging.getLogger(__name__).warning(
                    "ML artifact warm-load skipped", exc_info=True
                )

        threading.Thread(target=_warm, daemon=True).start()
