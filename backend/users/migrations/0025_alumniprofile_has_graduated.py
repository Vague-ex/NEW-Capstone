from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0024_alumniaccount_profile_reviewed_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="alumniprofile",
            name="has_graduated",
            field=models.BooleanField(default=True),
        ),
    ]
