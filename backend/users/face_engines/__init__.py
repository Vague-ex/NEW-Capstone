"""
Engine registry.

Which engine is active is decided once, by the FACE_ENGINE environment
variable, and defaults to `faceapi` -- the existing production behaviour. A
deployment that sets nothing behaves exactly as it did before this package
existed.

    FACE_ENGINE=faceapi       (default) browser-side face-api.js, 128-d
    FACE_ENGINE=insightface   server-side ArcFace, 512-d
    FACE_ENGINE=compreface    separate REST service, 512-d  [local only]

Engines are instantiated lazily and cached, because InsightFace builds an ONNX
session on construction and nothing should pay that cost at import time.
"""

from __future__ import annotations

import os
import threading

from .base import EngineMismatchError, FaceEngine, MatchResult, UNCOMPARABLE_DISTANCE
from .compreface import ComprefaceEngine
from .faceapi import FaceApiEngine
from .insight import InsightFaceEngine

__all__ = [
    "EngineMismatchError",
    "FaceEngine",
    "MatchResult",
    "UNCOMPARABLE_DISTANCE",
    "DEFAULT_ENGINE_NAME",
    "get_engine",
    "engine_for",
    "resolve_stored_engine",
]

DEFAULT_ENGINE_NAME = "faceapi"

_ENGINE_CLASSES: dict[str, type[FaceEngine]] = {
    FaceApiEngine.name: FaceApiEngine,
    InsightFaceEngine.name: InsightFaceEngine,
    ComprefaceEngine.name: ComprefaceEngine,
}

_instances: dict[str, FaceEngine] = {}
_lock = threading.Lock()


def engine_for(name: str) -> FaceEngine:
    """Return the named engine, building and caching it on first use."""
    key = (name or "").strip().lower()
    if key not in _ENGINE_CLASSES:
        raise ValueError(
            f"Unknown FACE_ENGINE {name!r}. Available: {', '.join(sorted(_ENGINE_CLASSES))}"
        )
    cached = _instances.get(key)
    if cached is not None:
        return cached
    with _lock:
        cached = _instances.get(key)
        if cached is None:
            cached = _ENGINE_CLASSES[key]()
            _instances[key] = cached
        return cached


def get_engine() -> FaceEngine:
    """The engine this deployment is configured to use."""
    return engine_for(os.getenv("FACE_ENGINE", DEFAULT_ENGINE_NAME))


def resolve_stored_engine(stored_name: str | None) -> str:
    """
    Which engine produced an existing stored template.

    Everything enrolled before this package existed was face-api, and those rows
    have no engine key, so a missing value means `faceapi` rather than "unknown".
    """
    return (stored_name or DEFAULT_ENGINE_NAME).strip().lower() or DEFAULT_ENGINE_NAME
