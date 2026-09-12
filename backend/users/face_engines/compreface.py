"""
CompreFace engine — embeddings from a separate REST service.

LOCAL COMPARISON ONLY. CompreFace runs four containers (a Java admin service, a
Java API, a Python core carrying the models, and its own Postgres) and its docs
ask for around 8 GB. The production VPS is 1 vCPU / 4 GB and already runs
Django, Next.js and Caddy, so this engine exists to be measured against
InsightFace on a development machine, not to be deployed.

Bring it up locally with the project's own compose file, then:

    FACE_ENGINE=compreface
    COMPREFACE_URL=http://localhost:8000
    COMPREFACE_RECOGNITION_KEY=<the key from the CompreFace admin UI>

This talks to the /embeddings endpoint rather than CompreFace's own subject
database. Keeping the vectors in our Postgres, next to every other engine's,
is what makes a like-for-like comparison possible -- and avoids a second store
of biometric data that would have to be separately secured and deleted.
"""

from __future__ import annotations

import os

from .base import UNCOMPARABLE_DISTANCE, FaceEngine

try:  # pragma: no cover - optional dependency guard
    import numpy as np
except Exception:  # pragma: no cover
    np = None


class ComprefaceEngine(FaceEngine):
    name = "compreface"
    dimensions = 512
    requires_client_descriptor = False

    def __init__(self) -> None:
        self.distance_threshold = float(
            os.getenv("COMPREFACE_DISTANCE_THRESHOLD", "0.40")
        )
        self.base_url = os.getenv("COMPREFACE_URL", "http://localhost:8000").rstrip("/")
        self.api_key = os.getenv("COMPREFACE_RECOGNITION_KEY", "")
        self.timeout = float(os.getenv("COMPREFACE_TIMEOUT_SECONDS", "20"))

    def embed(
        self,
        *,
        image_bytes: bytes | None = None,
        client_descriptor: list[float] | None = None,
    ) -> list[float] | None:
        # As with InsightFace, a browser-produced face-api vector is not a
        # CompreFace embedding and must not be accepted in place of one.
        if not image_bytes:
            return None
        if not self.api_key:
            raise RuntimeError(
                "FACE_ENGINE=compreface requires COMPREFACE_RECOGNITION_KEY."
            )

        import requests

        response = requests.post(
            f"{self.base_url}/api/v1/recognition/embeddings",
            headers={"x-api-key": self.api_key},
            files={"file": ("face.jpg", image_bytes, "image/jpeg")},
            timeout=self.timeout,
        )
        response.raise_for_status()
        payload = response.json()

        results = payload.get("result") or []
        if not results:
            return None
        # Largest face, matching the InsightFace engine's rule so the two are
        # comparing like with like when a bystander is in frame.
        def area(entry):
            box = entry.get("box") or {}
            width = float(box.get("x_max", 0)) - float(box.get("x_min", 0))
            height = float(box.get("y_max", 0)) - float(box.get("y_min", 0))
            return width * height

        best = max(results, key=area)
        embedding = best.get("embedding")
        if not embedding:
            return None
        vector = [float(v) for v in embedding]
        return vector if len(vector) == self.dimensions else None

    def distance(self, a: list[float], b: list[float]) -> float:
        """Cosine distance, same convention as the InsightFace engine."""
        if np is None:
            return UNCOMPARABLE_DISTANCE
        left = np.asarray(a, dtype=np.float32)
        right = np.asarray(b, dtype=np.float32)
        if left.shape != right.shape or left.size != self.dimensions:
            return UNCOMPARABLE_DISTANCE
        ln = float(np.linalg.norm(left))
        rn = float(np.linalg.norm(right))
        if ln == 0 or rn == 0:
            return UNCOMPARABLE_DISTANCE
        return float(1.0 - (np.dot(left, right) / (ln * rn)))

    def similarity(self, distance: float) -> float:
        return max(0.0, min(1.0, 1.0 - distance))

    def average(self, descriptors: list[list[float]]) -> list[float] | None:
        mean = super().average(descriptors)
        if mean is None or np is None:
            return mean
        vector = np.asarray(mean, dtype=np.float32)
        norm = float(np.linalg.norm(vector))
        if norm == 0:
            return None
        return [float(v) for v in vector / norm]
