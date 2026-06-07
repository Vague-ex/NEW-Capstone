"""
Seed sample (masterlist) alumni so the predictive analytics + geomap have
volume for the pre-oral defense.

Each sample alumnus is a verified AlumniAccount tied to a real GraduateMasterRecord
(MATCHED), with an AlumniProfile + EmploymentProfile populated with the 17
predictor features and 4 target outcomes the model trains on, plus a WorkAddress
(city + coordinates) so they appear on the map — but NO face scans. They are
tagged in ``biometric_template`` as ``{"is_sample": true}`` so the admin verified
list can hide/show them behind a filter. No schema change.

Usage:
    python manage.py seed_sample_alumni                # ~60 from the masterlist
    python manage.py seed_sample_alumni --count 80
    python manage.py seed_sample_alumni --clear        # delete existing samples
"""
import json
import random

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from users.models import User, AlumniAccount, AlumniProfile, AccountStatus, GraduateMasterRecord, EmployerAccount
from tracer.models import EmploymentProfile, WorkAddress, CompetencyProfile, Skill

SAMPLE_EMAIL_DOMAIN = "sample.masterlist.local"

# Fictional name pools for demo accounts. We deliberately do NOT use the real
# masterlist names (privacy / taste): seeded demo graduates get made-up but
# plausible Filipino names instead. Combinations are random so they don't
# correspond to any real person on the masterlist.
FIRST_NAMES_M = [
    "Mateo", "Gabriel", "Rafael", "Lance", "Joaquin", "Emilio", "Andres",
    "Carlo", "Diego", "Marco", "Paolo", "Enrique", "Vicente", "Rommel", "Kurt",
]
FIRST_NAMES_F = [
    "Bea", "Sofia", "Camille", "Andrea", "Patricia", "Isabel", "Mariel",
    "Trisha", "Angeline", "Kristine", "Danica", "Joy", "Mae", "Hannah", "Liza",
]
SURNAMES = [
    "Reyes", "Santos", "Cruz", "Bautista", "Villanueva", "Mercado", "Aquino",
    "Delos Santos", "Garcia", "Ramos", "Flores", "Gonzales", "Torres", "Castillo",
    "Domingo", "Salvador", "Navarro", "Espinosa", "Fernandez", "Lim",
]

SECTORS = ["government", "private", "entrepreneurial"]
JOB_STATUSES = ["regular", "probationary", "contractual", "self_employed"]
JOB_SOURCES = ["personal_network", "online_portal", "career_fair", "walk_in", "social_media", "other"]
TTH_LABELS = {1: "Within 1 month", 3: "1-3 months", 4.5: "3-6 months", 9: "6 months to 1 year", 18: "1 - 2 years", 30: "More than 2 years"}

# (city, province, region, lat, lng, is_local)
CITIES = [
    ("Bacolod City", "Negros Occidental", "Region VI", 10.6770, 122.9560, True),
    ("Silay City", "Negros Occidental", "Region VI", 10.7969, 122.9747, True),
    ("Talisay City", "Negros Occidental", "Region VI", 10.7375, 122.9669, True),
    ("Bago City", "Negros Occidental", "Region VI", 10.5333, 122.8333, True),
    ("Iloilo City", "Iloilo", "Region VI", 10.7202, 122.5621, True),
    ("Cebu City", "Cebu", "Region VII", 10.3157, 123.8854, True),
    ("Manila", "Metro Manila", "NCR", 14.5995, 120.9842, True),
    ("Quezon City", "Metro Manila", "NCR", 14.6760, 121.0437, True),
    ("Makati", "Metro Manila", "NCR", 14.5547, 121.0244, True),
    ("Davao City", "Davao del Sur", "Region XI", 7.1907, 125.4553, True),
    ("Singapore", "Singapore", "Abroad", 1.3521, 103.8198, False),
    ("Dubai", "Dubai", "Abroad", 25.2048, 55.2708, False),
]


