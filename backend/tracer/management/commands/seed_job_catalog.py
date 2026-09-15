"""
Seed the admin job-title list with industries and titles beyond IT.

    python manage.py seed_job_catalog           # dry run: show what would change
    python manage.py seed_job_catalog --apply   # write it

Graduates pick their job title from this list, so it has to cover the jobs
they really hold (store clerk, security guard, freelance artist), each under
an industry. Titles follow the plain wording of the PSA's Philippine Standard
Occupational Classification rather than inventing labels.

Deliberately separate from seed_reference_data, which also rewrites Region
names and would undo the PSGC sync on a live database. This command touches
Industry and JobTitle only, and only adds: an existing title keeps its
industry and IS classification unless --move-existing is passed.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from tracer.models import EmploymentRecord, Industry, JobTitle

F = JobTitle.ISField

CATALOG: dict[str, list[tuple[str, str]]] = {
    "IT and BPO": [
        ("Software Developer", F.SOFTWARE_DEV), ("Web Developer", F.SOFTWARE_DEV),
        ("Front-End Developer", F.SOFTWARE_DEV), ("Back-End Developer", F.SOFTWARE_DEV),
        ("Full-Stack Developer", F.SOFTWARE_DEV), ("Mobile App Developer", F.SOFTWARE_DEV),
        ("Game Developer", F.SOFTWARE_DEV), ("QA Tester", F.SOFTWARE_DEV), ("UI/UX Designer", F.SOFTWARE_DEV),
        ("Systems Analyst", F.SYSTEMS_ANALYSIS), ("Business Analyst", F.SYSTEMS_ANALYSIS),
        ("IT Project Manager", F.SYSTEMS_ANALYSIS), ("Scrum Master", F.SYSTEMS_ANALYSIS),
        ("IT Consultant", F.SYSTEMS_ANALYSIS),
        ("Data Analyst", F.DATA_DB), ("Data Engineer", F.DATA_DB), ("Database Administrator", F.DATA_DB),
        ("Network Administrator", F.NETWORK_INFRA), ("Systems Administrator", F.NETWORK_INFRA),
        ("Cybersecurity Analyst", F.NETWORK_INFRA), ("Cloud Engineer", F.NETWORK_INFRA),
        ("DevOps Engineer", F.NETWORK_INFRA),
        ("IT Support Specialist", F.IT_SUPPORT), ("Technical Support Specialist", F.IT_SUPPORT),
        ("Help Desk Technician", F.IT_SUPPORT), ("Computer Technician", F.IT_SUPPORT),
        ("Customer Service Representative", F.NON_IS), ("Call Center Agent", F.NON_IS),
        ("Technical Support Representative", F.IT_SUPPORT), ("Team Leader", F.NON_IS),
        ("Quality Analyst", F.NON_IS), ("Workforce Analyst", F.NON_IS), ("Virtual Assistant", F.NON_IS),
        ("Data Encoder", F.NON_IS),
    ],
    "Banking and Finance": [
        ("IT Auditor", F.SYSTEMS_ANALYSIS), ("Business Systems Analyst", F.SYSTEMS_ANALYSIS),
        ("Bank Teller", F.NON_IS), ("Loan Officer", F.NON_IS), ("Credit Analyst", F.NON_IS),
        ("Financial Analyst", F.NON_IS), ("Accounting Staff", F.NON_IS), ("Bookkeeper", F.NON_IS),
        ("Collection Officer", F.NON_IS), ("Insurance Agent", F.NON_IS),
    ],
    "Government": [
        ("Information Systems Officer", F.SYSTEMS_ANALYSIS), ("IT Program Assistant", F.IT_SUPPORT),
        ("Administrative Aide", F.NON_IS), ("Administrative Officer", F.NON_IS), ("Clerk", F.NON_IS),
        ("Records Officer", F.NON_IS), ("Statistician", F.NON_IS), ("Social Worker", F.NON_IS),
    ],
    "Education": [
        ("IT Instructor", F.IT_SUPPORT), ("Learning Management System Administrator", F.NETWORK_INFRA),
        ("Teacher", F.NON_IS), ("Instructor", F.NON_IS), ("Professor", F.NON_IS), ("Tutor", F.NON_IS),
        ("Librarian", F.NON_IS), ("Registrar Staff", F.NON_IS), ("Research Assistant", F.NON_IS),
    ],
    "Healthcare": [
        ("Health Information Systems Specialist", F.SYSTEMS_ANALYSIS), ("Nurse", F.NON_IS),
        ("Caregiver", F.NON_IS), ("Medical Technologist", F.NON_IS), ("Pharmacy Assistant", F.NON_IS),
        ("Medical Records Officer", F.NON_IS), ("Medical Coder", F.NON_IS), ("Barangay Health Worker", F.NON_IS),
    ],
    "Manufacturing": [
        ("Production Operator", F.NON_IS), ("Machine Operator", F.NON_IS),
        ("Quality Control Inspector", F.NON_IS), ("Production Supervisor", F.NON_IS),
        ("Maintenance Technician", F.NON_IS), ("Inventory Controller", F.NON_IS),
    ],
    "Retail and E-commerce": [
        ("Store Clerk", F.NON_IS), ("Sales Associate", F.NON_IS), ("Cashier", F.NON_IS),
        ("Store Manager", F.NON_IS), ("Merchandiser", F.NON_IS), ("Inventory Clerk", F.NON_IS),
        ("Online Seller", F.NON_IS), ("E-commerce Specialist", F.NON_IS),
    ],
    "Telecommunications": [
        ("Network Engineer", F.NETWORK_INFRA), ("NOC Engineer", F.NETWORK_INFRA),
        ("Telecom Technician", F.NETWORK_INFRA), ("Field Technician", F.IT_SUPPORT),
        ("Customer Care Specialist", F.NON_IS),
    ],
    "Accommodation and Food Services": [
        ("Service Crew", F.NON_IS), ("Barista", F.NON_IS), ("Cook", F.NON_IS), ("Chef", F.NON_IS),
        ("Waiter", F.NON_IS), ("Front Desk Officer", F.NON_IS), ("Housekeeping Attendant", F.NON_IS),
        ("Restaurant Manager", F.NON_IS),
    ],
    "Arts, Media and Creative Services": [
        ("Artist", F.NON_IS), ("Visual Artist", F.NON_IS), ("Graphic Designer", F.NON_IS),
        ("Illustrator", F.NON_IS), ("Multimedia Artist", F.NON_IS), ("Animator", F.NON_IS),
        ("Video Editor", F.NON_IS), ("Photographer", F.NON_IS), ("Videographer", F.NON_IS),
        ("Content Creator", F.NON_IS), ("Social Media Manager", F.NON_IS), ("Copywriter", F.NON_IS),
        ("Writer", F.NON_IS), ("Musician", F.NON_IS),
    ],
    "Construction and Real Estate": [
        ("Construction Worker", F.NON_IS), ("Foreman", F.NON_IS), ("Draftsman", F.NON_IS),
        ("CAD Operator", F.NON_IS), ("Electrician", F.NON_IS), ("Real Estate Agent", F.NON_IS),
    ],
    "Transportation and Logistics": [
        ("Delivery Rider", F.NON_IS), ("Driver", F.NON_IS), ("Dispatcher", F.NON_IS),
        ("Logistics Coordinator", F.NON_IS), ("Warehouse Staff", F.NON_IS), ("Supply Chain Assistant", F.NON_IS),
    ],
    "Agriculture and Fisheries": [
        ("Farmer", F.NON_IS), ("Fisherfolk", F.NON_IS), ("Agricultural Technician", F.NON_IS),
        ("Farm Manager", F.NON_IS),
    ],
    "Security and Protective Services": [
        ("Security Guard", F.NON_IS), ("Security Officer", F.NON_IS), ("CCTV Operator", F.NON_IS),
        ("Police Officer", F.NON_IS), ("Soldier", F.NON_IS), ("Firefighter", F.NON_IS),
    ],
    "Professional and Business Services": [
        ("Administrative Assistant", F.NON_IS), ("Office Staff", F.NON_IS), ("Secretary", F.NON_IS),
        ("Receptionist", F.NON_IS), ("Human Resources Assistant", F.NON_IS), ("Recruiter", F.NON_IS),
        ("Marketing Assistant", F.NON_IS), ("Digital Marketing Specialist", F.NON_IS),
        ("SEO Specialist", F.NON_IS), ("Legal Assistant", F.NON_IS), ("Business Consultant", F.NON_IS),
        ("Entrepreneur", F.NON_IS), ("Business Owner", F.NON_IS), ("Freelancer", F.NON_IS),
    ],
}


class Command(BaseCommand):
    help = "Add industries and job titles (IT and non-IT) to the admin job-title list. Dry run unless --apply."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Write the changes (default is a dry run).")
        parser.add_argument(
            "--move-existing", action="store_true",
            help="Also move titles that already exist under a different industry.",
        )

    def handle(self, *args, **options):
        apply = options["apply"]
        move_existing = options["move_existing"]

        names = [title for titles in CATALOG.values() for title, _ in titles]
        duplicates = {n for n in names if names.count(n) > 1}
        if duplicates:
            raise SystemExit(f"Catalog lists these titles twice: {sorted(duplicates)}")

        plan = {"industries": [], "titles": [], "moved": [], "kept_elsewhere": [], "reactivated": []}
        with transaction.atomic():
            for industry_name, titles in CATALOG.items():
                industry = Industry.objects.filter(name__iexact=industry_name).first()
                if industry is None:
                    plan["industries"].append(industry_name)
                    industry = Industry.objects.create(name=industry_name) if apply else None

                for title_name, is_field in titles:
                    existing = JobTitle.objects.filter(name__iexact=title_name).select_related("industry").first()
                    if existing is None:
                        plan["titles"].append(f"{title_name} ({industry_name})")
                        if apply:
                            JobTitle.objects.create(name=title_name, industry=industry, is_field=is_field)
                        continue
                    if not existing.is_active:
                        plan["reactivated"].append(existing.name)
                        if apply:
                            existing.is_active = True
                            existing.save(update_fields=["is_active", "is_bsis_aligned"])
                    current = existing.industry.name if existing.industry else None
                    if current != industry_name:
                        if move_existing:
                            plan["moved"].append(f"{existing.name}: {current} -> {industry_name}")
                            if apply:
                                existing.industry = industry
                                existing.save(update_fields=["industry", "is_bsis_aligned"])
                        else:
                            plan["kept_elsewhere"].append(f"{existing.name} (stays under {current})")
            # Records whose typed title matches a listed title (in any casing)
            # get linked, so reports count them under that title.
            linked = 0
            for title in JobTitle.objects.filter(is_active=True):
                unlinked = EmploymentRecord.objects.filter(job_title__isnull=True, job_title_input__iexact=title.name)
                linked += unlinked.update(job_title=title) if apply else unlinked.count()
            plan["linked"] = linked

            if not apply:
                transaction.set_rollback(True)

        verb = "Applied" if apply else "Dry run - would apply"
        self.stdout.write(self.style.SUCCESS(f"{verb}:"))
        self.stdout.write(f"  New industries ({len(plan['industries'])}): {', '.join(plan['industries']) or '-'}")
        self.stdout.write(f"  New job titles: {len(plan['titles'])}")
        for line in plan["titles"]:
            self.stdout.write(f"    + {line}")
        self.stdout.write(f"  Employment records linked to a listed title: {plan['linked']}")
        for key, label in (("reactivated", "Reactivated"), ("moved", "Moved"), ("kept_elsewhere", "Existing title under another industry")):
            if plan[key]:
                self.stdout.write(f"  {label} ({len(plan[key])}): {'; '.join(plan[key])}")
        if not apply:
            self.stdout.write("Nothing written. Re-run with --apply to save.")
