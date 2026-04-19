from django.core.management.base import BaseCommand

from tracer.models import Industry, JobTitle, Region, Skill, SkillCategory


INDUSTRIES = [
    "IT and BPO",
    "Banking and Finance",
    "Education",
    "Government",
    "Healthcare",
    "Manufacturing",
    "Retail and E-commerce",
    "Telecommunications",
]

REGIONS = [
    ("NCR", "National Capital Region"),
    ("CAR", "Cordillera Administrative Region"),
    ("R1", "Region I - Ilocos Region"),
    ("R2", "Region II - Cagayan Valley"),
    ("R3", "Region III - Central Luzon"),
    ("R4A", "Region IV-A - CALABARZON"),
    ("R4B", "Region IV-B - MIMAROPA"),
    ("R5", "Region V - Bicol Region"),
    ("R6", "Region VI - Western Visayas"),
    ("R7", "Region VII - Central Visayas"),
    ("R8", "Region VIII - Eastern Visayas"),
    ("R9", "Region IX - Zamboanga Peninsula"),
    ("R10", "Region X - Northern Mindanao"),
    ("R11", "Region XI - Davao Region"),
    ("R12", "Region XII - SOCCSKSARGEN"),
    ("R13", "Region XIII - Caraga"),
    ("BARMM", "Bangsamoro Autonomous Region in Muslim Mindanao"),
]

SKILLS_BY_CATEGORY = {
    "BSIS Core Competencies": [
        "Programming/Software Development",
        "Database Management",
        "Network Administration",
        "Business Process Analysis",
        "Project Management",
        "Technical Support / Troubleshooting",
        "Data Analytics",
        "Web Development",
        "System Analysis and Design",
        "Communication Skills (Oral/Written)",
        "Teamwork/Collaboration",
        "Problem-solving / Critical Thinking",
    ],
    "Cloud and DevOps": [
        "Docker",
        "CI/CD",
        "AWS",
    ],
    "Data and AI": [
        "Machine Learning",
        "Power BI",
        "Tableau",
    ],
}

JOB_TITLES_BY_INDUSTRY = {
    "IT and BPO": [
        "Systems Analyst",
        "Web Developer",
        "Data Analyst",
        "Technical Support Specialist",
    ],
    "Banking and Finance": [
        "IT Auditor",
        "Business Systems Analyst",
    ],
    "Government": [
        "Information Systems Officer",
        "IT Program Assistant",
    ],
    "Education": [
        "IT Instructor",
        "Learning Management System Administrator",
    ],
}


class Command(BaseCommand):
    help = "Seed normalized tracer reference tables with baseline records."

    def handle(self, *args, **options):
        industry_map = {}
        category_map = {}

        industry_created = 0
        industry_updated = 0
        for name in INDUSTRIES:
            industry, created = Industry.objects.get_or_create(name=name)
            if created:
                industry_created += 1
            elif not industry.is_active:
                industry.is_active = True
                industry.save(update_fields=["is_active"])
                industry_updated += 1
            industry_map[name] = industry

        region_created = 0
        region_updated = 0
        for code, name in REGIONS:
            region, created = Region.objects.get_or_create(code=code, defaults={"name": name})
            if created:
                region_created += 1
            else:
                changed = False
                if region.name != name:
                    region.name = name
                    changed = True
                if not region.is_active:
                    region.is_active = True
                    changed = True
                if changed:
                    region.save(update_fields=["name", "is_active"])
                    region_updated += 1

        category_created = 0
        category_updated = 0
        for category_name in SKILLS_BY_CATEGORY:
            category, created = SkillCategory.objects.get_or_create(name=category_name)
            if created:
                category_created += 1
            elif not category.is_active:
                category.is_active = True
                category.save(update_fields=["is_active"])
                category_updated += 1
            category_map[category_name] = category

        skill_created = 0
        skill_updated = 0
        for category_name, skill_names in SKILLS_BY_CATEGORY.items():
            category = category_map[category_name]
            for skill_name in skill_names:
                skill, created = Skill.objects.get_or_create(
                    name=skill_name,
                    defaults={"category": category},
                )
                if created:
                    skill_created += 1
                    continue

                changed = False
                if skill.category_id != category.id:
                    skill.category = category
                    changed = True
                if not skill.is_active:
                    skill.is_active = True
                    changed = True
                if changed:
                    skill.save(update_fields=["category", "is_active"])
                    skill_updated += 1

        job_title_created = 0
        job_title_updated = 0
        for industry_name, job_titles in JOB_TITLES_BY_INDUSTRY.items():
            industry = industry_map.get(industry_name)
            if not industry:
                continue

            for title_name in job_titles:
                job_title, created = JobTitle.objects.get_or_create(
                    name=title_name,
                    defaults={"industry": industry},
                )
                if created:
                    job_title_created += 1
                    continue

                changed = False
                if job_title.industry_id != industry.id:
                    job_title.industry = industry
                    changed = True
                if not job_title.is_active:
                    job_title.is_active = True
                    changed = True
                if changed:
                    job_title.save(update_fields=["industry", "is_active"])
                    job_title_updated += 1

        self.stdout.write(self.style.SUCCESS("Reference data seeding complete."))
        self.stdout.write(
            f"Industries: +{industry_created} created, {industry_updated} reactivated"
        )
        self.stdout.write(
            f"Regions: +{region_created} created, {region_updated} updated/reactivated"
        )
        self.stdout.write(
            f"Skill categories: +{category_created} created, {category_updated} reactivated"
        )
        self.stdout.write(
            f"Skills: +{skill_created} created, {skill_updated} updated/reactivated"
        )
        self.stdout.write(
            f"Job titles: +{job_title_created} created, {job_title_updated} updated/reactivated"
        )
