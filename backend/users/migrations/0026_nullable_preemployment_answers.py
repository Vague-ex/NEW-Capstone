from django.db import migrations, models


class Migration(migrations.Migration):
    """Let the two pre-employment booleans hold NULL.

    A graduating student is not asked the academic profile before graduating, so
    these must be able to say "not answered" rather than defaulting to False.
    Both are model features, and build_graduate_frame already treats None as
    unknown. No existing row changes: every stored value is already True/False.
    """

    dependencies = [
        ("users", "0025_alumniprofile_has_graduated"),
    ]

    operations = [
        migrations.AlterField(
            model_name="alumniprofile",
            name="prior_work_experience",
            field=models.BooleanField(blank=True, default=False, null=True),
        ),
        migrations.AlterField(
            model_name="alumniprofile",
            name="has_portfolio",
            field=models.BooleanField(blank=True, default=False, null=True),
        ),
    ]
