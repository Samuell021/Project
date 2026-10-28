from django.db import migrations
from django.utils import timezone


def forwards(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    User = apps.get_model("accounts", "User")
    Role = apps.get_model("accounts", "Role")
    RolePermission = apps.get_model("accounts", "RolePermission")
    SalesRange = apps.get_model("accounts", "SalesRange")
    ManagementScope = apps.get_model("accounts", "ManagementScope")
    ScopeMembership = apps.get_model("accounts", "ScopeMembership")
    group_for_role = {"ADMIN": "GENERAL_MANAGER", "RANGE_MANAGER": "RANGE_MANAGER", "AGENT": "AGENT", "FINANCE": "FINANCE"}
    groups = {}
    for name in group_for_role.values():
        groups[name], _ = Group.objects.get_or_create(name=name)
    for user in User.objects.all():
        group_name = group_for_role.get(user.role)
        if group_name:
            user.groups.add(groups[group_name])
    finance_role, _ = Role.objects.get_or_create(code="FINANCE", defaults={"name": "مالی", "sort_order": 40, "is_locked": False})
    now = timezone.now()
    for sales_range in SalesRange.objects.all():
        scope, _ = ManagementScope.objects.get_or_create(name=sales_range.name, defaults={"legacy_range_id": sales_range.pk, "is_active": sales_range.is_active})
        if scope.legacy_range_id is None:
            scope.legacy_range_id = sales_range.pk
            scope.save(update_fields=["legacy_range_id"])
        for manager in sales_range.managers.all():
            ScopeMembership.objects.get_or_create(scope=scope, user=manager, membership_role="MANAGER", ended_at=None, defaults={"started_at": now})
        for member in sales_range.members.all():
            ScopeMembership.objects.get_or_create(scope=scope, user=member, membership_role="MEMBER", ended_at=None, defaults={"started_at": now})


def backwards(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [("accounts", "0015_alter_role_code_alter_user_role_managementscope_and_more"), ("auth", "0012_alter_user_first_name_max_length")]
    operations = [migrations.RunPython(forwards, backwards)]
