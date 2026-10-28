from django.db import migrations


LEGACY_FEATURE_FIELDS = {
    "rooms": "rooms",
    "floor": "floor",
    "built_year": "built_year",
}


def move_legacy_values_to_dynamic_attributes(apps, schema_editor):
    alias = schema_editor.connection.alias
    Attribute = apps.get_model("basics", "Attribute")
    PropertyTypeAttribute = apps.get_model("basics", "PropertyTypeAttribute")
    Property = apps.get_model("properties", "Property")
    PropertyAttributeValue = apps.get_model("properties", "PropertyAttributeValue")

    attributes = {}
    for name, legacy_field in LEGACY_FEATURE_FIELDS.items():
        attribute = Attribute.objects.using(alias).filter(
            name=name,
            entity="property",
        ).first()
        if attribute is None:
            continue
        Attribute.objects.using(alias).filter(pk=attribute.pk).update(
            is_core=False,
            core_field="",
        )
        attributes[name] = (attribute.pk, legacy_field)

    if not attributes:
        return

    for prop in Property.objects.using(alias).filter(
        property_type_ref__isnull=False,
    ).iterator():
        for name, (attribute_id, legacy_field) in attributes.items():
            value = getattr(prop, legacy_field)
            if value is None or (name in {"rooms", "built_year"} and value <= 0):
                continue
            is_available_for_type = PropertyTypeAttribute.objects.using(alias).filter(
                property_type_id=prop.property_type_ref_id,
                attribute_id=attribute_id,
                is_active=True,
            ).exists()
            if not is_available_for_type:
                continue
            PropertyAttributeValue.objects.using(alias).get_or_create(
                property_id=prop.pk,
                attribute_id=attribute_id,
                defaults={"value_integer": int(value)},
            )


def restore_core_feature_flags(apps, schema_editor):
    alias = schema_editor.connection.alias
    Attribute = apps.get_model("basics", "Attribute")
    for name, core_field in LEGACY_FEATURE_FIELDS.items():
        Attribute.objects.using(alias).filter(
            name=name,
            entity="property",
        ).update(is_core=True, core_field=core_field)


class Migration(migrations.Migration):
    dependencies = [
        ("basics", "0009_alter_district_city"),
        ("properties", "0030_remove_property_idx_property_deal_created_and_more"),
    ]

    operations = [
        migrations.RunPython(
            move_legacy_values_to_dynamic_attributes,
            restore_core_feature_flags,
        ),
    ]
