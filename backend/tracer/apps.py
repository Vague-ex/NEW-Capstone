import logging
import os
import sys
import threading

from django.apps import AppConfig


class TracerConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'tracer'

    def ready(self):
        """Optionally warm the ML artifact cache at server startup.

        OFF by default. Loading scikit-learn + the model in every gunicorn
        worker at boot can exhaust memory on small hosts (e.g. Render's free
        tier), which kills the workers before they bind the port — the deploy
        then reports "No open HTTP ports detected." Set ``WARM_ML=1`` only on
        hosts with memory headroom. With it off, the model loads lazily on the
        first analytics request (the request-time loader is the fallback), so
        nothing breaks — the first such request is just a little slower.
        """
        # Opt-in gate. Default off so constrained hosts boot lean.
        if os.environ.get("WARM_ML", "").strip().lower() not in {"1", "true", "yes", "on"}:
            return

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
