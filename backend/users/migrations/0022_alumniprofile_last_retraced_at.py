from django.db import migrations, models
from django.db.models import OuterRef, Subquery


def backfill_last_retraced_at(apps, schema_editor):
    """Seed the clock from the latest employment save, the only signal older rows have."""
    AlumniProfile = apps.get_model("users", "AlumniProfile")
    EmploymentProfile = apps.get_model("tracer", "EmploymentProfile")
    latest_save = (
        EmploymentProfile.objects.filter(alumni_id=OuterRef("alumni_id"))
        .order_by("-updated_at")
        .values("updated_at")[:1]
    )
    AlumniProfile.objects.filter(last_retraced_at__isnull=True).update(
        last_retraced_at=Subquery(latest_save)
    )


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0021_alumniprofile_profile_names_have_no_digits_and_more"),
        ("tracer", "0016_employmentprofile_employment_time_to_hire_is_survey_option_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="alumniprofile",
            name="last_retraced_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(backfill_last_retraced_at, migrations.RunPython.noop),
    ]
