from django.db import migrations


PERMISSIONS = (
    ("property.create", "ساخت ملک", "املاک", 10, 10),
    ("property.edit", "ویرایش ملک", "املاک", 10, 20),
    ("property.archive", "بایگانی ملک", "املاک", 10, 30),
    ("property.delete", "حذف ملک", "املاک", 10, 40),
    ("property.assign", "واگذاری ملک به کارشناس دیگر", "املاک", 10, 50),
    ("property.review", "تأیید یا رد ملک", "املاک", 10, 60),
    ("property.export", "خروجی گزارش املاک", "املاک", 10, 70),
    ("property.appraisal", "بارگذاری و حذف گزارش کارشناسی", "املاک", 10, 80),
    ("listing.create", "ساخت آگهی", "آگهی‌ها", 20, 10),
    ("listing.edit", "ویرایش آگهی", "آگهی‌ها", 20, 20),
    ("listing.assign", "واگذاری آگهی به کارشناس دیگر", "آگهی‌ها", 20, 30),
    ("listing.review", "تأیید یا رد آگهی", "آگهی‌ها", 20, 40),
    ("listing.status", "تغییر وضعیت آگهی", "آگهی‌ها", 20, 50),
    ("followup.manage", "ثبت و ویرایش پیگیری", "پیگیری‌ها", 30, 10),
    ("task.manage", "ساخت و ویرایش وظیفه", "وظایف", 40, 10),
    ("consultant.manage", "افزودن، ویرایش و حذف کارشناس", "کارشناسان", 50, 10),
    ("consultant.analytics", "مشاهده تحلیل کارشناسان", "کارشناسان", 50, 20),
    ("ticket.view_all", "مشاهده همه تیکت‌های رنج", "تیکت‌ها", 60, 10),
    ("ticket.export", "خروجی CSV تیکت‌ها", "تیکت‌ها", 60, 20),
    ("activity.view", "مشاهده گزارش فعالیت", "گزارش‌ها", 70, 10),
    ("activity.delete", "حذف گزارش فعالیت", "گزارش‌ها", 70, 20),
    ("analytics.view", "مشاهده داشبورد و تحلیل‌ها", "گزارش‌ها", 70, 30),
    ("company.edit", "ویرایش اطلاعات شرکت", "تنظیمات", 80, 10),
    ("basics.manage", "مدیریت مناطق و ویژگی‌ها", "تنظیمات", 80, 20),
    ("login.settings", "تغییر روش ورود", "تنظیمات", 80, 30),
    ("profile.edit", "ویرایش پروفایل و رمز خود", "تنظیمات", 80, 40),
)

ROLES = (
    ("ADMIN", "مدیر", 10, True),
    ("RANGE_MANAGER", "مدیر رنج", 20, False),
    ("AGENT", "کارشناس", 30, False),
)

AGENT_CODES = {
    "property.create",
    "property.edit",
    "property.archive",
    "property.delete",
    "property.export",
    "property.appraisal",
    "listing.create",
    "listing.edit",
    "listing.status",
    "followup.manage",
    "task.manage",
    "profile.edit",
}

RANGE_MANAGER_CODES = {
    code
    for code, *_rest in PERMISSIONS
    if code not in {"company.edit", "basics.manage", "login.settings"}
}

ALL_CODES = {code for code, *_rest in PERMISSIONS}


def seed_roles(apps, schema_editor):
    RolePermission = apps.get_model("accounts", "RolePermission")
    Role = apps.get_model("accounts", "Role")

    permission_objects = {}
    for code, name, group, group_order, sort_order in PERMISSIONS:
        permission, _ = RolePermission.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "group": group,
                "group_order": group_order,
                "sort_order": sort_order,
            },
        )
        permission_objects[code] = permission

    role_objects = {}
    for code, name, sort_order, is_locked in ROLES:
        role, _ = Role.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "sort_order": sort_order,
                "is_locked": is_locked,
            },
        )
        role_objects[code] = role

    role_objects["ADMIN"].permissions.set(
        [permission_objects[code] for code in ALL_CODES]
    )
    role_objects["RANGE_MANAGER"].permissions.set(
        [permission_objects[code] for code in RANGE_MANAGER_CODES]
    )
    role_objects["AGENT"].permissions.set(
        [permission_objects[code] for code in AGENT_CODES]
    )


def unseed_roles(apps, schema_editor):
    Role = apps.get_model("accounts", "Role")
    RolePermission = apps.get_model("accounts", "RolePermission")
    Role.objects.filter(code__in=[code for code, *_rest in ROLES]).delete()
    RolePermission.objects.filter(code__in=[code for code, *_rest in PERMISSIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0012_rolepermission_alter_user_role_role_salesrange"),
    ]

    operations = [
        migrations.RunPython(seed_roles, unseed_roles),
    ]
