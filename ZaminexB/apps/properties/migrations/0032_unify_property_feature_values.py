"""Unify the two homes of ``rooms``/``floor``/``built_year``.

Migration ``0031`` moved these features from the dedicated ``Property`` columns
to type-specific attributes but only for the rows that existed at that moment.
Rows written afterwards through the legacy columns (demo data, seeds, older API
clients) kept a column value without the matching attribute, and a value stored
only as an attribute left the column at its default. This data migration makes
both representations agree for every existing property:

* a dynamic value (the current contract) is copied into the legacy column, and
* a legacy-only value is materialised as the dynamic value of the same name when
  the property type allows that feature.

New writes are kept in sync by ``apps.properties.features``.
"""
from django.db import migrations


FEATURE_FIELDS = ("rooms", "floor", "built_year")
ZERO_IS_EMPTY = {"rooms", "built_year"}


def _meaningful_column_value(name, value):
    if value is None:
        return False
    return not (name in ZERO_IS_EMPTY and value <= 0)


def unify_feature_values(apps, schema_editor):
    alias = schema_editor.connection.alias
    Attribute = apps.get_model("basics", "Attribute")
    PropertyTypeAttribute = apps.get_model("basics", "PropertyTypeAttribute")
    Property = apps.get_model("properties", "Property")
    PropertyAttributeValue = apps.get_model("properties", "PropertyAttributeValue")

    attributes = {}
    for name in FEATURE_FIELDS:
        attribute = (
            Attribute.objects.using(alias)
            .filter(name=name, entity="property", is_core=False)
            .first()
        )
        if attribute is not None:
            attributes[name] = attribute.pk

    if not attributes:
        return

    for prop in Property.objects.using(alias).iterator():
        updates = {}
        for name, attribute_id in attributes.items():
            row = (
                PropertyAttributeValue.objects.using(alias)
                .filter(property_id=prop.pk, attribute_id=attribute_id)
                .first()
            )
            if row is not None:
                stored = row.value_integer
                target = stored if stored is not None else (0 if name == "rooms" else None)
            else:
                current = getattr(prop, name)
                if not _meaningful_column_value(name, current):
                    continue
                linked = (
                    prop.property_type_ref_id is not None
                    and PropertyTypeAttribute.objects.using(alias)
                    .filter(
                        property_type_id=prop.property_type_ref_id,
                        attribute_id=attribute_id,
                        is_active=True,
                    )
                    .exists()
                )
                if not linked:
                    continue
                PropertyAttributeValue.objects.using(alias).create(
                    property_id=prop.pk,
                    attribute_id=attribute_id,
                    value_integer=int(current),
                )
                target = int(current)

            if getattr(prop, name) != target:
                updates[name] = target

        if updates:
            Property.objects.using(alias).filter(pk=prop.pk).update(**updates)


class Migration(migrations.Migration):
    dependencies = [
        ("properties", "0031_dynamicize_property_features"),
    ]

    operations = [
        migrations.RunPython(unify_feature_values, migrations.RunPython.noop),
    ]
