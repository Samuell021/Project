from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from django.db.models.signals import m2m_changed, post_migrate
from django.dispatch import receiver

from .models import LoginSettings, Role, SmsProviderSettings, UserRole, group_name_for_role


@receiver(post_migrate)
def ensure_auth_groups(sender, **kwargs):
    if sender.label != "accounts":
        return

    Group.objects.get_or_create(name=UserRole.ADMIN)
    Group.objects.get_or_create(name=UserRole.RANGE_MANAGER)
    Group.objects.get_or_create(name=UserRole.AGENT)


@receiver(post_migrate)
def ensure_login_singletons(sender, **kwargs):
    if sender.label != "accounts":
        return

    LoginSettings.get_solo()
    SmsProviderSettings.get_solo()


@receiver(post_migrate)
def ensure_general_manager_permissions(sender, **kwargs):
    group, _ = Group.objects.get_or_create(name="GENERAL_MANAGER")
    group.permissions.add(*Permission.objects.all())


@receiver(post_migrate)
def ensure_permission_catalog(sender, **kwargs):
    if sender.label != "accounts":
        return
    from .models import RolePermission, User
    from .permission_catalog import PERMISSION_DEFINITIONS, DEFAULT_ROLE_PERMISSIONS

    content_type = ContentType.objects.get_for_model(User)
    for code, label, category, group_order, sort_order in PERMISSION_DEFINITIONS:
        RolePermission.objects.update_or_create(code=code, defaults={"name": label, "group": category, "group_order": group_order, "sort_order": sort_order})
        Permission.objects.update_or_create(content_type=content_type, codename=code, defaults={"name": label})
    for role in Role.objects.filter(permissions_provisioned=False):
        codes = set(role.permissions.values_list("code", flat=True)) or set(DEFAULT_ROLE_PERMISSIONS.get(role.code, ()))
        group, created = Group.objects.get_or_create(name=group_name_for_role(role.code))
        if created or not group.permissions.filter(codename__contains=".").exists():
            group.permissions.add(*Permission.objects.filter(content_type=content_type, codename__in=codes))
        role.permissions_provisioned = True
        role.save(update_fields=["permissions_provisioned"])


@receiver(m2m_changed, sender=Role.permissions.through)
def synchronize_role_group_permissions(sender, instance, action, reverse, **kwargs):
    if reverse or action not in {"post_add", "post_remove", "post_clear"}:
        return
    from .models import User

    group_name = group_name_for_role(instance.code)
    group, _ = Group.objects.get_or_create(name=group_name)
    content_type = ContentType.objects.get_for_model(User)
    codes = instance.permissions.values_list("code", flat=True)
    group.permissions.set(Permission.objects.filter(content_type=content_type, codename__in=codes))
