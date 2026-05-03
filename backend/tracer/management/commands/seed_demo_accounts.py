"""
Seed 25 verified demo alumni + 5 verified employers into the DB.

All alumni share login password "Curren" and the same face URL.
Emails follow the pattern CurrenChan1@gmail.com .. CurrenChan25@gmail.com.
5 alumni are placed internationally (KL, Jakarta, HCMC, Tokyo, Singapore) for
the geomap module; the rest are distributed across Philippine cities.
Each alumni is matched to a freshly created GraduateMasterRecord row so the
unverified-accounts page reports them as "matched".

Usage:
    python backend/manage.py seed_demo_accounts
    python backend/manage.py seed_demo_accounts --clear   # wipe first
"""

from __future__ import annotations

import random
from datetime import date, datetime, timezone as dt_tz
from uuid import uuid4

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from users.models import (
    AccountStatus,
    AlumniAccount,
    AlumniProfile,
    EmployerAccount,
    FaceScan,
    GraduateMasterRecord,
    User,
)
from tracer.models import (
    AlumniSkill,
    CompetencyProfile,
    EmploymentProfile,
    EmploymentRecord,
    Skill,
    WorkAddress,
)


FACE_URL = (
    "https://jryqufxzjsmpjfbplsyh.supabase.co/storage/v1/object/public/"
    "faceid-verification/face-registration/hazylostbruh/"
    "20260413182335839341_face_front.jpg"
)
PASSWORD = "Curren"
EMAIL_TEMPLATE = "CurrenChan{n}@gmail.com"
N_ALUMNI = 25
N_EMPLOYERS = 5

# ── Demographics pool ──────────────────────────────────────────────────────────

FIRST_NAMES = [
    "Juan", "Maria", "Jose", "Anna", "Mark", "Jasmine", "Kenji", "Liza",
    "Paolo", "Cheryl", "Miguel", "Rhea", "Daniel", "Patricia", "Carlo",
    "Angela", "Ronnie", "Bianca", "Chris", "Trisha", "Arvin", "Kara",
    "Leo", "Nicole", "Ivan",
]
LAST_NAMES = [
    "Santos", "Reyes", "Dela Cruz", "Mendoza", "Garcia", "Torres", "Nakamura",
    "Villanueva", "Cruz", "Aquino", "Ramirez", "Bautista", "Gonzales",
    "Navarro", "Lim", "Tan", "Sy", "Castillo", "Flores", "Morales",
    "Rivera", "Domingo", "Espinosa", "Yap", "Reyes",
]

# 5 international + 20 domestic = 25 total
DOMESTIC_ADDRESSES = [
    ("Bacolod City", "Negros Occidental", "Region VI", 10.6713, 122.9511),
    ("Talisay City", "Negros Occidental", "Region VI", 10.7374, 122.9664),
    ("Silay City", "Negros Occidental", "Region VI", 10.7975, 122.9749),
    ("Iloilo City", "Iloilo", "Region VI", 10.7202, 122.5621),
    ("Cebu City", "Cebu", "Region VII", 10.3157, 123.8854),
    ("Mandaue City", "Cebu", "Region VII", 10.3236, 123.9223),
    ("Davao City", "Davao del Sur", "Region XI", 7.1907, 125.4553),
    ("Quezon City", "Metro Manila", "NCR", 14.6760, 121.0437),
    ("Manila", "Metro Manila", "NCR", 14.5995, 120.9842),
    ("Makati", "Metro Manila", "NCR", 14.5547, 121.0244),
    ("Taguig", "Metro Manila", "NCR", 14.5176, 121.0509),
    ("Pasig", "Metro Manila", "NCR", 14.5764, 121.0851),
    ("Bacoor", "Cavite", "Region IV-A", 14.4590, 120.9285),
    ("Cagayan de Oro", "Misamis Oriental", "Region X", 8.4542, 124.6319),
    ("Baguio", "Benguet", "CAR", 16.4023, 120.5960),
    ("Legazpi", "Albay", "Region V", 13.1391, 123.7438),
    ("Tacloban", "Leyte", "Region VIII", 11.2447, 125.0047),
    ("General Santos", "South Cotabato", "Region XII", 6.1164, 125.1716),
    ("Zamboanga", "Zamboanga del Sur", "Region IX", 6.9214, 122.0790),
    ("Dumaguete", "Negros Oriental", "Region VII", 9.3103, 123.3087),
]

