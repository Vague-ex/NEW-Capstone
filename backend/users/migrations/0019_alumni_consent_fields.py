from django.db import migrations, models


class Migration(migrations.Migration):
    """
    Record Data Privacy Act consent on the alumni profile.

    Both fields are purely additive and safe on existing rows: historical
    registrations predate the consent gate, so they land with
    terms_accepted_at=NULL and geomap_consent=False. That is the correct
    outcome — an alumnus who was never asked has not consented, and the map
    must treat them as opted out until they say otherwise.
    """

    dependencies = [
        ("users", "0018_rejection_reason"),
    ]

    operations = [
        migrations.AddField(
            model_name="alumniprofile",
            name="terms_accepted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="alumniprofile",
            name="geomap_consent",
            field=models.BooleanField(default=False),
        ),
    ]
