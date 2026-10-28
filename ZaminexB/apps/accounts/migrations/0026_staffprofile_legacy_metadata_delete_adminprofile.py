from django.db import migrations, models


def unify_profiles(apps, schema_editor):
    alias = schema_editor.connection.alias
    Staff = apps.get_model("accounts", "StaffProfile")
    Admin = apps.get_model("accounts", "AdminProfile")
    fields = ["full_name", "mobile", "branch", "profile_image", "hired_at", "notes", "is_active"]
    for row in Admin.objects.using(alias).values().iterator():
        snapshot = {key: value.isoformat() if hasattr(value, "isoformat") else value for key, value in row.items()}
        profile = Staff.objects.using(alias).filter(user_id=row["user_id"]).first()
        created = profile is None
        conflicts = []
        if profile is None:
            values = {key: row[key] for key in fields}
            if values["mobile"] and Staff.objects.using(alias).filter(mobile=values["mobile"]).exists():
                conflicts.append("mobile")
                values["mobile"] = None
            profile = Staff.objects.using(alias).create(user_id=row["user_id"], **values)
        else:
            for key in fields:
                value = row[key]
                current = getattr(profile, key)
                if value not in (None, "") and str(value) != str(current):
                    conflicts.append(key)
            if not row["is_active"]:
                profile.is_active = False
        profile.legacy_metadata = {**profile.legacy_metadata, "admin_profile": snapshot, "created_from_admin": created, "review_required": bool(conflicts), "conflicting_fields": conflicts}
        profile.save(using=alias)


def restore_profiles(apps, schema_editor):
    alias = schema_editor.connection.alias
    Staff = apps.get_model("accounts", "StaffProfile")
    Admin = apps.get_model("accounts", "AdminProfile")
    for profile in Staff.objects.using(alias).all().iterator():
        snapshot = profile.legacy_metadata.get("admin_profile")
        if not snapshot:
            continue
        values = dict(snapshot)
        identifier = values.pop("id")
        Admin.objects.using(alias).update_or_create(pk=identifier, defaults=values)
    if schema_editor.connection.vendor == "postgresql":
        with schema_editor.connection.cursor() as cursor:
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")


class Migration(migrations.Migration):
    dependencies = [("accounts", "0025_delete_legacymanagementscope")]
    operations = [
        migrations.AddField(model_name="staffprofile", name="legacy_metadata", field=models.JSONField(blank=True, default=dict, verbose_name="سوابق پروفایل پیشین")),
        migrations.RunPython(unify_profiles, restore_profiles),
        migrations.DeleteModel(name="AdminProfile"),
    ]
