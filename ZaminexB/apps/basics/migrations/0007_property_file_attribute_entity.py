from django.db import migrations, models


def rename_attribute_entities(apps, schema_editor):
    Attribute = apps.get_model("basics", "Attribute")
    Attribute.objects.using(schema_editor.connection.alias).filter(
        entity="listing"
    ).update(entity="property_file")


def restore_attribute_entities(apps, schema_editor):
    Attribute = apps.get_model("basics", "Attribute")
    Attribute.objects.using(schema_editor.connection.alias).filter(
        entity="property_file"
    ).update(entity="listing")


class Migration(migrations.Migration):

    dependencies = [
        ("basics", "0006_seed_deal_type_versions"),
    ]

    operations = [
        migrations.RunPython(rename_attribute_entities, restore_attribute_entities),
        migrations.AlterField(
            model_name="attribute",
            name="entity",
            field=models.CharField(
                choices=[("property", "ملک"), ("property_file", "فایل")],
                db_index=True,
                default="property",
                max_length=20,
                verbose_name="مربوط به",
            ),
        ),
    ]
