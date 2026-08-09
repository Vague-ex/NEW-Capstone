"""Classify JobTitle rows into an IS field, which derives BSIS alignment.

Run:
    python manage.py classify_job_titles             # classify unclassified only
    python manage.py classify_job_titles --dry-run   # show the plan, write nothing
    python manage.py classify_job_titles --reclassify  # re-evaluate every row

Why this exists
---------------
Alignment was previously self-reported only: a graduate ticked "is your job
related to BSIS?" and that answer was the entire basis of the metric. Grounding
alignment in the job title itself lets the reports state *which* IS field
graduates land in, and lets an employer-verified title override a self-report.

Matching order matters. Non-IS rules run BEFORE the IS rules because several
common Philippine job titles contain IS-sounding words while being clerical —
"Data Encoder" is the clearest case: it would otherwise match "data" and be
counted as a Data/Database role.

Titles matching no rule are deliberately left NULL rather than guessed at.
NULL means "unclassified", which the reports show separately from "not
aligned" — silently defaulting unknowns to non-aligned would understate the
alignment rate and misrepresent the data to the panel.

Some mappings are approximate because the six IS fields are a fixed taxonomy:
"IT Instructor" is filed under IT Support as the general IT-practitioner
bucket. Reviewers can correct any row from the admin reference-data screen;
this command never overwrites a manual classification unless --reclassify is
passed.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from tracer.models import JobTitle

F = JobTitle.ISField

# Exact, case-insensitive title -> field. Takes precedence over keyword rules.
EXPLICIT = {
    "systems analyst": F.SYSTEMS_ANALYSIS,
    "business systems analyst": F.SYSTEMS_ANALYSIS,
    "information systems officer": F.SYSTEMS_ANALYSIS,
    "it auditor": F.SYSTEMS_ANALYSIS,
    "web developer": F.SOFTWARE_DEV,
    "data analyst": F.DATA_DB,
    "technical support specialist": F.IT_SUPPORT,
    "it program assistant": F.IT_SUPPORT,
    "it instructor": F.IT_SUPPORT,
    "learning management system administrator": F.NETWORK_INFRA,
}

# (keywords, field). Evaluated in order; first keyword hit wins.
KEYWORD_RULES: list[tuple[tuple[str, ...], str]] = [
    # --- Non-IS first: these override IS-sounding substrings. ---
    (
        (
            "encoder", "data entry", "cashier", "sales", "waiter", "waitress",
            "barista", "driver", "nurse", "caregiver", "teacher", "tutor",
            "clerk", "secretary", "receptionist", "call center agent",
            "customer service representative", "csr", "virtual assistant",
            "administrative assistant", "office staff", "bookkeeper",
            "accountant", "cook", "crew", "security guard", "factory",
        ),
        F.NON_IS,
    ),
    # --- Systems analysis / governance ---
    (
        ("systems analyst", "system analyst", "business analyst", "systems analysis",
         "information systems", "it auditor", "it audit", "requirements analyst",
         "product owner", "scrum master", "project manager", "it consultant"),
        F.SYSTEMS_ANALYSIS,
    ),
    # --- Software development ---
    (
        ("developer", "programmer", "software", "web dev", "mobile dev",
         "full stack", "fullstack", "front end", "frontend", "back end", "backend",
         "qa engineer", "quality assurance", "tester", "sdet", "game dev",
         "application", "coder"),
        F.SOFTWARE_DEV,
    ),
    # --- Data / database ---
    (
        ("database", "dba", "data engineer", "data scientist", "data analyst",
         "business intelligence", "data warehouse", "etl", "analytics"),
        F.DATA_DB,
    ),
    # --- Network / infrastructure ---
    (
        ("network", "infrastructure", "system administrator", "systems administrator",
         "sysadmin", "server", "cloud", "devops", "security", "cybersecurity",
         "noc ", "data center"),
        F.NETWORK_INFRA,
    ),
    # --- IT support (most general IS bucket, so it runs last) ---
    (
        ("support", "helpdesk", "help desk", "service desk", "technician",
         "it staff", "it officer", "it assistant", "instructor", "trainer",
         "computer operator", "it specialist"),
        F.IT_SUPPORT,
    ),
]


def classify(title_name: str) -> str | None:
    """Return an ISField value for a title, or None when nothing matches."""
    name = (title_name or "").strip().lower()
    if not name:
        return None
    if name in EXPLICIT:
        return EXPLICIT[name]
    for keywords, field in KEYWORD_RULES:
        if any(kw in name for kw in keywords):
            return field
    return None


class Command(BaseCommand):
    help = "Classify JobTitle rows into an IS field and derive BSIS alignment."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run", action="store_true",
            help="Report what would change without writing.",
        )
        parser.add_argument(
            "--reclassify", action="store_true",
            help="Re-evaluate every row, overwriting existing classifications.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        reclassify = options["reclassify"]

        queryset = JobTitle.objects.all().order_by("name")
        if not reclassify:
            queryset = queryset.filter(is_field__isnull=True)

        changed, unmatched = [], []
        for title in queryset:
            field = classify(title.name)
            if field is None:
                unmatched.append(title.name)
                continue
            if title.is_field != field:
                title.is_field = field
                changed.append((title.name, field))

        if not dry_run and changed:
            with transaction.atomic():
                for title in queryset:
                    if title.is_field:
                        # save() recomputes is_bsis_aligned from is_field.
                        title.save(update_fields=["is_field", "is_bsis_aligned"])

        verb = "Would classify" if dry_run else "Classified"
        self.stdout.write(self.style.SUCCESS(f"{verb} {len(changed)} job title(s)."))
        for name, field in changed:
            self.stdout.write(f"  {name} -> {F(field).label}")

        if unmatched:
            self.stdout.write(
                self.style.WARNING(
                    f"\n{len(unmatched)} title(s) left unclassified (reported as "
                    f"'unknown', never as 'not aligned'):"
                )
            )
            for name in unmatched:
                self.stdout.write(f"  {name}")

        total = JobTitle.objects.count()
        aligned = JobTitle.objects.filter(is_bsis_aligned=True).count()
        non_aligned = JobTitle.objects.filter(is_bsis_aligned=False).count()
        unknown = JobTitle.objects.filter(is_bsis_aligned__isnull=True).count()
        self.stdout.write(
            f"\nJobTitle totals: {total} | IS-aligned {aligned} | "
            f"non-IS {non_aligned} | unclassified {unknown}"
        )
