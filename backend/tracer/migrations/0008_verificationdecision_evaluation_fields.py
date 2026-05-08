from django.db import migrations, models


RATING_CHOICES = [
    ("excellent", "Excellent"),
    ("very_good", "Very Good"),
    ("good", "Good"),
    ("fair", "Fair"),
    ("unsatisfactory", "Unsatisfactory"),
]

EMPLOYEE_STATUS_CHOICES = [
    ("regular", "Regular"),
    ("probationary_casual_jo", "Probationary/Casual/Job Order"),
    ("other", "Other"),
]


class Migration(migrations.Migration):

    dependencies = [
        ("tracer", "0007_seed_additional_skills"),
    ]

    operations = [
        migrations.AddField("verificationdecision", "evaluator_name",
                            models.CharField(blank=True, max_length=255)),
        migrations.AddField("verificationdecision", "employee_status",
                            models.CharField(blank=True, choices=EMPLOYEE_STATUS_CHOICES, max_length=30)),
        migrations.AddField("verificationdecision", "employee_status_other",
                            models.CharField(blank=True, max_length=100)),
        migrations.AddField("verificationdecision", "years_in_company",
                            models.PositiveSmallIntegerField(blank=True, null=True)),
        migrations.AddField("verificationdecision", "educational_attainment",
                            models.CharField(blank=True, max_length=100)),
        migrations.AddField("verificationdecision", "marital_status",
                            models.CharField(blank=True, max_length=20)),
        migrations.AddField("verificationdecision", "type_of_business",
                            models.CharField(blank=True, max_length=150)),
        migrations.AddField("verificationdecision", "date_of_evaluation",
                            models.DateField(blank=True, null=True)),

        migrations.AddField("verificationdecision", "rating_quality_of_work",
                            models.CharField(blank=True, choices=RATING_CHOICES, max_length=20)),
        migrations.AddField("verificationdecision", "rating_work_habits",
                            models.CharField(blank=True, choices=RATING_CHOICES, max_length=20)),
        migrations.AddField("verificationdecision", "rating_relationship_with_people",
                            models.CharField(blank=True, choices=RATING_CHOICES, max_length=20)),
        migrations.AddField("verificationdecision", "rating_dependability",
                            models.CharField(blank=True, choices=RATING_CHOICES, max_length=20)),
        migrations.AddField("verificationdecision", "rating_quantity_of_work",
                            models.CharField(blank=True, choices=RATING_CHOICES, max_length=20)),
        migrations.AddField("verificationdecision", "rating_initiative",
                            models.CharField(blank=True, choices=RATING_CHOICES, max_length=20)),
        migrations.AddField("verificationdecision", "rating_analytical_ability",
                            models.CharField(blank=True, choices=RATING_CHOICES, max_length=20)),
        migrations.AddField("verificationdecision", "rating_ability_as_supervisor",
                            models.CharField(blank=True, choices=RATING_CHOICES, max_length=20)),
        migrations.AddField("verificationdecision", "rating_administrative_ability",
                            models.CharField(blank=True, choices=RATING_CHOICES, max_length=20)),
        migrations.AddField("verificationdecision", "rating_safety",
                            models.CharField(blank=True, choices=RATING_CHOICES, max_length=20)),
        migrations.AddField("verificationdecision", "rating_commitment_to_social_equity",
                            models.CharField(blank=True, choices=RATING_CHOICES, max_length=20)),

        migrations.AddField("verificationdecision", "assessment_strengths",
                            models.TextField(blank=True)),
        migrations.AddField("verificationdecision", "assessment_improvements",
                            models.TextField(blank=True)),

        migrations.AddField("verificationdecision", "evaluation_submitted",
                            models.BooleanField(default=False)),
        migrations.AddField("verificationdecision", "evaluation_submitted_at",
                            models.DateTimeField(blank=True, null=True)),

        migrations.AddIndex(
            model_name="verificationdecision",
            index=models.Index(fields=["evaluation_submitted", "decided_at"],
                               name="tracer_vd_evalsub_idx"),
        ),
    ]
