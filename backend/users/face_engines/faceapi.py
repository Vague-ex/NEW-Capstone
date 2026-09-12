"""
face-api.js engine — the current production behaviour, unchanged.

This engine computes nothing. face-api's FaceRecognitionNet runs in the browser,
so `embed()` simply validates and returns the descriptor the client sent. The
server's only job is comparison.

Every value here reproduces what users/api.py already did, so switching the
default engine to this one is a no-op by construction. There are tests asserting
exactly that.
"""

from __future__ import annotations

import os

from .base import UNCOMPARABLE_DISTANCE, FaceEngine

try:  # pragma: no cover - optional dependency guard
    import numpy as np
except Exception:  # pragma: no cover
    np = None


# Display-only mapping from euclidean distance to a 0..1 similarity. Preserved
# from users/api.py because the API responses and admin UI already show it.
SIMILARITY_SCALE = 1.5


class FaceApiEngine(FaceEngine):
    name = "faceapi"
    dimensions = 128
    requires_client_descriptor = True

    def __init__(self) -> None:
        # Env-tunable, same variable the previous inline constant used, so an
        # existing deployment override keeps working.
        #
        #   same person, good capture        0.30 - 0.45
        #   same person, poor light/angle    0.45 - 0.60
        #   DIFFERENT people                 0.60 - 1.00+
        #
        # 0.55 keeps a margin below the 0.60 crossover. Raise toward 0.60 if
        # legitimate users are rejected, but never past it.
        self.distance_threshold = float(
            os.getenv("FACE_DESCRIPTOR_DISTANCE_THRESHOLD", "0.55")
        )

    def embed(
        self,
        *,
        image_bytes: bytes | None = None,
        client_descriptor: list[float] | None = None,
    ) -> list[float] | None:
        # image_bytes is accepted and ignored: the browser already did the work,
        # and the server has no face-api runtime to redo it with.
        return self.validate(client_descriptor)

    def distance(self, a: list[float], b: list[float]) -> float:
        if np is None:
            return UNCOMPARABLE_DISTANCE
        left = np.asarray(a, dtype=np.float32)
        right = np.asarray(b, dtype=np.float32)
        if left.shape != right.shape or left.size != self.dimensions:
            return UNCOMPARABLE_DISTANCE
        return float(np.linalg.norm(left - right))

    def similarity(self, distance: float) -> float:
        return max(0.0, min(1.0, 1.0 - (distance / SIMILARITY_SCALE)))
