"""
Seed simulated graduate accounts: a believable stand-in for the real tracer
data until enough graduates have registered.

The graduates come from the realistic-data generator in
ml/experiments/realistic_stress_test.py: the real masterlist batch sizes
(2019-2024), a harsh job market, answers that carry a strong signal, and the
same messiness a real survey has (blanks, recall error, mis-reported status).
Every graduate is surveyed (a census), and each becomes an account written to
the same tables real registration fills, so the dashboard, reports, geomap and
model read them exactly like real graduates.

They are kept apart from real graduates:
  - flagged {"is_sample": true} in biometric_template (employability.sample_q),
  - never linked to a masterlist record, and never given a real graduate's
    name, so a real graduate registering is never "already matched",
  - emails on reserved .test domains (mateo.reyes21@gmail.test), which cannot
    reach a real inbox, and unusable passwords with no face data,
  - shown only when the admin picks "Simulated graduates" on /admin/debug/a.

Usage (from backend/):
    python manage.py seed_simulated_graduates --pick-seed 6     # which seeds pass the gate (no writes)
    python manage.py seed_simulated_graduates --seed 20260917 --dry-run
    python manage.py seed_simulated_graduates --seed 20260917   # replaces all existing sample accounts
    python manage.py seed_simulated_graduates --clear           # delete sample accounts only
Then:
    python manage.py train_employability_model --source simulated-accounts --activate
"""

from __future__ import annotations

import math
import random
import unicodedata
import warnings
from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from tracer import employability

DEFAULT_SEED = 20260917

FIRST_NAMES_MALE = [
    "Mateo", "Gabriel", "Rafael", "Lance", "Joaquin", "Emilio", "Andres", "Carlo", "Diego", "Marco",
    "Paolo", "Enrique", "Vicente", "Rommel", "Kurt", "Jerome", "Christian", "John Paul", "Mark Anthony",
    "Kenneth", "Nathaniel", "Adrian", "Bryan", "Jericho", "Kyle", "Ramon", "Miguel", "Francis", "Dominic",
    "Ralph", "Justin", "Aldrin", "Jomar", "Renz", "Carl", "Jay-ar", "Neil", "Patrick", "Vince", "Arnel",
]
FIRST_NAMES_FEMALE = [
    "Bea", "Sofia", "Camille", "Andrea", "Patricia", "Isabel", "Mariel", "Trisha", "Angeline", "Kristine",
    "Danica", "Joy", "Mae", "Hannah", "Liza", "Precious", "Kimberly", "Jasmine", "Nicole", "Rhea",
    "Mary Grace", "Ma. Theresa", "Clarisse", "Janelle", "Erika", "Rochelle", "Aira", "Shaira", "Jonalyn",
    "Charmaine", "Kathleen", "Pauline", "Frances", "Lovely", "Alyssa", "Denise", "Irish", "Bianca", "Ella", "Mica",
]
SURNAMES = [
    "Reyes", "Santos", "Cruz", "Bautista", "Villanueva", "Mercado", "Aquino", "Delos Santos", "Garcia", "Ramos",
    "Flores", "Gonzales", "Torres", "Castillo", "Domingo", "Salvador", "Navarro", "Espinosa", "Fernandez", "Lim",
    "Gamboa", "Lacson", "Ledesma", "Montelibano", "Alunan", "Araneta", "Gatuslao", "Jalandoni", "Yulo", "Villalon",
    "Sarrosa", "Tupas", "Divinagracia", "Palmares", "Sombito", "Gensoli", "Dela Cruz", "Tan", "Uy", "Sy",
    "Magbanua", "Suarez", "Sumagaysay", "Tolentino", "Pama", "Parreño", "Belleza", "Colmenares", "Legaspi", "Ortega",
    "Abad", "Balinas", "Catalan", "Dagohoy", "Estrella", "Fuentes", "Gallardo", "Hilario", "Ignacio", "Javier",
]
SCHOLARSHIPS = [
    "CHED Scholarship Program", "UniFAST Tertiary Education Subsidy", "DOST-SEI Scholarship",
    "CHMSU Academic Scholarship", "LGU Scholarship Program",
]
EMAIL_PROVIDERS = [("gmail.test", 0.72), ("yahoo.test", 0.18), ("outlook.test", 0.10)]