INTERNATIONAL_ADDRESSES = [
    ("Kuala Lumpur", "Federal Territory", "Abroad", "Malaysia", 3.1390, 101.6869),
    ("Jakarta", "DKI Jakarta", "Abroad", "Indonesia", -6.2088, 106.8456),
    ("Ho Chi Minh City", "Ho Chi Minh", "Abroad", "Vietnam", 10.8231, 106.6297),
    ("Tokyo", "Tokyo", "Abroad", "Japan", 35.6762, 139.6503),
    ("Singapore", "Singapore", "Abroad", "Singapore", 1.3521, 103.8198),
]

# ── Employer pool ──────────────────────────────────────────────────────────────

EMPLOYERS = [
    ("employer1@curren.co", "Accenture Philippines", "IT and BPO"),
    ("employer2@curren.co", "Globe Telecom", "Telecommunications"),
    ("employer3@curren.co", "BDO Unibank", "Banking and Finance"),
    ("employer4@curren.co", "JG Summit Holdings", "Manufacturing"),
    ("employer5@curren.co", "Ayala Corporation", "Retail and E-commerce"),
]

JOB_TITLES = [
    "Software Engineer", "Systems Analyst", "Data Analyst",
    "Network Administrator", "Business Analyst", "QA Engineer",
    "Web Developer", "IT Support Specialist", "Database Administrator",
    "Project Coordinator",
]

EMPLOYMENT_STATUSES = [
    EmploymentProfile.EmploymentStatusChoices.EMPLOYED_FULL_TIME,
    EmploymentProfile.EmploymentStatusChoices.EMPLOYED_PART_TIME,
    EmploymentProfile.EmploymentStatusChoices.SELF_EMPLOYED,
]

SECTORS = list(EmploymentProfile.SectorChoices.values)
JOB_STATUSES = list(EmploymentProfile.JobStatusChoices.values)
JOB_SOURCES = list(EmploymentProfile.JobSourceChoices.values)

TIME_TO_HIRE_BUCKETS = [
    ("Within 1 month", 1.0),
    ("1-3 months", 3.0),
    ("3-6 months", 4.5),
    ("6 months to 1 year", 9.0),
    ("1-2 years", 18.0),
]


