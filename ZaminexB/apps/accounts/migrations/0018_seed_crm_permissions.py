from django.db import migrations


CRM_PERMISSIONS = (
    ("contact.view", "مشاهده اشخاص", "اشخاص", 15, 10),
    ("contact.manage", "ایجاد و ویرایش اشخاص", "اشخاص", 15, 20),
    ("case.view", "مشاهده پرونده‌های ثبت", "پرونده‌ها", 16, 10),
    ("case.create", "ثبت سرنخ و پرونده اولیه", "پرونده‌ها", 16, 20),
    ("case.accept_lead", "پذیرش اولیه سرنخ", "پرونده‌ها", 16, 30),
    ("case.assign", "ارجاع و تغییر مسئول پرونده", "پرونده‌ها", 16, 40),
    ("case.appraise", "کارشناسی و تکمیل پرونده", "پرونده‌ها", 16, 50),
    ("property.review_decide", "تأیید یا برگشت ملک", "پرونده‌ها", 16, 60),
    ("inquiry.view", "مشاهده درخواست‌های متقاضی", "متقاضی", 17, 10),
    ("inquiry.manage", "مدیریت نیاز متقاضی", "متقاضی", 17, 20),
    ("introduction.manage", "ثبت معرفی فایل", "متقاضی", 17, 30),
    ("viewing.manage", "مدیریت بازدید مشتری", "متقاضی", 17, 40),
    ("deal.manage", "مدیریت مذاکره", "معامله", 18, 10),
    ("pipeline.view", "مشاهده کاریز عملیات", "پرونده‌ها", 16, 70),
    ("scope.manage", "مدیریت رنج‌ها و عضویت‌ها", "رنج‌ها", 19, 10),
    ("dealtype.manage", "مدیریت انواع معامله و نسخه‌ها", "تنظیمات", 80, 50),
    ("contract.manage", "مدیریت قراردادها", "قرارداد", 85, 10),
    ("finance.view", "مشاهده مالی و کمیسیون", "مالی", 90, 10),
    ("finance.manage", "مدیریت کمیسیون و وجوه", "مالی", 90, 20),
    ("finance.policy", "مدیریت سیاست کمیسیون", "مالی", 90, 30),
)

AGENT_CRM_CODES = {
    "contact.view",
    "contact.manage",
    "case.view",
    "case.create",
    "case.appraise",
    "inquiry.view",
    "inquiry.manage",
    "introduction.manage",
    "viewing.manage",
    "deal.manage",
    "pipeline.view",
}

RANGE_MANAGER_CRM_CODES = {
    code
    for code, *_rest in CRM_PERMISSIONS
    if code not in {"dealtype.manage", "contract.manage", "finance.policy"}
}

FINANCE_CODES = {"finance.view", "finance.manage", "profile.edit"}


def forwards(apps, schema_editor):
    Role = apps.get_model("accounts", "Role")
    RolePermission = apps.get_model("accounts", "RolePermission")

    permission_by_code = {}
    for code, name, group, group_order, sort_order in CRM_PERMISSIONS:
        permission, _ = RolePermission.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "group": group,
                "group_order": group_order,
                "sort_order": sort_order,
            },
        )
        permission_by_code[code] = permission

    role_defaults = {
        "ADMIN": {code for code, *_rest in CRM_PERMISSIONS},
        "RANGE_MANAGER": RANGE_MANAGER_CRM_CODES,
        "AGENT": AGENT_CRM_CODES,
        "FINANCE": FINANCE_CODES,
    }
    for role_code, permission_codes in role_defaults.items():
        role = Role.objects.filter(code=role_code).first()
        if role is None:
            continue
        permissions = []
        for code in permission_codes:
            permission = permission_by_code.get(code)
            if permission is None:
                permission = RolePermission.objects.filter(code=code).first()
            if permission is not None:
                permissions.append(permission)
        role.permissions.add(*permissions)


def backwards(apps, schema_editor):
    Role = apps.get_model("accounts", "Role")
    RolePermission = apps.get_model("accounts", "RolePermission")
    codes = [code for code, *_rest in CRM_PERMISSIONS]
    permissions = list(RolePermission.objects.filter(code__in=codes))
    for role in Role.objects.all():
        role.permissions.remove(*permissions)
    RolePermission.objects.filter(code__in=codes).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0017_general_manager_admin_permissions")]

    operations = [migrations.RunPython(forwards, backwards)]
