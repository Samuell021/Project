PERMISSION_DEFINITIONS = (
    ("property.create", "ساخت ملک", "املاک", 10, 10),
    ("property.edit", "ویرایش ملک", "املاک", 10, 20),
    ("property.archive", "بایگانی ملک", "املاک", 10, 30),
    ("property.delete", "حذف ملک", "املاک", 10, 40),
    ("property.assign", "واگذاری ملک به کارشناس دیگر", "املاک", 10, 50),
    ("property.review", "تأیید یا رد ملک", "املاک", 10, 60),
    ("property.export", "خروجی گزارش املاک", "املاک", 10, 70),
    ("property.appraisal", "بارگذاری و حذف گزارش کارشناسی", "املاک", 10, 80),
    ("property_file.create", "ساخت فایل", "فایل‌ها", 20, 10),
    ("property_file.edit", "ویرایش فایل", "فایل‌ها", 20, 20),
    ("property_file.assign", "واگذاری فایل به کارشناس دیگر", "فایل‌ها", 20, 30),
    ("property_file.review", "تأیید یا رد فایل", "فایل‌ها", 20, 40),
    ("property_file.status", "تغییر وضعیت فایل", "فایل‌ها", 20, 50),
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

PERMISSION_CODES = tuple(item[0] for item in PERMISSION_DEFINITIONS)

AGENT_PERMISSIONS = frozenset(
    {
        "property.create",
        "property.edit",
        "property.archive",
        "property.delete",
        "property.export",
        "property.appraisal",
        "property_file.create",
        "property_file.edit",
        "property_file.status",
        "followup.manage",
        "task.manage",
        "profile.edit",
    }
)

RANGE_MANAGER_PERMISSIONS = frozenset(
    code
    for code in PERMISSION_CODES
    if code not in {"company.edit", "basics.manage", "login.settings"}
)

ADMIN_PERMISSIONS = frozenset(PERMISSION_CODES)

DEFAULT_ROLE_PERMISSIONS = {
    "ADMIN": ADMIN_PERMISSIONS,
    "RANGE_MANAGER": RANGE_MANAGER_PERMISSIONS,
    "AGENT": AGENT_PERMISSIONS,
}

ROLE_DEFINITIONS = (
    ("ADMIN", "مدیر", 10, True),
    ("RANGE_MANAGER", "مدیر رنج", 20, False),
    ("AGENT", "کارشناس", 30, False),
)

CRM_PERMISSION_DEFINITIONS = (
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

PERMISSION_DEFINITIONS = PERMISSION_DEFINITIONS + CRM_PERMISSION_DEFINITIONS
PERMISSION_CODES = tuple(item[0] for item in PERMISSION_DEFINITIONS)

FINANCE_PERMISSIONS = frozenset({"finance.view", "finance.manage", "profile.edit"})

DEFAULT_ROLE_PERMISSIONS = {
    **DEFAULT_ROLE_PERMISSIONS,
    "ADMIN": frozenset(PERMISSION_CODES),
    "RANGE_MANAGER": frozenset(
        code
        for code in PERMISSION_CODES
        if code not in {"company.edit", "basics.manage", "login.settings", "dealtype.manage", "contract.manage", "finance.policy"}
    ),
    "AGENT": AGENT_PERMISSIONS
    | {
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
    },
    "FINANCE": FINANCE_PERMISSIONS,
}

ROLE_DEFINITIONS = ROLE_DEFINITIONS + (("FINANCE", "مالی", 40, False),)

FOUNDATION_PERMISSION_DEFINITIONS = (
    ("staff.manage", "مدیریت کارکنان", "کارکنان", 50, 30),
    ("property.view", "مشاهده املاک مجاز", "املاک", 10, 5),
    ("listing.view", "مشاهده فایل‌های عرضه", "فایل‌ها", 20, 5),
    ("listing.create", "ایجاد فایل عرضه", "فایل‌ها", 20, 60),
    ("listing.edit", "ویرایش فایل عرضه", "فایل‌ها", 20, 70),
    ("listing.status", "تغییر وضعیت عرضه", "فایل‌ها", 20, 80),
    ("introduction.view", "مشاهده معرفی‌ها", "متقاضی", 17, 50),
    ("viewing.view", "مشاهده بازدیدها", "متقاضی", 17, 60),
    ("deal.view", "مشاهده مذاکرات", "معامله", 18, 20),
    ("contract.view", "مشاهده صف قرارداد", "قرارداد", 85, 20),
    ("ticket.view", "مشاهده تیکت‌های مرتبط", "تیکت‌ها", 60, 30),
    ("ticket.create", "ثبت تیکت", "تیکت‌ها", 60, 40),
    ("report.view", "مشاهده گزارش‌های مجاز", "گزارش‌ها", 70, 40),
)
PERMISSION_DEFINITIONS += FOUNDATION_PERMISSION_DEFINITIONS
PERMISSION_CODES = tuple(item[0] for item in PERMISSION_DEFINITIONS)
DEFAULT_ROLE_PERMISSIONS = {
    **DEFAULT_ROLE_PERMISSIONS,
    "ADMIN": frozenset(PERMISSION_CODES),
    "RANGE_MANAGER": DEFAULT_ROLE_PERMISSIONS["RANGE_MANAGER"] | {"property.view", "listing.view", "listing.create", "listing.edit", "listing.status", "introduction.view", "viewing.view", "deal.view", "ticket.view", "ticket.create", "report.view"},
    "AGENT": DEFAULT_ROLE_PERMISSIONS["AGENT"] | {"property.view", "listing.view", "listing.create", "listing.edit", "listing.status", "introduction.view", "viewing.view", "deal.view", "ticket.view", "ticket.create"},
    "FINANCE": FINANCE_PERMISSIONS | {"report.view"},
}