class Command(BaseCommand):
    help = "Seed masterlist-derived sample alumni (employment + skills + location, no scans) for the demo."

    def add_arguments(self, parser):
        parser.add_argument("--count", type=int, default=60)
        parser.add_argument("--clear", action="store_true")
        parser.add_argument("--seed", type=int, default=42)
        parser.add_argument(
            "--grad-year",
            type=int,
            default=None,
            help=(
                "Force every seeded graduate to this graduation year, overriding "
                "the masterlist batch year. Use a distinct --seed (e.g. --seed 2025) "
                "so the generated emails don't collide with existing samples."
            ),
        )

    def _is_sample(self, account: AlumniAccount) -> bool:
        try:
            tpl = account.biometric_template
            tpl = json.loads(tpl) if isinstance(tpl, str) else (tpl or {})
            return bool(isinstance(tpl, dict) and tpl.get("is_sample"))
        except (ValueError, TypeError):
            return False

    def _clear(self) -> int:
        n = 0
        for acc in AlumniAccount.objects.select_related("user").all():
            if self._is_sample(acc):
                user = acc.user
                acc.delete()
                if user:
                    user.delete()
                n += 1
        return n

    @transaction.atomic
    def handle(self, *args, **opts):
        if opts["clear"]:
            removed = self._clear()
            self.stdout.write(self.style.SUCCESS(f"Removed {removed} sample alumni."))
            return

        rng = random.Random(opts["seed"])
        count = opts["count"]

        # Real companies from the DB so seeded graduates "work" at places that
        # actually exist in the system (falls back to a small default list).
        companies = sorted({
            c.strip() for c in EmployerAccount.objects.values_list("company_name", flat=True)
            if c and c.strip().lower() not in {"test"}
        })
        if not companies:
            companies = ["Accenture Philippines", "Globe Telecom", "Concentrix", "BDO Unibank"]

        # Real named skills from the Skill reference table, split technical vs
        # soft, junk/test entries filtered out. Populates CompetencyProfile so
        # the skills-trend forecast has actual data to work with.
        def _clean_skill(name):
            n = (name or "").strip()
            low = n.lower()
            return n if (n and "curren" not in low and "lovemaking" not in low) else None
        soft_pool, tech_pool = [], []
        for s_name, s_cat in Skill.objects.values_list("name", "category__name"):
            cn = _clean_skill(s_name)
            if not cn:
                continue
            (soft_pool if (s_cat or "").strip().lower() == "soft" else tech_pool).append(cn)
        soft_pool = sorted(set(soft_pool)) or ["Communication", "Teamwork", "Adaptability"]
        tech_pool = sorted(set(tech_pool)) or ["Python", "SQL", "HTML/CSS", "Java"]

        # Pull masterlist records that don't yet have an account, so the samples
        # correspond to real masterlist graduates.
        masters = list(GraduateMasterRecord.objects.filter(alumni_accounts__isnull=True).order_by("batch_year"))
        rng.shuffle(masters)
        masters = masters[:count]
        created = 0

        for i, master in enumerate(masters):
            email = f"sample+{opts['seed']}_{i}@{SAMPLE_EMAIL_DOMAIN}"
            if User.objects.filter(email__iexact=email).exists():
                continue

            # Fictional name (never the real masterlist name). Pick gender
            # first so the given name matches it.
            gender = rng.choice(["Male", "Female"])
            first = rng.choice(FIRST_NAMES_M if gender == "Male" else FIRST_NAMES_F)
            middle = rng.choice(SURNAMES)
            last = rng.choice(SURNAMES)
            # Even spread across 2020–2025 for a clean trend line (unless a
            # specific --grad-year was requested).
            year = opts.get("grad_year") or (2020 + (i % 6))

            # --- predictor features ---
            grades = rng.randint(0, 5)
            ojt = rng.randint(0, 3)
            tech = rng.randint(0, 12)
            soft = rng.randint(0, 10)
            portfolio = rng.random() < 0.45
            prior_work = rng.random() < 0.4
            honors = rng.choices([1, 2, 3, 4], weights=[70, 18, 8, 4])[0]
            base_ability = grades + ojt + tech / 3 + soft / 4 + (2 if portfolio else 0) + (1 if prior_work else 0)
            # Rising employability: later batches are more likely employed and
            # hired faster, but capped below 100% so no batch looks fake. This
            # gives the trend report a healthy upward slope (~63% → ~90%).
            year_lift = (year - 2020) * 0.055           # +0 (2020) … +0.275 (2025)
            emp_prob = max(0.45, min(0.92, 0.40 + base_ability * 0.03 + year_lift))
            is_employed = rng.random() < emp_prob

            if is_employed:
                # Stronger graduates and later batches tend to hire faster.
                fast = base_ability >= 8 or rng.random() < (0.25 + year_lift)
                if fast:
                    emp_status = rng.choices(["employed_full_time", "self_employed"], weights=[85, 15])[0]
                    tth = rng.choice([1, 3]); apps = rng.randint(1, 2); related = rng.random() < 0.85
                else:
                    emp_status = rng.choices(["employed_full_time", "employed_part_time", "self_employed"], weights=[60, 25, 15])[0]
                    tth = rng.choice([3, 4.5, 9]); apps = rng.randint(2, 3); related = rng.random() < 0.6
            else:
                emp_status = rng.choices(["seeking", "not_seeking"], weights=[70, 30])[0]
                tth = None; apps = rng.randint(3, 4); related = rng.random() < 0.3
            sector = rng.choice(SECTORS)
            company = rng.choice(companies)
            city, province, region, lat, lng, is_local = rng.choice(CITIES if is_employed else CITIES[:10])

            user = User.objects.create_user(email=email, password=None, role=User.Role.ALUMNI)
            user.set_unusable_password()
            user.save(update_fields=["password"])

            account = AlumniAccount.objects.create(
                user=user,
                master_record=master,
                match_status=AlumniAccount.MatchStatus.MATCHED,
                matched_at=timezone.now(),
                account_status=AccountStatus.ACTIVE,
                face_photo_url="",
                biometric_template=json.dumps({"is_sample": True}),
            )

            AlumniProfile.objects.create(
                alumni=account, first_name=first, middle_name=middle, last_name=last,
                gender=gender,
                graduation_year=year, graduation_date=f"{year}-06",
                city=city if is_local else "", province=province if is_local else "",
                scholarship=rng.choice(["", "", "CHED Scholar", "SUC Scholar"]),
                further_studies_status=rng.choices(["none", "enrolled", "completed"], weights=[80, 12, 8])[0],
                general_average_range=grades, academic_honors=honors,
                prior_work_experience=prior_work, ojt_relevance=ojt, has_portfolio=portfolio,
                technical_skill_count=tech, soft_skill_count=soft,
            )

            # Named skills (real reference skills) so the skills-trend forecast
            # has data; selection count matches the profile's skill counts.
            sel_tech = rng.sample(tech_pool, min(tech, len(tech_pool)))
            sel_soft = rng.sample(soft_pool, min(soft, len(soft_pool)))
            CompetencyProfile.objects.create(
                alumni=account,
                technical_skills=[{"name": s, "selected": True} for s in sel_tech],
                soft_skills=[{"name": s, "selected": True} for s in sel_soft],
                technical_skill_count=len(sel_tech),
                soft_skill_count=len(sel_soft),
            )

            EmploymentProfile.objects.create(
                alumni=account, employment_status=emp_status,
                time_to_hire_raw=TTH_LABELS.get(tth, ""), time_to_hire_months=tth,
                first_job_sector=sector, first_job_status=rng.choice(JOB_STATUSES),
                first_job_title=rng.choice(["Junior Developer", "IT Support", "Systems Analyst", "QA Tester", "Web Developer"]),
                first_job_related_to_bsis=related, first_job_applications_count=apps,
                first_job_source=rng.choice(JOB_SOURCES),
                current_job_sector=sector if is_employed else "",
                current_job_title=("Software Developer" if is_employed else ""),
                current_job_company=(company if is_employed else ""),
                current_job_related_to_bsis=(related if is_employed else None),
                location_type=is_local,
            )

            if is_employed:
                WorkAddress.objects.create(
                    alumni=account, city_municipality=city, province=province, region=region,
                    country=("Philippines" if is_local else city), latitude=lat, longitude=lng,
                    is_current=True,
                )
            created += 1

        self.stdout.write(self.style.SUCCESS(
            f"Created {created} masterlist sample alumni (MATCHED, with employment + skills + map location, no scans)."
        ))