# (city, province, region, latitude, longitude, weight). PSGC spellings, so the
# Employment page's dropdowns resolve them.
HOME_CITIES = [
    ("City of Talisay", "Negros Occidental", "Negros Island Region (NIR)", 10.7363, 122.9673, 22),
    ("City of Bacolod", "Negros Occidental", "Negros Island Region (NIR)", 10.6765, 122.9509, 20),
    ("City of Silay", "Negros Occidental", "Negros Island Region (NIR)", 10.7976, 122.9749, 14),
    ("Murcia", "Negros Occidental", "Negros Island Region (NIR)", 10.6045, 123.0414, 6),
    ("City of Victorias", "Negros Occidental", "Negros Island Region (NIR)", 10.9010, 123.0708, 6),
    ("City of Bago", "Negros Occidental", "Negros Island Region (NIR)", 10.5388, 122.8384, 5),
    ("City of Cadiz", "Negros Occidental", "Negros Island Region (NIR)", 10.9465, 123.2880, 4),
    ("Manapla", "Negros Occidental", "Negros Island Region (NIR)", 10.9581, 123.1231, 4),
    ("City of Sagay", "Negros Occidental", "Negros Island Region (NIR)", 10.8969, 123.4172, 4),
    ("City of La Carlota", "Negros Occidental", "Negros Island Region (NIR)", 10.4225, 122.9194, 3),
    ("Valladolid", "Negros Occidental", "Negros Island Region (NIR)", 10.4600, 122.8250, 3),
    ("City of Escalante", "Negros Occidental", "Negros Island Region (NIR)", 10.8404, 123.4995, 3),
]
WORK_CITIES_LOCAL = [
    ("City of Bacolod", "Negros Occidental", "Negros Island Region (NIR)", 10.6765, 122.9509, 34),
    ("City of Talisay", "Negros Occidental", "Negros Island Region (NIR)", 10.7363, 122.9673, 9),
    ("City of Silay", "Negros Occidental", "Negros Island Region (NIR)", 10.7976, 122.9749, 5),
    ("City of Iloilo", "", "Region VI (Western Visayas)", 10.7202, 122.5621, 7),
    ("City of Cebu", "", "Region VII (Central Visayas)", 10.3157, 123.8854, 9),
    ("City of Mandaue", "", "Region VII (Central Visayas)", 10.3236, 123.9223, 3),
    ("Quezon City", "", "National Capital Region (NCR)", 14.6760, 121.0437, 8),
    ("City of Makati", "", "National Capital Region (NCR)", 14.5547, 121.0244, 7),
    ("City of Taguig", "", "National Capital Region (NCR)", 14.5176, 121.0509, 7),
    ("City of Pasig", "", "National Capital Region (NCR)", 14.5764, 121.0851, 4),
    ("City of Manila", "", "National Capital Region (NCR)", 14.5995, 120.9842, 3),
    ("City of Davao", "", "Region XI (Davao Region)", 7.1907, 125.4553, 2),
]
WORK_CITIES_ABROAD = [
    ("Singapore", "Singapore", "Singapore", 1.3521, 103.8198, 30),
    ("Dubai", "Dubai", "UAE", 25.2048, 55.2708, 25),
    ("Riyadh", "Riyadh Province", "Saudi Arabia", 24.7136, 46.6753, 15),
    ("Doha", "Doha", "Qatar", 25.2854, 51.5310, 10),
    ("Tokyo", "Tokyo Metropolis", "Japan", 35.6762, 139.6503, 10),
    ("Sydney", "New South Wales", "Australia", -33.8688, 151.2093, 10),
]

