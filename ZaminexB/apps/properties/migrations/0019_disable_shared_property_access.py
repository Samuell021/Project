from django.db import migrations


def disable_legacy_sharing(apps, schema_editor):
    Property = apps.get_model("properties", "Property")
    Property.objects.filter(is_shared=True).update(is_shared=False)


class Migration(migrations.Migration):
    dependencies = [
        ("properties", "0018_index_media_lookup_columns"),
    ]

    operations = [
        migrations.RunPython(disable_legacy_sharing, migrations.RunPython.noop),
    ]
