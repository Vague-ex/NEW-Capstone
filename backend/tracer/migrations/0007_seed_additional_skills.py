from django.db import migrations


ADDITIONAL_CATEGORIES = {
    'Web Development': ['HTML/CSS', 'React', 'Vue.js', 'Angular', 'Next.js', 'Tailwind CSS', 'Bootstrap', 'JavaScript', 'TypeScript'],
    'Backend': ['Node.js', 'Laravel', 'Django', 'Spring Boot', '.NET / C#', 'PHP', 'Python', 'Java', 'Express.js'],
    'Mobile': ['Flutter / Dart', 'React Native', 'Android (Java)', 'iOS / Swift', 'Kotlin'],
    'Database': ['MySQL', 'PostgreSQL', 'MongoDB', 'Oracle DB', 'SQL Server', 'Redis', 'Firebase'],
    'Cloud & DevOps': ['AWS', 'Azure', 'Google Cloud', 'Docker', 'Kubernetes', 'CI/CD', 'Git / GitHub'],
    'Data & AI': ['Python (Data)', 'Machine Learning', 'Data Analysis', 'Tableau', 'Power BI', 'TensorFlow', 'SQL'],
    'Cybersecurity': ['Network Security', 'Penetration Testing', 'SOC', 'SIEM', 'Ethical Hacking', 'Firewall'],
    'Project Mgmt Tools': ['Agile / Scrum', 'JIRA', 'Trello', 'PMP', 'Risk Management', 'Confluence'],
    'Design': ['UI/UX Design', 'Figma', 'Adobe XD', 'Photoshop', 'Canva'],
    'Networking': ['Cisco Networking', 'CCNA', 'Network Admin', 'Linux', 'VPN', 'OSPF'],
}


def seed(apps, schema_editor):
    SkillCategory = apps.get_model('tracer', 'SkillCategory')
    Skill = apps.get_model('tracer', 'Skill')
    for category_name, skills in ADDITIONAL_CATEGORIES.items():
        category, _ = SkillCategory.objects.get_or_create(
            name=category_name,
            defaults={'is_active': True},
        )
        for skill_name in skills:
            Skill.objects.get_or_create(
                name=skill_name,
                defaults={'category': category, 'is_active': True},
            )


def unseed(apps, schema_editor):
    SkillCategory = apps.get_model('tracer', 'SkillCategory')
    Skill = apps.get_model('tracer', 'Skill')
    skill_names = {s for skills in ADDITIONAL_CATEGORIES.values() for s in skills}
    Skill.objects.filter(name__in=skill_names).delete()
    SkillCategory.objects.filter(name__in=ADDITIONAL_CATEGORIES.keys()).delete()


class Migration(migrations.Migration):
    dependencies = [
        ('tracer', '0006_employmentprofile_workaddress_competencyprofile'),
        # 0005 fans out into two parallel 0006 branches. This one carries the
        # actual CreateModel operations for CompetencyProfile / EmploymentProfile
        # / WorkAddress, but nothing depended on it, leaving it a dangling leaf.
        # That had two consequences: `makemigrations` saw two leaf nodes and
        # refused to run, and because those models were absent from migration
        # state it kept regenerating them as phantom CreateModel operations.
        # Both 0006s are already applied everywhere, so joining them here is
        # ordering metadata only — no schema change.
        ('tracer', '0006_competencyprofile_employmentprofile_workaddress_and_more'),
    ]

    operations = [
        migrations.RunPython(seed, reverse_code=unseed),
    ]
