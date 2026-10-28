from django.db import migrations


def forwards(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    group, _ = Group.objects.get_or_create(name="GENERAL_MANAGER")
    group.permissions.set(Permission.objects.all())


def backwards(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    group = Group.objects.filter(name="GENERAL_MANAGER").first()
    if group is not None:
        group.permissions.clear()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0016_groups_scopes_seed")]

    operations = [migrations.RunPython(forwards, backwards)]
