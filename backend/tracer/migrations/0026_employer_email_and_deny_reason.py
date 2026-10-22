from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tracer", "0025_country_latitude_country_longitude_country_map_zoom"),
    ]

    operations = [
        migrations.AddField(
            model_name="employmentprofile",
            name="current_job_employer_email",
            field=models.EmailField(
                blank=True,
                help_text="Company / HR / supervisor email used to verify this employment",
                max_length=254,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="verificationdecision",
            name="deny_reason",
            field=models.CharField(
                blank=True,
                choices=[
                    ("never_employed", "Never worked at this organisation"),
                    ("resigned", "No longer employed here - resigned"),
                    ("terminated", "No longer employed here - terminated or contract ended"),
                    ("different_role", "Works here, but not in the role stated"),
                    ("cannot_confirm", "Cannot confirm - no record or not my department"),
                    ("other", "Other"),
                ],
                max_length=30,
            ),
        ),
    ]
