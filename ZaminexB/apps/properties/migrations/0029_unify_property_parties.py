from django.db import migrations, models


def unify_owners(apps, schema_editor):
    alias = schema_editor.connection.alias
    Property = apps.get_model("properties", "Property")
    Party = apps.get_model("crm", "PropertyParty")
    Contact = apps.get_model("crm", "Contact")
    Phone = apps.get_model("crm", "ContactPhone")
    from apps.crm.phones import normalize_phone

    for prop in Property.objects.using(alias).all().iterator():
        snapshot = {key: getattr(prop, key) for key in ("owner_first_name", "owner_last_name", "owner_phone")}
        prop.legacy_data = {**prop.legacy_data, "owner": snapshot}
        prop.save(update_fields=["legacy_data"], using=alias)
        if Party.objects.using(alias).filter(property_id=prop.pk, role="OWNER", ended_at__isnull=True).exists():
            continue
        name = f"{prop.owner_first_name} {prop.owner_last_name}".strip()
        if not name and not prop.owner_phone:
            continue
        contact = Contact.objects.using(alias).create(full_name=name or prop.owner_phone, created_by_id=prop.consultant_id)
        normalized = normalize_phone(prop.owner_phone)
        if normalized:
            Phone.objects.using(alias).create(contact=contact, phone=prop.owner_phone, normalized_phone=normalized, is_primary=True)
        Party.objects.using(alias).create(property_id=prop.pk, contact=contact, role="OWNER", is_primary=True)


def restore_owners(apps, schema_editor):
    Property = apps.get_model("properties", "Property")
    alias = schema_editor.connection.alias
    for prop in Property.objects.using(alias).all().iterator():
        snapshot = prop.legacy_data.get("owner", {})
        Property.objects.using(alias).filter(pk=prop.pk).update(**snapshot)


class Migration(migrations.Migration):
    dependencies = [("properties", "0027_alter_property_consultant"), ("properties", "0028_check_integer_toman_prices"), ("crm", "0009_propertyparty_ended_at")]
    operations = [
        migrations.AddField(model_name="property", name="legacy_data", field=models.JSONField(default=dict, blank=True, verbose_name="بایگانی اطلاعات پیشین")),
        migrations.RunPython(unify_owners, restore_owners),
        migrations.RemoveField(model_name="property", name="owner_first_name"),
        migrations.RemoveField(model_name="property", name="owner_last_name"),
        migrations.RemoveField(model_name="property", name="owner_phone"),
    ]
