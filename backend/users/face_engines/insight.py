"""
InsightFace engine — server-side ArcFace embeddings.

Not installed yet. The import is deliberately lazy so this module can be read,
type-checked and unit-tested without `insightface` or `onnxruntime` present;
selecting the engine without them raises a message that says what to install.

    pip install insightface onnxruntime

Why this is the engine that can actually ship, unlike CompreFace: it is a
library, not a service stack. One process, one ONNX session, no extra Postgres
and no JVM.

Two things differ fundamentally from face-api and will bite if forgotten:

  * 512 dimensions, not 128. Vectors are not interchangeable.
  * COSINE distance on L2-normalised embeddings, not euclidean. The numeric
    range is different, so face-api's 0.55 threshold is meaningless here.
    ArcFace convention is roughly:
        same person        0.0 - 0.35
        uncertain          0.35 - 0.45
        DIFFERENT people   0.45 - 1.0+
    0.40 is the usual operating point and the default below.

Detection is also a different model (SCRFD), which holds faces to far steeper
yaw than face-api's tinyFaceDetector — that is the main reason to switch.
"""

from __future__ import annotations

import os
import threading

from .base import UNCOMPARABLE_DISTANCE, FaceEngine

try:  # pragma: no cover - optional dependency guard
    import numpy as np
except Exception:  # pragma: no cover
    np = None


class InsightFaceEngine(FaceEngine):
    name = "insightface"
    dimensions = 512
    requires_client_descriptor = False

    # buffalo_s over buffalo_l on purpose. The VPS is 1 vCPU / 4 GB already
    # running Django, Next.js and Caddy; the size difference between the packs
    # is the difference between fitting and being OOM-killed.
    DEFAULT_MODEL_PACK = "buffalo_s"

    def __init__(self) -> None:
        self.distance_threshold = float(
            os.getenv("INSIGHTFACE_DISTANCE_THRESHOLD", "0.40")
        )
        self.model_pack = os.getenv("INSIGHTFACE_MODEL_PACK", self.DEFAULT_MODEL_PACK)
        self._app = None
        # The ONNX session is expensive to build and not safe to share across a
        # fork, so it is created on first use inside the worker rather than at
        # import time.
        self._lock = threading.Lock()

    def _get_app(self):
        if self._app is not None:
            return self._app
        with self._lock:
            if self._app is not None:
                return self._app
            try:
                from insightface.app import FaceAnalysis
            except ImportError as exc:  # pragma: no cover - depends on env
                raise RuntimeError(
                    "FACE_ENGINE=insightface requires the insightface package. "
                    "Install it with: pip install insightface onnxruntime"
                ) from exc

            app = FaceAnalysis(
                name=self.model_pack,
                # CPU only. The VPS has no GPU, and asking for CUDA providers
                # that do not exist makes onnxruntime noisy on every call.
                providers=["CPUExecutionProvider"],
                allowed_modules=["detection", "recognition"],
            )
            app.prepare(ctx_id=-1, det_size=(640, 640))
            self._app = app
            return app

    def embed(
        self,
        *,
        image_bytes: bytes | None = None,
        client_descriptor: list[float] | None = None,
    ) -> list[float] | None:
        # client_descriptor is ignored: a browser-produced face-api vector is
        # not an ArcFace vector, and silently accepting one would enrol a
        # 128-d template under a 512-d engine.
        if not image_bytes or np is None:
            return None

        try:
            import cv2
        except ImportError as exc:  # pragma: no cover - depends on env
            raise RuntimeError(
                "FACE_ENGINE=insightface requires opencv to decode images."
            ) from exc

        buffer = np.frombuffer(image_bytes, dtype=np.uint8)
        image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
        if image is None:
            return None

        app = self._get_app()
        faces = app.get(image)
        if not faces:
            # SCRFD needs some margin around a face; a frame the face fills
            # edge to edge detects as nothing at all. That is easy to hit on a
            # laptop webcam when the user sits close, and it is silent -- the
            # engine simply reports no face, which reads as "your face is
            # unusable" rather than "you are too close".
            #
            # Retrying once on a padded copy costs one extra inference only in
            # the case that already failed, and rescues it. Replicated edges
            # rather than black bars, which would themselves read as structure.
            pad = max(32, min(image.shape[:2]) // 4)
            padded = cv2.copyMakeBorder(
                image, pad, pad, pad, pad, cv2.BORDER_REPLICATE
            )
            faces = app.get(padded)
            if not faces:
                return None
        # Largest detected face. Registration and login are both single-subject,
        # so a second face is a bystander rather than the user.
        face = max(faces, key=lambda f: float((f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1])))
        embedding = getattr(face, "normed_embedding", None)
        if embedding is None:
            embedding = getattr(face, "embedding", None)
            if embedding is None:
                return None
            norm = float(np.linalg.norm(embedding))
            if norm == 0:
                return None
            embedding = embedding / norm
        vector = [float(v) for v in embedding]
        return vector if len(vector) == self.dimensions else None

    def distance(self, a: list[float], b: list[float]) -> float:
        """Cosine distance in [0, 2]; 0 is identical."""
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
        # Cosine distance maps to similarity directly.
        return max(0.0, min(1.0, 1.0 - distance))

    def average(self, descriptors: list[list[float]]) -> list[float] | None:
        # The mean of unit vectors is not a unit vector, and cosine distance
        # assumes normalised input, so re-normalise after averaging.
        mean = super().average(descriptors)
        if mean is None or np is None:
            return mean
        vector = np.asarray(mean, dtype=np.float32)
        norm = float(np.linalg.norm(vector))
        if norm == 0:
            return None
        return [float(v) for v in vector / norm]
