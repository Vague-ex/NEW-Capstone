"""
Read-only scan of stored data for values the system should never have accepted.

    python manage.py audit_data_quality
    python manage.py audit_data_quality --examples 20

Nothing is written. ERROR rows are values that break a rule outright (a name
with digits, an impossible year, a vulgar word). WARN rows need a human look
(a job title outside the admin's list, a blank required name).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand
from django.core.validators import validate_email

from tracer.models import (
    EmploymentProfile,
    EmploymentRecord,
    Industry,
    JobTitle,
    VerificationDecision,
    WorkAddress,
)
from tracer.text_quality import (
    job_text_problem,
    person_name_problem,
    ph_mobile_problem,
    profanity_problem,
    year_month_problem,
)
from users.models import AlumniProfile, GraduateMasterRecord, User

VALID_TIME_TO_HIRE = {1, 3, 4.5, 9, 18, 30}


class Command(BaseCommand):
    help = "Read-only scan of stored data for implausible or unsafe values."

    def add_arguments(self, parser):
        parser.add_argument("--examples", type=int, default=5, help="Example rows to print per finding.")

    def handle(self, *args, **options):
        self.examples = options["examples"]
        self.findings: dict[tuple[str, str], list[str]] = defaultdict(list)
        self.stats: dict[str, object] = {}

        self._master_list()
        self._users()
        self._profiles()
        self._reference()
        self._employment()
        self._addresses()
        self._verifications()
        self._report()

    # ── helpers ────────────────────────────────────────────────────────────
    def flag(self, level: str, check: str, row_id, field: str, value, reason: str):
        shown = str(value)
        shown = shown if len(shown) <= 60 else shown[:57] + "..."
        self.findings[(level, check)].append(f"{row_id} {field}={shown!r} ({reason})")

    # ── checks ─────────────────────────────────────────────────────────────
    def _master_list(self):
        max_year = date.today().year + 1
        for r in GraduateMasterRecord.objects.all().iterator():
            problem = person_name_problem(r.full_name, required=True)
            if not problem and len((r.full_name or "").split()) < 2:
                problem = "is a single word"
            if problem:
                self.flag("ERROR", "Master list: bad graduate name", r.pk, "full_name", r.full_name, problem)
            if not (2000 <= (r.batch_year or 0) <= max_year):
                self.flag("ERROR", "Master list: impossible batch year", r.pk, "batch_year", r.batch_year, f"outside 2000-{max_year}")

    def _users(self):
        for u in User.objects.all().only("id", "email").iterator():
            try:
                validate_email(u.email)
            except ValidationError:
                self.flag("ERROR", "Accounts: invalid email", u.pk, "email", u.email, "not an email address")
                continue
            if u.email != u.email.strip().lower():
                self.flag("WARN", "Accounts: email not normalised", u.pk, "email", u.email, "has capitals or spaces")

    def _profiles(self):
        middle_lengths = {"blank": 0, "initial (1 letter)": 0, "initial with period": 0, "full name": 0}
        for p in AlumniProfile.objects.all().iterator():
            for field, required in (("first_name", True), ("last_name", True), ("middle_name", False)):
                value = getattr(p, field)
                problem = person_name_problem(value, required=required)
                if problem == "is blank":
                    self.flag("WARN", "Profiles: blank required name", p.pk, field, value, problem)
                elif problem:
                    self.flag("ERROR", "Profiles: bad name", p.pk, field, value, problem)

            middle = (p.middle_name or "").strip()
            if not middle:
                middle_lengths["blank"] += 1
            elif len(middle) == 1:
                middle_lengths["initial (1 letter)"] += 1
            elif len(middle) == 2 and middle.endswith("."):
                middle_lengths["initial with period"] += 1
            else:
                middle_lengths["full name"] += 1

            if (problem := ph_mobile_problem(p.mobile)):
                self.flag("ERROR", "Profiles: bad mobile number", p.pk, "mobile", p.mobile, problem)
            if (problem := year_month_problem(p.birth_date, min_age=18, max_age=70)):
                self.flag("WARN", "Profiles: implausible birth month", p.pk, "birth_date", p.birth_date, problem)
            if (problem := year_month_problem(p.graduation_date)):
                self.flag("WARN", "Profiles: implausible graduation month", p.pk, "graduation_date", p.graduation_date, problem)
            for field in ("city", "province", "scholarship", "graduate_school", "awards", "prof_eligibility_other",
                          "postgrad_program", "postgrad_school"):
                value = getattr(p, field, "")
                if (problem := profanity_problem(value)):
                    self.flag("ERROR", "Profiles: vulgar text", p.pk, field, value, problem)
        self.stats["Middle name values"] = middle_lengths

    def _reference(self):
        for j in JobTitle.objects.all().iterator():
            problem = job_text_problem(j.name)
            if problem:
                self.flag("ERROR", "Reference: bad job title", j.pk, "name", j.name, problem)
            elif j.name == j.name.lower():
                self.flag("WARN", "Reference: job title not capitalised", j.pk, "name", j.name, "all lowercase, likely test data")
            if not j.industry_id:
                self.flag("WARN", "Reference: job title without industry", j.pk, "name", j.name, "no industry")
        for i in Industry.objects.all().iterator():
            if (problem := job_text_problem(i.name)):
                self.flag("ERROR", "Reference: bad industry", i.pk, "name", i.name, problem)

    def _employment(self):
        listed = {name.strip().lower() for name in JobTitle.objects.filter(is_active=True).values_list("name", flat=True)}
        for e in EmploymentProfile.objects.all().iterator():
            for field in ("first_job_title", "current_job_title"):
                value = (getattr(e, field) or "").strip()
                if not value:
                    continue
                if (problem := job_text_problem(value)):
                    self.flag("ERROR", "Survey: bad job title", e.pk, field, value, problem)
                elif value.lower() not in listed:
                    self.flag("WARN", "Survey: job title not in the admin list", e.pk, field, value, "free text")
            if (problem := job_text_problem(e.current_job_company)):
                self.flag("ERROR", "Survey: bad company name", e.pk, "current_job_company", e.current_job_company, problem)
            if e.time_to_hire_months is not None and e.time_to_hire_months not in VALID_TIME_TO_HIRE:
                self.flag("ERROR", "Survey: invalid time-to-hire", e.pk, "time_to_hire_months", e.time_to_hire_months, "not a survey option")

        for r in EmploymentRecord.objects.all().iterator():
            for field in ("job_title_input", "employer_name_input"):
                if (problem := job_text_problem(getattr(r, field))):
                    self.flag("ERROR", "Employment records: bad text", r.pk, field, getattr(r, field), problem)
            if r.job_title_input and not r.job_title_id:
                self.flag("WARN", "Employment records: title not linked to the admin list", r.pk, "job_title_input", r.job_title_input, "no job_title id")

    def _addresses(self):
        for w in WorkAddress.objects.all().iterator():
            in_ph = (w.country or "Philippines").strip().lower() in {"", "philippines", "ph"}
            zip_code = (w.zip_code or "").strip()
            if zip_code and in_ph and not (len(zip_code) == 4 and zip_code.isdigit()):
                self.flag("ERROR", "Work address: bad PH ZIP code", w.pk, "zip_code", zip_code, "must be 4 digits")
            if w.latitude is not None and not (-90 <= w.latitude <= 90):
                self.flag("ERROR", "Work address: impossible coordinates", w.pk, "latitude", w.latitude, "out of range")
            if w.longitude is not None and not (-180 <= w.longitude <= 180):
                self.flag("ERROR", "Work address: impossible coordinates", w.pk, "longitude", w.longitude, "out of range")
            if in_ph and w.latitude is not None and w.longitude is not None and not (4 <= w.latitude <= 22 and 116 <= w.longitude <= 127):
                self.flag("WARN", "Work address: pin outside the Philippines", w.pk, "lat,lng", f"{w.latitude},{w.longitude}", "country says PH")

    def _verifications(self):
        for d in VerificationDecision.objects.all().iterator():
            if d.verifier_email:
                try:
                    validate_email(d.verifier_email)
                except ValidationError:
                    self.flag("ERROR", "Verifications: invalid verifier email", d.pk, "verifier_email", d.verifier_email, "not an email")
            for field in ("verifier_name", "evaluator_name"):
                if (problem := person_name_problem(getattr(d, field))):
                    self.flag("ERROR", "Verifications: bad person name", d.pk, field, getattr(d, field), problem)
            for field in ("comment", "assessment_strengths", "assessment_improvements", "verified_employer_name"):
                if (problem := profanity_problem(getattr(d, field))):
                    self.flag("ERROR", "Verifications: vulgar text", d.pk, field, getattr(d, field), problem)

    # ── output ─────────────────────────────────────────────────────────────
    def _report(self):
        errors = sum(len(v) for (level, _), v in self.findings.items() if level == "ERROR")
        warns = sum(len(v) for (level, _), v in self.findings.items() if level == "WARN")
        self.stdout.write(self.style.MIGRATE_HEADING(f"Data quality audit: {errors} error(s), {warns} warning(s)"))
        for (level, check), rows in sorted(self.findings.items(), key=lambda kv: (kv[0][0] != "ERROR", kv[0][1])):
            style = self.style.ERROR if level == "ERROR" else self.style.WARNING
            self.stdout.write(style(f"\n[{level}] {check}: {len(rows)}"))
            for row in rows[: self.examples]:
                self.stdout.write(f"    {row}")
            if len(rows) > self.examples:
                self.stdout.write(f"    ... {len(rows) - self.examples} more")
        for name, value in self.stats.items():
            self.stdout.write(f"\n{name}: {value}")
        if not self.findings:
            self.stdout.write(self.style.SUCCESS("No problems found."))
