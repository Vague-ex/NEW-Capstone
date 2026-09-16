from django.db import migrations, models
from django.db.models import F
from django.db.models.functions import Coalesce


def mark_existing_active_reviewed(apps, schema_editor):
    """Every account that is already active got there by an admin approving it,
    so it has been reviewed. Without this they would all land in the new
    Profile Review list."""
    AlumniAccount = apps.get_model("users", "AlumniAccount")
    # One UPDATE, not a save per row: the ALTER TABLE lock is held until this
    # migration commits, and row-by-row saves over the pooler kept it long
    # enough to time out and block the live site.
    AlumniAccount.objects.filter(
        account_status="active", profile_reviewed_at__isnull=True,
    ).update(profile_reviewed_at=Coalesce(F("updated_at"), F("created_at")))


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0023_retrackingevent"),
    ]

    operations = [
        migrations.AddField(
            model_name="alumniaccount",
            name="profile_reviewed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(mark_existing_active_reviewed, migrations.RunPython.noop),
    ]