class Command(BaseCommand):
    help = "Seed 25 verified alumni + 5 employers (demo data)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Delete existing demo alumni/employers first (admin preserved).",
        )
        parser.add_argument(
            "--seed",
            type=int,
            default=20260425,
            help="RNG seed (deterministic).",
        )

    def handle(self, *args, **options):
        rng = random.Random(options["seed"])

        if options["clear"]:
            self._wipe_demo_data()

        with transaction.atomic():
            employers = self._seed_employers()
            distribution = self._employer_assignment(rng, employers)
            skills = list(Skill.objects.filter(is_active=True))
            if not skills:
                self.stdout.write(self.style.WARNING(
                    "No skills found — run `seed_reference_data` first. Skipping skill links."
                ))

            for n in range(1, N_ALUMNI + 1):
                self._seed_alumni(n, rng, skills, distribution[n - 1])

        self.stdout.write(self.style.SUCCESS(
            f"Seeded {N_ALUMNI} alumni + {N_EMPLOYERS} employers."
        ))
        self.stdout.write("Login: CurrenChan{N}@gmail.com  /  password: Curren")

    # ── Employers ─────────────────────────────────────────────────────────────

    def _seed_employers(self) -> list[EmployerAccount]:
        out: list[EmployerAccount] = []
        for email, name, industry in EMPLOYERS:
            user, _ = User.objects.get_or_create(
                email=email,
                defaults={"role": User.Role.EMPLOYER, "is_active": True},
            )
            user.set_password(PASSWORD)
            user.role = User.Role.EMPLOYER
            user.is_active = True
            user.save()

            emp, _ = EmployerAccount.objects.get_or_create(
                user=user,
                defaults={
                    "company_email": email,
                    "company_name": name,
                    "industry": industry,
                    "contact_name": "HR Manager",
                    "contact_position": "Hiring Lead",
                    "company_website": f"https://{name.lower().replace(' ', '')}.ph",
                    "company_phone": "+63 2 000 0000",
                    "company_address": "Manila, Philippines",
                    "account_status": AccountStatus.ACTIVE,
                },
            )
            emp.account_status = AccountStatus.ACTIVE
            emp.company_email = email
            emp.company_name = name
            emp.save()
            out.append(emp)
        return out

    def _employer_assignment(self, rng: random.Random, employers: list[EmployerAccount]) -> list[EmployerAccount]:
        """Vary alumni-per-employer: sizes [3,4,5,6,7] = 25 total."""
        sizes = [3, 4, 5, 6, 7]
        order = list(range(len(employers)))
        rng.shuffle(order)
        assignment: list[EmployerAccount] = []
        for size, idx in zip(sizes, order):
            assignment.extend([employers[idx]] * size)
        rng.shuffle(assignment)
        return assignment

    # ── Alumni ────────────────────────────────────────────────────────────────

    def _seed_alumni(
        self,
        n: int,
        rng: random.Random,
        skills: list[Skill],
        employer: EmployerAccount,
    ) -> None:
        email = EMAIL_TEMPLATE.format(n=n)
        first = FIRST_NAMES[(n - 1) % len(FIRST_NAMES)]
        last = LAST_NAMES[(n - 1) % len(LAST_NAMES)]
        full_name = f"{first} {last}"
        grad_year = rng.choice([2020, 2021, 2022, 2023, 2024, 2025])
        gender_label = rng.choice(["Male", "Female"])
        birth_year = grad_year - rng.randint(21, 25)
        birth_dt = date(birth_year, rng.randint(1, 12), rng.randint(1, 28))

        # User + auth
        user, _ = User.objects.get_or_create(
            email=email,
            defaults={"role": User.Role.ALUMNI, "is_active": True},
        )
        user.set_password(PASSWORD)
        user.role = User.Role.ALUMNI
        user.is_active = True
        user.save()

        # Masterlist record (one per demo alumni)
        master, _ = GraduateMasterRecord.objects.get_or_create(
            full_name=full_name,
            batch_year=grad_year,
            defaults={
                "last_name": last,
                "birth_date": birth_dt,
                "is_active": True,
            },
        )

        # AlumniAccount -> matched
        alumni, _ = AlumniAccount.objects.get_or_create(
            user=user,
            defaults={
                "master_record": master,
                "face_photo_url": FACE_URL,
                "biometric_template": {"descriptor": [0.0] * 128},
                "account_status": AccountStatus.ACTIVE,
                "match_status": AlumniAccount.MatchStatus.MATCHED,
                "matched_at": timezone.now(),
            },
        )
        alumni.master_record = master
        alumni.face_photo_url = FACE_URL
        alumni.account_status = AccountStatus.ACTIVE
        alumni.match_status = AlumniAccount.MatchStatus.MATCHED
        alumni.matched_at = alumni.matched_at or timezone.now()
        if not alumni.biometric_template:
            alumni.biometric_template = {"descriptor": [0.0] * 128}
        alumni.save()

        # Face scan record
        FaceScan.objects.get_or_create(
            alumni=alumni,
            scan_type="face_front",
            defaults={"url": FACE_URL, "captured_at": timezone.now()},
        )

        # Profile
        avg = rng.randint(1, 5)
        honors_map = {5: 4, 4: 3, 3: 2, 2: 1, 1: 1}
        profile_defaults = dict(
            first_name=first,
            middle_name="",
            last_name=last,
            gender=gender_label,
            birth_date=birth_dt.strftime("%m/%d"),
            civil_status=rng.choice(["Single", "Married"]),
            mobile=f"+63 9{rng.randint(10,99)} {rng.randint(100,999)} {rng.randint(1000,9999)}",
            city="Bacolod City",
            province="Negros Occidental",
            graduation_date=f"06/{rng.randint(1,28):02d}",
            graduation_year=grad_year,
            scholarship=rng.choice(["", "CHED Scholar", "DOST Scholar", "University Scholar"]),
            highest_attainment="Graduate",
            general_average_range=avg,
            academic_honors=honors_map[avg],
            prior_work_experience=rng.random() < 0.45,
            ojt_relevance=rng.choice([2, 3, 3, 3]),
            has_portfolio=rng.random() < 0.55,
            english_proficiency=rng.choice([2, 3, 3]),
            technical_skill_count=rng.randint(4, 10),
            soft_skill_count=rng.randint(3, 8),
            professional_certifications=[],
        )
        AlumniProfile.objects.update_or_create(alumni=alumni, defaults=profile_defaults)

        # Work address (first 5 alumni = international)
        is_international = n <= 5
        if is_international:
            city, prov, region, country, lat, lng = INTERNATIONAL_ADDRESSES[n - 1]
        else:
            idx = (n - 6) % len(DOMESTIC_ADDRESSES)
            city, prov, region, lat, lng = DOMESTIC_ADDRESSES[idx]
            country = "Philippines"

        # Employment profile
        tth_label, tth_months = rng.choice(TIME_TO_HIRE_BUCKETS)
        emp_profile_defaults = dict(
            employment_status=rng.choice(EMPLOYMENT_STATUSES),
            time_to_hire_raw=tth_label,
            time_to_hire_months=tth_months,
            first_job_sector=rng.choice(SECTORS),
            first_job_status=rng.choice(JOB_STATUSES),
            first_job_title=rng.choice(JOB_TITLES),
            first_job_related_to_bsis=rng.random() < 0.7,
            first_job_duration_months=rng.randint(6, 36),
            first_job_applications_count=rng.randint(1, 4),
            first_job_source=rng.choice(JOB_SOURCES),
            current_job_sector=rng.choice(SECTORS),
            current_job_title=rng.choice(JOB_TITLES),
            current_job_company=employer.company_name,
            current_job_related_to_bsis=rng.random() < 0.75,
            location_type=not is_international,
            survey_completion_status="completed",
        )
        emp_prof, _ = EmploymentProfile.objects.update_or_create(
            alumni=alumni, defaults=emp_profile_defaults,
        )

        # Work address row (geomapping)
        WorkAddress.objects.update_or_create(
            alumni=alumni,
            is_current=True,
            defaults=dict(
                employment_profile=emp_prof,
                street_address="",
                barangay="",
                city_municipality=city,
                province=prov,
                region=region,
                country=country,
                latitude=lat,
                longitude=lng,
            ),
        )

        # Competency profile (denormalised counts + JSON arrays)
        tech_count = profile_defaults["technical_skill_count"]
        soft_count = profile_defaults["soft_skill_count"]
        tech_pool = [
            "Programming/Software Development", "Database Management",
            "Network Administration", "Data Analytics", "Web Development",
            "System Analysis and Design", "Project Management",
            "Technical Support / Troubleshooting", "Cybersecurity", "Cloud",
            "Mobile Dev", "DevOps",
        ]
        soft_pool = [
            "Oral Communication", "Written Communication", "Teamwork",
            "Problem-solving", "Leadership", "Adaptability",
            "Time Management", "Critical Thinking", "Creativity", "Work Ethic",
        ]
        CompetencyProfile.objects.update_or_create(
            alumni=alumni,
            defaults=dict(
                technical_skills=[
                    {"name": s, "selected": True} for s in tech_pool[:tech_count]
                ],
                soft_skills=[
                    {"name": s, "selected": True} for s in soft_pool[:soft_count]
                ],
                technical_skill_count=tech_count,
                soft_skill_count=soft_count,
                professional_certifications="",
            ),
        )

        # AlumniSkill rows against reference Skill table (if available)
        if skills:
            chosen = rng.sample(skills, k=min(len(skills), rng.randint(3, 8)))
            for sk in chosen:
                AlumniSkill.objects.get_or_create(
                    alumni=alumni,
                    skill=sk,
                    defaults={"proficiency_level": rng.choice([
                        AlumniSkill.Proficiency.BEGINNER,
                        AlumniSkill.Proficiency.INTERMEDIATE,
                        AlumniSkill.Proficiency.ADVANCED,
                    ])},
                )

        # Employment record linking alumni -> employer
        EmploymentRecord.objects.update_or_create(
            alumni=alumni,
            is_current=True,
            defaults=dict(
                employer_account=employer,
                employer_name_input=employer.company_name,
                job_title_input=emp_profile_defaults["current_job_title"],
                employment_status=EmploymentRecord.EmploymentStatus.EMPLOYED,
                work_location=f"{city}, {country}",
                verification_status=EmploymentRecord.VerificationStatus.VERIFIED,
            ),
        )

    # ── Cleanup ───────────────────────────────────────────────────────────────

    def _wipe_demo_data(self):
        demo_emails = [EMAIL_TEMPLATE.format(n=n) for n in range(1, N_ALUMNI + 1)]
        demo_emails += [e for e, *_ in EMPLOYERS]
        qs = User.objects.filter(email__in=demo_emails)
        count = qs.count()
        qs.delete()
        # Orphaned master records we created
        GraduateMasterRecord.objects.filter(
            full_name__in=[
                f"{FIRST_NAMES[(n - 1) % len(FIRST_NAMES)]} "
                f"{LAST_NAMES[(n - 1) % len(LAST_NAMES)]}"
                for n in range(1, N_ALUMNI + 1)
            ],
        ).delete()
        self.stdout.write(self.style.WARNING(f"Cleared {count} demo users."))