# The generator's job categories, mapped to titles on the admin's job-title list.
TITLE_CHOICES = {
    "IT Support / Technical Support": ["IT Support Specialist", "Help Desk Technician", "Computer Technician"],
    "Web / Software Developer": ["Web Developer", "Software Developer", "Full-Stack Developer", "Front-End Developer", "Back-End Developer"],
    "Data Encoder / Data Analyst": ["Data Encoder", "Data Analyst"],
    "MIS / IT Staff (Government)": ["Information Systems Officer", "IT Program Assistant", "Computer Technician"],
    "Network / Systems Administrator": ["Network Administrator", "Systems Administrator"],
    "QA / Software Tester": ["QA Tester", "Software Tester", "Quality Assurance Analyst"],
    "UI/UX / Graphic Designer": ["UI/UX Designer", "Graphic Designer"],
    "Customer Service Rep / Call Center Agent": ["Call Center Agent", "Customer Service Representative", "Customer Care Specialist"],
    "Administrative / Office Staff": ["Administrative Assistant", "Administrative Aide", "Clerk"],
    "Sales / Marketing Staff": ["Sales Associate", "Digital Marketing Specialist", "E-commerce Specialist"],
    "Government Clerk / Job Order": ["Administrative Aide", "Clerk", "Data Encoder"],
    "Virtual Assistant / Freelancer": ["Virtual Assistant", "Freelancer"],
    "Teacher / Instructor": ["Instructor", "IT Instructor"],
    "Bank / Finance Staff": ["Bank Teller", "Loan Officer", "Accounting Staff"],
    "Other": ["Cashier", "Inventory Clerk", "Front Desk Officer"],
}
EMPLOYERS = {
    "private": [
        "Concentrix", "Teleperformance", "TaskUs", "Accenture Philippines", "Transcosmos Asia Philippines",
        "Ubiquity Global Services", "iQor Philippines", "StarTek Philippines", "Globe Telecom", "PLDT Inc.",
        "Converge ICT Solutions", "BDO Unibank", "Metrobank", "Bank of the Philippine Islands", "Ayala Land",
        "Robinsons Land Corporation", "SM Supermalls", "Jollibee Foods Corporation", "VICMICO", "Nexus Technologies Inc.",
    ],
    "government": [
        "City Government of Bacolod", "City Government of Talisay", "Provincial Government of Negros Occidental",
        "Carlos Hilado Memorial State University", "Department of Information and Communications Technology",
        "Department of Education - Division of Negros Occidental", "Philippine Statistics Authority",
        "Social Security System", "Land Transportation Office", "Bureau of Internal Revenue",
    ],
    "entrepreneurial": ["Self-employed", "Freelance (Upwork)", "Freelance (OnlineJobs.ph)", "Own business"],
}
TECHNICAL_EXTRA = ["HTML/CSS", "JavaScript", "React", "MySQL", "PostgreSQL", "Figma", "Canva", "Linux", "Python", "Agile / Scrum"]


def _weighted(rng: random.Random, rows: list[tuple]):
    return rng.choices(rows, weights=[r[-1] for r in rows])[0]


