"""
Face verification service.

Responsible for:
  - Storing and comparing 128-float face descriptor vectors (produced by
    face-api.js on the frontend).
  - Deciding whether a login scan matches the registered biometric.

The actual face detection and descriptor extraction happens on the frontend
using face-api.js (SSD MobileNetV1 + FaceRecognitionNet). The backend
stores the descriptor vector and performs Euclidean distance comparison
on login to produce a server-side similarity score for audit logging.

Constants mirror the thresholds used client-side so both sides agree.
"""

import math
from typing import Optional

# ---------------------------------------------------------------------------
# Thresholds (keep in sync with frontend face-api.js config)
# ---------------------------------------------------------------------------

# Maximum Euclidean distance between two 128-float descriptors to be
# considered a match. face-api.js default is 0.6.
FACE_MATCH_THRESHOLD: float = 0.6

# Minimum face bounding-box dimension (px) accepted during registration.
MIN_FACE_SIZE_PX: int = 72

# Minimum fraction of image area the face bounding box must occupy.
MIN_FACE_AREA_RATIO: float = 0.045

# Length of the face descriptor vector produced by face-api.js.
FACE_DESCRIPTOR_LENGTH: int = 128

# Scaling factor used when converting Euclidean distance to a 0-1
# similarity score: similarity = 1 - (distance * scale).
FACE_DESCRIPTOR_SIMILARITY_SCALE: float = 1.5

# Minimum similarity score (after scaling) for a login to be accepted.
FACE_DESCRIPTOR_MIN_SIMILARITY: float = 0.5

# Pre-computed distance threshold derived from the similarity constants.
FACE_DESCRIPTOR_DISTANCE_THRESHOLD: float = (
    (1.0 - FACE_DESCRIPTOR_MIN_SIMILARITY) * FACE_DESCRIPTOR_SIMILARITY_SCALE
)


# ---------------------------------------------------------------------------
# Descriptor utilities
# ---------------------------------------------------------------------------

def euclidean_distance(a: list[float], b: list[float]) -> float:
    """Return the Euclidean distance between two equal-length vectors."""
    if len(a) != len(b):
        raise ValueError(
            f"Descriptor length mismatch: {len(a)} vs {len(b)}. "
            f"Expected {FACE_DESCRIPTOR_LENGTH} floats."
        )
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def distance_to_similarity(distance: float) -> float:
    """
    Convert a raw Euclidean distance to a 0-1 similarity score.

    Uses the same formula as the frontend:
        similarity = 1 - (distance * FACE_DESCRIPTOR_SIMILARITY_SCALE)

    Clamped to [0, 1].
    """
    raw = 1.0 - (distance * FACE_DESCRIPTOR_SIMILARITY_SCALE)
    return max(0.0, min(1.0, raw))


def is_match(distance: float) -> bool:
    """Return True if the distance is within the acceptance threshold."""
    return distance <= FACE_MATCH_THRESHOLD


def compare_descriptors(
    registered: list[float],
    candidate: list[float],
) -> dict:
    """
    Compare a registered descriptor against a login-time candidate.

    Returns a dict with:
        distance         - raw Euclidean distance
        similarity_score - 0-1 score (higher = more similar)
        matched          - bool, True if within FACE_MATCH_THRESHOLD
    """
    distance = euclidean_distance(registered, candidate)
    return {
        "distance": round(distance, 6),
        "similarity_score": round(distance_to_similarity(distance), 4),
        "matched": is_match(distance),
    }


def validate_descriptor(descriptor: list) -> Optional[str]:
    """
    Validate a face descriptor list.

    Returns an error string if invalid, None if OK.
    """
    if not isinstance(descriptor, list):
        return "Face descriptor must be a JSON array."
    if len(descriptor) != FACE_DESCRIPTOR_LENGTH:
        return (
            f"Face descriptor must have exactly {FACE_DESCRIPTOR_LENGTH} "
            f"values, got {len(descriptor)}."
        )
    if not all(isinstance(v, (int, float)) for v in descriptor):
        return "Face descriptor must contain only numeric values."
    return None