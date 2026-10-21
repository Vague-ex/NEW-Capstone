"""Fill country_code on the work addresses written before the country picker
became a closed list.

Matched on the stored country NAME against the Country table, plus a short
alias map for the spellings the two old hardcoded dropdowns offered that are
not the ISO name ("UAE", "South Korea", "Hong Kong"). A name that matches
nothing is left blank rather than guessed: blank is visibly missing, a wrong
code is not.

One UPDATE per country rather than one per row: this runs against Supabase
through a connection pooler, where row-by-row writes take minutes.
"""

from django.db import migrations

# Spellings the old registration / edit-page lists used, mapped to the ISO name
# placedb publishes. Only the ones those two lists could actually produce.
ALIASES = {
    "uae": "United Arab Emirates",
    "u.a.e.": "United Arab Emirates",
    "south korea": "South Korea",
    "hong kong": "Hong Kong",
    "taiwan": "Taiwan",
    "united states": "United States",
    "united kingdom": "United Kingdom",
    "vietnam": "Vietnam",
    "laos": "Laos",
    "brunei": "Brunei",
}


def backfill(apps, schema_editor):
    Country = apps.get_model("tracer", "Country")
    WorkAddress = apps.get_model("tracer", "WorkAddress")

    by_name = {c.name.strip().lower(): c.code for c in Country.objects.all()}
    if not by_name:
        # sync_placedb has not been run on this database yet; nothing to match
        # against. Re-runnable, so a later run picks these rows up.
        return

    names = (
        WorkAddress.objects.filter(country_code="")
        .exclude(country="")
        .values_list("country", flat=True)
        .distinct()
    )
    for name in names:
        key = (name or "").strip().lower()
        code = by_name.get(key) or by_name.get(ALIASES.get(key, "").strip().lower())
        if not code:
            continue
        WorkAddress.objects.filter(country=name, country_code="").update(country_code=code)


def unfill(apps, schema_editor):
    apps.get_model("tracer", "WorkAddress").objects.update(country_code="")


class Migration(migrations.Migration):

    dependencies = [
        ("tracer", "0023_workaddress_country_code"),
    ]

    operations = [
        migrations.RunPython(backfill, unfill),
    ]
