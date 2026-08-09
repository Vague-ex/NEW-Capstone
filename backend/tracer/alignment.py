"""
Curriculum-alignment resolution for BSIS graduates.

The panel revision asked that analytics stop describing a graduate's current
job and start answering whether that job aligns with the BSIS curriculum. Two
sources can answer it, and they are not equally trustworthy:

  1. The alumnus's own tick-box (EmploymentProfile.current_job_related_to_bsis).
     Self-reported and unverifiable.
  2. The job title an employer asserted when confirming employment
     (VerificationDecision.verified_job_title), classified into an IS field by
     `manage.py classify_job_titles`.

Verified wins where it exists. Crucially, the SOURCE travels with the answer so
reports can state a verified alignment rate separately from a self-reported one
— a materially stronger claim than blending them into a single number and
calling it fact.

`UNKNOWN` is a first-class outcome. An unclassified job title or a missing
answer is never silently folded into "not aligned"; doing so would understate
alignment and misrepresent the dataset.
"""

from __future__ import annotations

from dataclasses import dataclass


class AlignmentSource:
    VERIFIED = "verified"
    SELF_REPORTED = "self_reported"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class Alignment:
    """Resolved alignment plus where the answer came from."""

    is_aligned: bool | None
    source: str
    #: IS field of the verified job title, when one was available.
    is_field: str | None = None

    @property
    def is_known(self) -> bool:
        return self.is_aligned is not None

    @property
    def is_verified(self) -> bool:
        return self.source == AlignmentSource.VERIFIED


UNKNOWN = Alignment(is_aligned=None, source=AlignmentSource.UNKNOWN)


def alignment_from_job_title(job_title) -> Alignment | None:
    """
    Alignment implied by a JobTitle row, or None when the title is missing or
    has not been classified yet (so the caller can fall back).
    """
    if job_title is None or job_title.is_bsis_aligned is None:
        return None
    return Alignment(
        is_aligned=job_title.is_bsis_aligned,
        source=AlignmentSource.VERIFIED,
        is_field=job_title.is_field,
    )


def resolve_alignment(*, verified_job_title=None, self_reported=None) -> Alignment:
    """
    Resolve one graduate's current-job alignment.

    `verified_job_title` is a JobTitle instance (or None) taken from the most
    recent confirming VerificationDecision. `self_reported` is the tri-state
    EmploymentProfile.current_job_related_to_bsis.
    """
    verified = alignment_from_job_title(verified_job_title)
    if verified is not None:
        return verified
    if self_reported is None:
        return UNKNOWN
    return Alignment(is_aligned=bool(self_reported), source=AlignmentSource.SELF_REPORTED)


def latest_verified_job_title(alumni_account):
    """
    The job title from this graduate's most recent CONFIRMING verification, or
    None. Prefers a prefetched `_prefetched_decisions` list when the caller has
    set one up, so report loops do not issue a query per alumnus.
    """
    from .models import VerificationDecision

    prefetched = getattr(alumni_account, "_prefetched_decisions", None)
    if prefetched is not None:
        decisions = [
            d for d in prefetched
            if d.decision == VerificationDecision.Decision.CONFIRM and d.verified_job_title_id
        ]
        if not decisions:
            return None
        # Prefetch ordering is not guaranteed, so pick explicitly.
        return max(decisions, key=lambda d: d.decided_at).verified_job_title

    decision = (
        VerificationDecision.objects
        .filter(
            token__alumni=alumni_account,
            decision=VerificationDecision.Decision.CONFIRM,
            verified_job_title__isnull=False,
        )
        .select_related("verified_job_title")
        .order_by("-decided_at")
        .first()
    )
    return decision.verified_job_title if decision else None


def verified_titles_by_alumni(alumni_ids) -> dict:
    """
    Map alumni_id -> most recent confirmed JobTitle, in a single query.

    Report loops call this once up front rather than resolving per graduate,
    which would be one query per row.
    """
    from .models import VerificationDecision

    alumni_ids = list(alumni_ids)
    if not alumni_ids:
        return {}

    rows = (
        VerificationDecision.objects
        .filter(
            token__alumni_id__in=alumni_ids,
            decision=VerificationDecision.Decision.CONFIRM,
            verified_job_title__isnull=False,
        )
        .select_related("token", "verified_job_title")
        .order_by("token__alumni_id", "-decided_at")
    )

    latest: dict = {}
    for row in rows:
        # Ordered newest-first per alumnus, so the first hit wins.
        latest.setdefault(row.token.alumni_id, row.verified_job_title)
    return latest


def summarize(alignments) -> dict:
    """
    Aggregate resolved alignments into report-ready counts.

    Returns verified and self-reported rates separately as well as an overall
    rate, each computed only over records where alignment is actually known.
    """
    verified = [a for a in alignments if a.is_verified and a.is_known]
    self_rep = [
        a for a in alignments
        if a.source == AlignmentSource.SELF_REPORTED and a.is_known
    ]
    known = verified + self_rep
    unknown = sum(1 for a in alignments if not a.is_known)

    def rate(items):
        if not items:
            return None
        return round(100.0 * sum(1 for a in items if a.is_aligned) / len(items), 1)

    return {
        "total": len(list(alignments)),
        "known": len(known),
        "unknown": unknown,
        "verified_n": len(verified),
        "verified_rate": rate(verified),
        "self_reported_n": len(self_rep),
        "self_reported_rate": rate(self_rep),
        "overall_rate": rate(known),
    }
