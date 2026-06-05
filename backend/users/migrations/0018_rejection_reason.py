from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0017_nullable_master_birth_date"),
    ]

    operations = [
        migrations.AddField(
            model_name="alumniaccount",
            name="rejection_reason",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="employeraccount",
            name="rejection_reason",
            field=models.TextField(blank=True, default=""),
        ),
    ]
