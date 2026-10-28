from django.db import migrations


PERMISSIONS = {
    "property_file.create": ("listing.create", "ساخت فایل", 10),
    "property_file.edit": ("listing.edit", "ویرایش فایل", 20),
    "property_file.assign": ("listing.assign", "واگذاری فایل به کارشناس دیگر", 30),
    "property_file.review": ("listing.review", "تأیید یا رد فایل", 40),
    "property_file.status": ("listing.status", "تغییر وضعیت فایل", 50),
}


def migrate_property_file_permissions(apps, schema_editor):
    Role = apps.get_model("accounts", "Role")
    RolePermission = apps.get_model("accounts", "RolePermission")
    alias = schema_editor.connection.alias
    through = Role.permissions.through

    for code, (legacy_code, name, sort_order) in PERMISSIONS.items():
        legacy = RolePermission.objects.using(alias).filter(code=legacy_code).first()
        current = RolePermission.objects.using(alias).filter(code=code).first()
        if legacy is not None and current is not None and legacy.pk != current.pk:
            role_ids = through.objects.using(alias).filter(
                rolepermission_id=legacy.pk
            ).values_list("role_id", flat=True)
            for role_id in role_ids:
                through.objects.using(alias).get_or_create(
                    role_id=role_id,
                    rolepermission_id=current.pk,
                )
            through.objects.using(alias).filter(rolepermission_id=legacy.pk).delete()
            legacy.delete(using=alias)
        elif current is None:
            current = legacy
        if current is not None:
            current.code = code
            current.name = name
            current.group = "فایل‌ها"
            current.group_order = 20
            current.sort_order = sort_order
            current.save(using=alias, update_fields=["code", "name", "group", "group_order", "sort_order"])


def restore_listing_permissions(apps, schema_editor):
    RolePermission = apps.get_model("accounts", "RolePermission")
    alias = schema_editor.connection.alias
    for code, (legacy_code, name, sort_order) in PERMISSIONS.items():
        permission = RolePermission.objects.using(alias).filter(code=code).first()
        if permission is not None:
            permission.code = legacy_code
            permission.name = name.replace("فایل", "آگهی")
            permission.group = "آگهی‌ها"
            permission.group_order = 20
            permission.sort_order = sort_order
            permission.save(using=alias, update_fields=["code", "name", "group", "group_order", "sort_order"])


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0019_sales_range_crm_bridge"),
    ]

    operations = [
        migrations.RunPython(migrate_property_file_permissions, restore_listing_permissions),
    ]
