"""
Face-recognition engine interface.

The point of this seam is that three engines with genuinely different shapes can
sit behind one call site:

    face-api.js   128-d, euclidean distance, computed IN THE BROWSER
    InsightFace   512-d, cosine distance, computed on the server
    CompreFace    512-d, cosine distance, computed by a separate service

The first of those is the awkward one. face-api runs client-side, so the server
never sees an image it can embed -- it receives a descriptor the browser already
produced. The other two receive an image and embed it themselves. `embed()`
therefore takes BOTH an image and a client-supplied descriptor and each engine
uses whichever it actually needs, rather than pretending the three work alike.

Embeddings from different engines are not comparable in any way: different
dimensionality, different metric, different scale. Every stored vector records
which engine produced it, and comparing across engines raises rather than
returning a number that looks plausible and means nothing.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass

try:  # pragma: no cover - optional dependency guard, mirrors users/api.py
    import numpy as np
except Exception:  # pragma: no cover
    np = None


# Returned as the distance when a comparison cannot be performed at all. Chosen
# to be far outside every engine's threshold so a failure can never read as a
# match, whatever the metric.
UNCOMPARABLE_DISTANCE = 999.0


class EngineMismatchError(RuntimeError):
    """
    Raised when a stored embedding was produced by a different engine.

    Deliberately loud. A 128-d face-api vector compared against a 512-d ArcFace
    probe does not produce a "wrong" distance -- it produces a meaningless one,
    which the threshold will then accept or reject essentially at random. Failing
    is the only safe behaviour.
    """


@dataclass(frozen=True)
class MatchResult:
    is_match: bool
    distance: float
    similarity: float
    reference_count: int
    engine: str


class FaceEngine(abc.ABC):
    """One way of turning a face into a vector and comparing two of them."""

    #: Stored alongside every embedding; comparisons require it to match.
    name: str = "base"
    #: Length of the embedding this engine produces.
    dimensions: int = 0
    #: Distances at or below this count as the same person.
    distance_threshold: float = 0.0
    #: True when the embedding arrives from the browser rather than being
    #: computed here. Views use this to decide whether an image is mandatory.
    requires_client_descriptor: bool = False

    @abc.abstractmethod
    def embed(
        self,
        *,
        image_bytes: bytes | None = None,
        client_descriptor: list[float] | None = None,
    ) -> list[float] | None:
        """Produce one embedding, or None when no usable face was found."""

    @abc.abstractmethod
    def distance(self, a: list[float], b: list[float]) -> float:
        """Engine-native distance. Lower means more similar, for every engine."""

    def similarity(self, distance: float) -> float:
        """
        A 0..1 figure for display only. It never decides a match -- callers
        compare distance against the threshold. Kept because the existing API
        responses and the admin UI already surface a similarity score.
        """
        if self.distance_threshold <= 0:
            return 0.0
        # Linear falloff that reaches 0 at twice the threshold. Engine-specific
        # subclasses override this where a more meaningful mapping exists.
        span = self.distance_threshold * 2
        return max(0.0, min(1.0, 1.0 - (distance / span)))

    def is_match(self, distance: float) -> bool:
        return distance <= self.distance_threshold

    def validate(self, descriptor: list[float] | None) -> list[float] | None:
        """Return the descriptor only if it is the right shape for this engine."""
        if not descriptor:
            return None
        if len(descriptor) != self.dimensions:
            return None
        try:
            return [float(v) for v in descriptor]
        except (TypeError, ValueError):
            return None

    def compare(
        self,
        probe: list[float],
        references: list[list[float]],
    ) -> MatchResult:
        """Best match of `probe` against every enrolled reference."""
        if not probe or not references:
            return MatchResult(
                is_match=False,
                distance=UNCOMPARABLE_DISTANCE,
                similarity=0.0,
                reference_count=len(references or []),
                engine=self.name,
            )

        distances = [self.distance(reference, probe) for reference in references]
        best = min(distances) if distances else UNCOMPARABLE_DISTANCE
        return MatchResult(
            is_match=self.is_match(best),
            distance=best,
            similarity=self.similarity(best),
            reference_count=len(references),
            engine=self.name,
        )

    def average(self, descriptors: list[list[float]]) -> list[float] | None:
        """
        Mean of several embeddings of the same face, used to build one template
        from a capture burst. Valid for euclidean engines; cosine engines
        override to normalise afterwards, since the mean of unit vectors is not
        itself a unit vector.
        """
        if np is None:
            return None
        usable = [d for d in descriptors or [] if d and len(d) == self.dimensions]
        if not usable:
            return None
        return [float(v) for v in np.asarray(usable, dtype=np.float32).mean(axis=0)]