def _ascii(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")


def _missing(value) -> bool:
    return value is None or (isinstance(value, float) and math.isnan(value))


class Command(BaseCommand):
    help = "Seed simulated graduate accounts (flagged as samples) from the realistic-data generator."

    def add_arguments(self, parser):
        parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
        parser.add_argument("--scenario", choices=["harsh", "pids"], default="harsh")
        parser.add_argument("--signal", choices=["weak", "moderate", "strong"], default="strong")
        parser.add_argument("--dry-run", action="store_true", help="Build and summarize, write nothing.")
        parser.add_argument("--clear", action="store_true", help="Delete every sample account and stop.")
        parser.add_argument(
            "--pick-seed", type=int, default=0, metavar="N",
            help="Try N seeds starting at --seed against the acceptance gate; writes nothing.",
        )

    # ── entry point ────────────────────────────────────────────────────────
    def handle(self, *args, **opts):
        warnings.filterwarnings("ignore")
        if opts["clear"]:
            removed = self._clear()
            self.stdout.write(self.style.SUCCESS(f"Deleted {removed} sample account(s)."))
            return

        if opts["pick_seed"]:
            for seed in range(opts["seed"], opts["seed"] + opts["pick_seed"]):
                plans = self._plans(seed, opts["scenario"], opts["signal"])
                result = employability.evaluate_candidate(self._frame(plans), repeats=5, n_boot=80)
                failed = [c["key"] for c in result["checks"] if not c["passed"]]
                auc = result["metrics"].get("cv_auc_mean")
                auc_text = f"{auc:.2f}" if auc is not None else "-"
                verdict = self.style.SUCCESS("PASS") if result["passed"] else self.style.ERROR("FAIL " + ", ".join(failed))
                self.stdout.write(f"seed {seed}: {len(plans)} graduates, AUC {auc_text}  {verdict}")
            return

        plans = self._plans(opts["seed"], opts["scenario"], opts["signal"])
        self._summary(plans, opts)
        if opts["dry_run"]:
            self.stdout.write("Dry run: nothing written.")
            return
        removed, created = self._write(plans)
        self.stdout.write(self.style.SUCCESS(
            f"Replaced {removed} existing sample account(s) with {created} simulated graduates."
        ))
        self.stdout.write("Next: python manage.py train_employability_model --source simulated-accounts --activate")

    # ── simulation → per-graduate plans ────────────────────────────────────
    def _plans(self, seed: int, scenario: str, signal: str) -> list[dict]:
        import numpy as np
        from tracer.models import JobTitle
        from users.models import GraduateMasterRecord, User

        sim = employability.load_simulator()
        params = {**sim.SCENARIOS[scenario], **sim.SIGNAL_LEVELS[signal]}
        np_rng = np.random.default_rng(seed)
        population = sim.generate_population(np_rng, dict(sim.MASTERLIST_BATCH_SIZES), params)
        survey = sim.run_survey(np_rng, population, census=True, noisy=True)
        rng = random.Random(seed)

        listed_titles = {t.lower(): t for t in JobTitle.objects.filter(is_active=True).values_list("name", flat=True)}
        masterlist = {}
        for last, full in GraduateMasterRecord.objects.values_list("last_name", "full_name"):
            masterlist.setdefault((last or "").strip().lower(), []).append((full or "").lower())
        taken_emails = {e.lower() for e in User.objects.values_list("email", flat=True)}
        used_names: set[tuple[str, str]] = set()

        def title_for(category: str | None) -> str:
            options = TITLE_CHOICES.get(category or "Other", TITLE_CHOICES["Other"])
            listed = [listed_titles[o.lower()] for o in options if o.lower() in listed_titles]
            return rng.choice(listed or options)

        def fictional_name(female: bool) -> tuple[str, str, str]:
            for _ in range(200):
                first = rng.choice(FIRST_NAMES_FEMALE if female else FIRST_NAMES_MALE)
                last = rng.choice(SURNAMES)
                middle = rng.choice([s for s in SURNAMES if s != last])
                on_masterlist = any(first.lower() in full for full in masterlist.get(last.lower(), []))
                if not on_masterlist and (first, last) not in used_names:
                    used_names.add((first, last))
                    return first, middle, last
            raise CommandError("Ran out of fictional names that avoid the masterlist.")

        def email_for(first: str, last: str, batch: int) -> str:
            base = _ascii(f"{first}.{last}").lower().replace(" ", "").replace("-", "").replace("..", ".")
            domain = rng.choices([d for d, _ in EMAIL_PROVIDERS], weights=[w for _, w in EMAIL_PROVIDERS])[0]
            for suffix in (str(batch)[-2:], str(rng.randint(1, 99)), str(rng.randint(100, 999))):
                email = f"{base}{suffix}@{domain}"
                if email not in taken_emails:
                    taken_emails.add(email)
                    return email
            raise CommandError(f"Could not find a free email for {first} {last}.")

        it_categories = list(sim.IT_TITLES)
        non_it_categories = list(sim.NON_IT_TITLES)
        plans: list[dict] = []
        for row in survey.to_dict("records"):
            batch = int(row["batch"])
            female = int(row["gender"]) == 1
            first, middle, last = fictional_name(female)
            status_obs = row["status"]
            has_first = not _missing(row["first_job_sector"])
            employed = status_obs == "employed"
            current_category = None if _missing(row["job_title"]) else row["job_title"]
            is_it = None if _missing(row["it_related_job"]) else bool(row["it_related_job"])

            if employed:
                freelance = row["current_job_sector"] == "entrepreneurial" or current_category == "Virtual Assistant / Freelancer"
                status = "self_employed" if freelance else ("employed_part_time" if rng.random() < 0.12 else "employed_full_time")
            else:
                status = status_obs

            tth = None if _missing(row["time_to_hire_months"]) else float(row["time_to_hire_months"])
            tth_raw = sim.TTH_LABELS[int(row["tth_bucket"])] if not _missing(row["tth_bucket"]) else ""

            first_job = None
            if has_first:
                same_as_current = employed and current_category and rng.random() < 0.55
                if same_as_current:
                    first_category, first_it = current_category, is_it
                else:
                    first_it = rng.random() < 0.5
                    first_category = rng.choice(it_categories if first_it else non_it_categories)
                first_job = {
                    "title": title_for(first_category),
                    "company": rng.choice(EMPLOYERS[row["first_job_sector"]]),
                    "sector": row["first_job_sector"],
                    "status": row["first_job_status"],
                    "related": bool(first_it),
                    "applications": None if _missing(row["job_applications_count"]) else int(row["job_applications_count"]),
                    "source": row["job_source"] if not _missing(row["job_source"]) else None,
                    "same_as_current": bool(same_as_current),
                }

            current_job = None
            if employed:
                sector = row["current_job_sector"] or "private"
                local = _missing(row["location_type"]) or bool(row["location_type"])
                work = _weighted(rng, WORK_CITIES_LOCAL if local else WORK_CITIES_ABROAD)
                current_job = {
                    "title": title_for(current_category) if current_category else "",
                    "company": (first_job["company"] if first_job and first_job["same_as_current"]
                                else rng.choice(EMPLOYERS[sector])),
                    "sector": sector,
                    "related": is_it,
                    "local": local,
                    "work": work,
                }

            home = _weighted(rng, HOME_CITIES)
            birth_year = batch - rng.choice([21, 21, 22, 22, 23, 24])
            postgrad = "completed" if row["completed_postgrad"] else ("enrolled" if row["pursuing_postgrad"] else "none")
            tech_n = 0 if _missing(row["technical_skill_count"]) else int(row["technical_skill_count"])
            soft_n = 0 if _missing(row["soft_skill_count"]) else int(row["soft_skill_count"])
            tech_pool = list(employability.TECHNICAL_SKILLS) + TECHNICAL_EXTRA
            plans.append({
                "first": first, "middle": middle, "last": last,
                "email": email_for(first, last, batch),
                "gender": "Female" if female else "Male",
                "batch": batch,
                "graduation_date": f"{batch}-{rng.choices(['06', '05', '07'], weights=[80, 10, 10])[0]}",
                "birth_date": f"{birth_year}-{rng.randint(1, 12):02d}",
                "civil_status": "Married" if rng.random() < (0.05 + 0.03 * (2024 - batch)) else "Single",
                "scholarship": rng.choice(SCHOLARSHIPS) if row["scholarship"] else "",
                "academic_honors": None if _missing(row["academic_honors"]) else int(row["academic_honors"]),
                "prior_work_experience": (not _missing(row["prior_work_experience"])) and bool(row["prior_work_experience"]),
                "ojt_relevance": None if _missing(row["ojt_relevance"]) else int(row["ojt_relevance"]),
                "has_portfolio": (not _missing(row["has_portfolio"])) and bool(row["has_portfolio"]),
                "further_studies": postgrad,
                "status": status,
                "tth": tth, "tth_raw": tth_raw,
                "first_job": first_job,
                "current_job": current_job,
                "home": home,
                "geomap_consent": rng.random() < 0.85,
                "technical_skills": rng.sample(tech_pool, min(tech_n, len(tech_pool))),
                "soft_skills": rng.sample(list(employability.SOFT_SKILLS), min(soft_n, len(employability.SOFT_SKILLS))),
                "reviewed_days_ago": rng.randint(1, 60),
                "retraced_days_ago": rng.randint(1, 540),
            })
        return plans

    def _frame(self, plans: list[dict]):
        """The frame build_graduate_frame would return for these graduates, for
        checking a seed against the gate before anything is written."""
        import pandas as pd

        now = timezone.now()
        rows = []
        for p in plans:
            months = employability.months_since_graduation(p["graduation_date"], p["batch"], now)
            status = p["status"]
            employed_now = 1 if status in employability.EMPLOYED_STATUSES else (
                0 if status in employability.LOOKING_STATUSES | employability.OUT_OF_LABOR_FORCE_STATUSES else None
            )
            rows.append({
                "alumni_id": p["email"], "batch": p["batch"], "gender": p["gender"].lower(),
                "months_since_graduation": months,
                "academic_honors": p["academic_honors"],
                "prior_work_experience": int(p["prior_work_experience"]),
                "has_portfolio": int(p["has_portfolio"]),
                "scholarship": int(bool(p["scholarship"])),
                "employment_status": status, "has_outcome": int(employed_now is not None),
                "employed_now": employed_now,
                "in_labor_force": 0 if status in employability.OUT_OF_LABOR_FORCE_STATUSES else 1,
                "time_to_hire_months": p["tth"],
                employability.TARGET: employability.employed_within_12_months(status, p["tth"], months),
                "bsis_first": None, "bsis_current": None, "is_sample": True, "future_graduation": False,
            })
        return pd.DataFrame(rows, columns=employability.FRAME_COLUMNS)

    def _summary(self, plans: list[dict], opts: dict) -> None:
        from collections import Counter

        statuses = Counter(p["status"] for p in plans)
        batches = Counter(p["batch"] for p in plans)
        self.stdout.write(
            f"{len(plans)} simulated graduates (seed {opts['seed']}, {opts['scenario']} market, {opts['signal']} signal)"
        )
        self.stdout.write("  by batch: " + ", ".join(f"{b}: {n}" for b, n in sorted(batches.items())))
        self.stdout.write("  by status: " + ", ".join(f"{s}: {n}" for s, n in statuses.most_common()))
        self.stdout.write(f"  e.g. {plans[0]['first']} {plans[0]['last']} <{plans[0]['email']}>")

    # ── database ───────────────────────────────────────────────────────────
    def _clear(self) -> int:
        from users.models import AlumniAccount, User

        samples = AlumniAccount.objects.filter(employability.sample_q()).exclude(employability.demo_q())
        user_ids = list(samples.values_list("user_id", flat=True))
        with transaction.atomic():
            User.objects.filter(id__in=user_ids).delete()
        return len(user_ids)

    def _write(self, plans: list[dict]) -> tuple[int, int]:
        from tracer.models import (
            AlumniSkill, EmploymentProfile, EmploymentRecord, JobTitle, Skill, SkillCategory, WorkAddress,
        )
        from users.models import AccountStatus, AlumniAccount, AlumniProfile, User

        now = timezone.now()
        jitter = random.Random(len(plans))  # map pins spread around each city, reproducibly
        with transaction.atomic():
            removed = self._clear()

            categories = {
                "Technical": SkillCategory.objects.get_or_create(name="Technical")[0],
                "Soft": SkillCategory.objects.get_or_create(name="Soft")[0],
            }
            skills = {s.name.lower(): s for s in Skill.objects.all()}
            for p in plans:
                for name, kind in [(n, "Technical") for n in p["technical_skills"]] + [(n, "Soft") for n in p["soft_skills"]]:
                    if name.lower() not in skills:
                        skills[name.lower()] = Skill.objects.create(name=name, category=categories[kind])
            titles = {t.name.lower(): t for t in JobTitle.objects.filter(is_active=True)}

            users, accounts, profiles, employment, addresses, alumni_skills, records = [], [], [], [], [], [], []
            for p in plans:
                user = User(email=p["email"], role=User.Role.ALUMNI, is_active=True)
                user.set_unusable_password()
                users.append(user)
                account = AlumniAccount(
                    user=user,
                    account_status=AccountStatus.ACTIVE,
                    match_status=AlumniAccount.MatchStatus.UNMATCHED,
                    biometric_template={"is_sample": True, "sample_kind": "simulated"},
                    profile_reviewed_at=now - timedelta(days=p["reviewed_days_ago"]),
                )
                accounts.append(account)
                home = p["home"]
                profiles.append(AlumniProfile(
                    alumni=account,
                    first_name=p["first"], middle_name=p["middle"], last_name=p["last"],
                    gender=p["gender"], birth_date=p["birth_date"], civil_status=p["civil_status"],
                    city=home[0], province=home[1], home_region=home[2], home_country="Philippines",
                    home_latitude=round(home[3] + jitter.uniform(-0.02, 0.02), 6),
                    home_longitude=round(home[4] + jitter.uniform(-0.02, 0.02), 6),
                    graduation_date=p["graduation_date"], graduation_year=p["batch"],
                    scholarship=p["scholarship"], further_studies_status=p["further_studies"],
                    academic_honors=p["academic_honors"], prior_work_experience=p["prior_work_experience"],
                    ojt_relevance=p["ojt_relevance"], has_portfolio=p["has_portfolio"],
                    technical_skill_count=min(len(p["technical_skills"]), 12),
                    soft_skill_count=min(len(p["soft_skills"]), 10),
                    geomap_consent=p["geomap_consent"],
                    terms_accepted_at=now,
                    last_retraced_at=now - timedelta(days=p["retraced_days_ago"]),
                ))

                first, current = p["first_job"], p["current_job"]
                profile = EmploymentProfile(
                    alumni=account,
                    employment_status=p["status"],
                    time_to_hire_raw=p["tth_raw"] or None,
                    time_to_hire_months=p["tth"],
                    first_job_sector=first and first["sector"],
                    first_job_status=first and first["status"],
                    first_job_title=first and first["title"],
                    first_job_company=first and first["company"],
                    first_job_related_to_bsis=first["related"] if first else None,
                    first_job_applications_count=first and first["applications"],
                    first_job_source=first and first["source"],
                    current_job_sector=current["sector"] if current else None,
                    current_job_title=(current["title"] or None) if current else None,
                    current_job_company=current["company"] if current else None,
                    current_job_related_to_bsis=current["related"] if current else None,
                    location_type=current["local"] if current else None,
                    survey_completion_status="completed",
                )
                employment.append(profile)

                if current:
                    city, province, region, lat, lng, _ = current["work"]
                    addresses.append(WorkAddress(
                        alumni=account, employment_profile=profile, is_current=True,
                        city_municipality=city, province=province or "—",
                        region=region if current["local"] else "Abroad",
                        country="Philippines" if current["local"] else region,
                        latitude=round(lat + jitter.uniform(-0.015, 0.015), 6),
                        longitude=round(lng + jitter.uniform(-0.015, 0.015), 6),
                    ))
                    if current["title"] and current["company"]:
                        records.append(EmploymentRecord(
                            alumni=account,
                            employer_name_input=current["company"],
                            job_title_input=current["title"],
                            job_title=titles.get(current["title"].lower()),
                            employment_status=(
                                EmploymentRecord.EmploymentStatus.SELF_EMPLOYED if p["status"] == "self_employed"
                                else EmploymentRecord.EmploymentStatus.EMPLOYED
                            ),
                            work_location=city if current["local"] else "Abroad / Remote",
                            is_current=True,
                            verification_status=EmploymentRecord.VerificationStatus.PENDING,
                        ))

                for name in p["technical_skills"] + p["soft_skills"]:
                    alumni_skills.append(AlumniSkill(
                        alumni=account, skill=skills[name.lower()],
                        proficiency_level=AlumniSkill.Proficiency.INTERMEDIATE,
                    ))

            batch_size = 200
            User.objects.bulk_create(users, batch_size=batch_size)
            AlumniAccount.objects.bulk_create(accounts, batch_size=batch_size)
            AlumniProfile.objects.bulk_create(profiles, batch_size=batch_size)
            EmploymentProfile.objects.bulk_create(employment, batch_size=batch_size)
            WorkAddress.objects.bulk_create(addresses, batch_size=batch_size)
            EmploymentRecord.objects.bulk_create(records, batch_size=batch_size)
            AlumniSkill.objects.bulk_create(alumni_skills, batch_size=500, ignore_conflicts=True)
        return removed, len(accounts)
