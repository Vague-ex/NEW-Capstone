from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0009_alumnniprofile_expanded_survey"),
    ]

    operations = [
        migrations.AddField(
            model_name="loginaudit",
            name="gps_lat",
            field=models.DecimalField(blank=True, decimal_places=6, max_digits=9, null=True),
        ),
        migrations.AddField(
            model_name="loginaudit",
            name="gps_lng",
            field=models.DecimalField(blank=True, decimal_places=6, max_digits=9, null=True),
        ),
        migrations.AddField(
            model_name="loginaudit",
            name="gps_accuracy_m",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="alumniprofile",
            name="last_retracking_reminder_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
