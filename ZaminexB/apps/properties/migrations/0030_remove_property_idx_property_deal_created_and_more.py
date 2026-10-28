from django.db import migrations, models


def move_prices(apps, schema_editor):
    alias = schema_editor.connection.alias
    Property = apps.get_model("properties", "Property")
    File = apps.get_model("listings", "PropertyFile")
    DealType = apps.get_model("basics", "DealType")
    Version = apps.get_model("basics", "DealTypeVersion")
    for prop in Property.objects.using(alias).all().iterator():
        prop.legacy_data = {**prop.legacy_data, "pricing": {"price": str(prop.price) if prop.price is not None else None, "deal_type": prop.deal_type}}
        if prop.price is not None:
            prop.legacy_data["pricing_review_required"] = True
            if prop.deal_type == "SALE":
                deal_type, _ = DealType.objects.using(alias).get_or_create(name="sale", defaults={"display_name": "فروش", "family": "SALE"})
                existing = File.objects.using(alias).filter(property_id=prop.pk, deal_type=deal_type).exclude(status="ARCHIVED").first()
                if existing is None:
                    version = Version.objects.using(alias).filter(deal_type=deal_type, status="PUBLISHED").order_by("-version_number").first()
                    File.objects.using(alias).create(property_id=prop.pk, deal_type=deal_type, deal_type_version=version, sale_price=prop.price, title=prop.title, status="DRAFT", publish_channel="WEBSITE", created_by_id=prop.consultant_id, assigned_to_id=prop.consultant_id)
                    prop.legacy_data["pricing_review_required"] = False
                elif existing.sale_price == prop.price:
                    prop.legacy_data["pricing_review_required"] = False
        prop.save(update_fields=["legacy_data"], using=alias)


def restore_prices(apps, schema_editor):
    Property = apps.get_model("properties", "Property")
    alias = schema_editor.connection.alias
    for prop in Property.objects.using(alias).all().iterator():
        values = prop.legacy_data.get("pricing")
        if values:
            Property.objects.using(alias).filter(pk=prop.pk).update(**values)
    if schema_editor.connection.vendor == "postgresql":
        with schema_editor.connection.cursor() as cursor:
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")


class Migration(migrations.Migration):

    dependencies = [
        ('properties', '0029_unify_property_parties'),
        ('listings', '0013_remove_propertyfileattributevalue_uq_listing_attribute_value_and_more'),
    ]

    operations = [
        migrations.AlterField(model_name="property", name="deal_type", field=models.CharField(max_length=20, choices=[("SALE", "فروش"), ("RENT", "اجاره")], default="", verbose_name="نوع معامله")),
        migrations.RunPython(move_prices, restore_prices),
        migrations.RemoveIndex(
            model_name='property',
            name='idx_property_deal_created',
        ),
        migrations.RemoveIndex(
            model_name='property',
            name='idx_property_price',
        ),
        migrations.RemoveField(
            model_name='property',
            name='deal_type',
        ),
        migrations.RemoveField(
            model_name='property',
            name='price',
        ),
    ]
