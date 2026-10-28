from django.db import migrations


def unify_districts(apps, schema_editor):
    alias = schema_editor.connection.alias
    Legacy = apps.get_model("common", "District")
    District = apps.get_model("basics", "District")
    for row in Legacy.objects.using(alias).values().iterator():
        snapshot = {key: value.isoformat() if hasattr(value, "isoformat") else value for key, value in row.items()}
        district = District.objects.using(alias).create(name=f"common-district-{row['id']}", display_name=row["name"], city_id=None, is_active=row["is_active"], meta_data={"legacy_common_district": snapshot})
        District.objects.using(alias).filter(pk=district.pk).update(created_at=row["created_at"], updated_at=row["updated_at"])


def restore_districts(apps, schema_editor):
    alias = schema_editor.connection.alias
    Legacy = apps.get_model("common", "District")
    District = apps.get_model("basics", "District")
    for district in District.objects.using(alias).all().iterator():
        snapshot = district.meta_data.get("legacy_common_district")
        if not snapshot:
            continue
        values = dict(snapshot)
        identifier = values.pop("id")
        Legacy.objects.using(alias).update_or_create(pk=identifier, defaults=values)
        Legacy.objects.using(alias).filter(pk=identifier).update(**values)
        if district.city_id is None and not apps.get_model("properties", "Property").objects.using(alias).filter(district_id=district.pk).exists():
            district.delete(using=alias)


class Migration(migrations.Migration):
    dependencies = [("common", "0019_companysettings_brand_theme"), ("basics", "0009_alter_district_city"), ("properties", "0028_check_integer_toman_prices")]
    operations = [migrations.RunPython(unify_districts, restore_districts), migrations.DeleteModel(name="District")]
