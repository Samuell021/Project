from django.contrib.auth.models import AbstractUser, Group
from django.conf import settings
from django.core.validators import RegexValidator
from django.db import models
import datetime


class UserRole(models.TextChoices):
    ADMIN = "ADMIN", "مدیر"
    RANGE_MANAGER = "RANGE_MANAGER", "مدیر رنج"
    AGENT = "AGENT", "کارشناس"
    FINANCE = "FINANCE", "مالی"


GROUP_GENERAL_MANAGER = "GENERAL_MANAGER"
GROUP_RANGE_MANAGER = "RANGE_MANAGER"
GROUP_AGENT = "AGENT"
GROUP_FINANCE = "FINANCE"

GROUP_ROLE_MAP = {
    GROUP_GENERAL_MANAGER: "ADMIN",
    GROUP_RANGE_MANAGER: "RANGE_MANAGER",
    GROUP_AGENT: "AGENT",
    GROUP_FINANCE: "FINANCE",
}

ROLE_GROUP_MAP = {value: key for key, value in GROUP_ROLE_MAP.items()}


def group_name_for_role(role_code: str) -> str:
    return ROLE_GROUP_MAP.get(role_code, role_code)


class User(AbstractUser):
    def __init__(self, *args, **kwargs):
        self._initial_role = kwargs.pop("role", None)
        super().__init__(*args, **kwargs)

    @property
    def role(self):
        if not self.pk:
            return ""
        from .permissions import user_group_names

        names = user_group_names(self)
        for group_name, role_code in GROUP_ROLE_MAP.items():
            if group_name in names:
                return role_code
        return ""

    def save(self, *args, **kwargs):
        adding = self._state.adding
        super().save(*args, **kwargs)
        if adding:
            role_code = self._initial_role or (UserRole.ADMIN if self.is_superuser else UserRole.AGENT)
            group_name = ROLE_GROUP_MAP.get(role_code)
            if group_name:
                self.groups.add(Group.objects.get_or_create(name=group_name)[0])
            self._initial_role = None

    class Meta:
        verbose_name = "کاربر"
        verbose_name_plural = "کاربران"

    @property
    def staff_profile(self):
        return self.consultant_profile

    @property
    def admin_profile(self):
        return self.consultant_profile

    @property
    def is_admin_role(self):
        return self.role == UserRole.ADMIN

    @property
    def is_range_manager_role(self):
        return self.role == UserRole.RANGE_MANAGER

    @property
    def is_agent_role(self):
        return self.role == UserRole.AGENT

    @property
    def is_staff_member(self):
        return self.role in (UserRole.RANGE_MANAGER, UserRole.AGENT)


class RolePermission(models.Model):
    code = models.CharField(max_length=64, unique=True, verbose_name="کد مجوز")
    name = models.CharField(max_length=160, verbose_name="نام مجوز")
    group = models.CharField(max_length=80, verbose_name="گروه")
    group_order = models.PositiveSmallIntegerField(default=0, verbose_name="ترتیب گروه")
    sort_order = models.PositiveSmallIntegerField(default=0, verbose_name="ترتیب نمایش")

    class Meta:
        verbose_name = "مجوز"
        verbose_name_plural = "مجوزها"
        ordering = ["group_order", "sort_order", "code"]

    def __str__(self):
        return self.name


class Role(models.Model):
    code = models.CharField(max_length=40, unique=True, verbose_name="کد نقش")
    name = models.CharField(max_length=80, verbose_name="نام نقش")
    sort_order = models.PositiveSmallIntegerField(default=0, verbose_name="ترتیب نمایش")
    is_locked = models.BooleanField(default=False, verbose_name="دسترسی کامل و غیرقابل تغییر")
    permissions_provisioned = models.BooleanField(default=False, verbose_name="اعمال اولیه مجوزها")
    permissions = models.ManyToManyField(
        RolePermission,
        blank=True,
        related_name="roles",
        verbose_name="مجوزها",
    )

    class Meta:
        verbose_name = "نقش"
        verbose_name_plural = "نقش‌ها"
        ordering = ["sort_order", "code"]

    def __str__(self):
        return self.name


class SalesRange(models.Model):
    version = models.PositiveIntegerField(default=1, verbose_name="نسخه")
    legacy_metadata = models.JSONField(default=list, blank=True, verbose_name="سوابق نگاشت")
    name = models.CharField(max_length=120, unique=True, verbose_name="نام رنج")
    managers = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name="managed_ranges",
        limit_choices_to={"groups__name": GROUP_RANGE_MANAGER},
        verbose_name="مدیران رنج",
    )
    members = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name="sales_ranges",
        limit_choices_to={"groups__name": GROUP_AGENT},
        verbose_name="کارشناسان رنج",
    )
    is_active = models.BooleanField(default=True, verbose_name="فعال")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="تاریخ ایجاد")

    class Meta:
        verbose_name = "رنج"
        verbose_name_plural = "رنج‌ها"
        ordering = ["name"]

    def __str__(self):
        return self.name


class LoginAttempt(models.Model):
    username = models.CharField(max_length=255, unique=True, db_index=True, verbose_name="نام کاربری")
    failed_attempts = models.PositiveSmallIntegerField(default=0, verbose_name="تلاش‌های ناموفق")
    locked_until = models.DateTimeField(null=True, blank=True, db_index=True, verbose_name="قفل تا تاریخ")
    last_failed_at = models.DateTimeField(null=True, blank=True, verbose_name="آخرین تلاش ناموفق")
    last_ip = models.GenericIPAddressField(null=True, blank=True, verbose_name="آی‌پی")
    last_user_agent = models.CharField(max_length=255, blank=True, verbose_name="مرورگر")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="تاریخ بروزرسانی")

    class Meta:
        verbose_name = "محدودیت ورود"
        verbose_name_plural = "محدودیت‌های ورود"
        ordering = ["-updated_at"]

    def __str__(self):
        return self.username


class StaffProfile(models.Model):
    legacy_metadata = models.JSONField(default=dict, blank=True, verbose_name="سوابق پروفایل پیشین")
    mobile_validator = RegexValidator(
        regex=r"^09\d{9}$",
        message="شماره موبایل معتبر نیست. شماره باید با ۰۹ شروع شود و ۱۱ رقم باشد.",
    )

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="consultant_profile",
        verbose_name="حساب کاربری",
    )
    full_name = models.CharField(max_length=255, verbose_name="نام و نام خانوادگی")
    mobile = models.CharField(max_length=11, validators=[mobile_validator], unique=True, null=True, blank=True, verbose_name="شماره موبایل")
    branch = models.CharField(max_length=255, verbose_name="شعبه")
    profile_image = models.ImageField(upload_to="consultants/profile/", blank=True, null=True, verbose_name="تصویر پروفایل",
        db_index=True)
    hired_at = models.DateField(default=datetime.date.today, verbose_name="تاریخ استخدام")
    staff_code = models.CharField(max_length=40, unique=True, null=True, blank=True, verbose_name="کد پرسنلی")
    version = models.PositiveIntegerField(default=1, verbose_name="نسخه")
    notes = models.TextField(blank=True, verbose_name="یادداشت‌ها")
    is_active = models.BooleanField(default=True, verbose_name="فعال")

    class Meta:
        db_table = "accounts_consultantprofile"
        verbose_name = "پروفایل کارمند"
        verbose_name_plural = "پروفایل‌های کارکنان"
        ordering = ["full_name"]

    def __str__(self):
        return self.full_name


class LoginMethod(models.TextChoices):
    PASSWORD = "password", "رمز عبور"
    SMS = "sms", "کد پیامکی"


class LoginSettings(models.Model):
    method = models.CharField(
        max_length=20,
        choices=LoginMethod.choices,
        default=LoginMethod.PASSWORD,
        verbose_name="روش ورود",
    )
    updated_at = models.DateTimeField(auto_now=True, verbose_name="تاریخ بروزرسانی")

    class Meta:
        verbose_name = "روش ورود"
        verbose_name_plural = "روش ورود"

    def __str__(self):
        return self.get_method_display()

    DEFAULTS = {"method": LoginMethod.PASSWORD}

    @classmethod
    def get_solo(cls):
        from django.core.management.color import no_style
        from django.db import connection

        obj, created = cls.objects.get_or_create(pk=1, defaults=cls.DEFAULTS)
        if created:
            with connection.cursor() as cursor:
                for sql in connection.ops.sequence_reset_sql(no_style(), [cls]):
                    cursor.execute(sql)
        return obj


class SmsProviderSettings(models.Model):
    smsir_api_key = models.CharField(max_length=1024, blank=True, verbose_name="کلید API اسمس‌دات‌آی‌آر")
    smsir_line_number = models.CharField(
        max_length=32,
        blank=True,
        verbose_name="شماره خط اسمس‌دات‌آی‌آر",
        help_text="اختیاری؛ فقط اگر سرویس‌دهنده نیاز دارد وارد شود.",
    )
    smsir_template_id = models.CharField(
        max_length=64,
        blank=True,
        verbose_name="شناسه قالب (templateId)",
        help_text="قالب تأیید (verify) در پنل اسمس‌دات‌آی‌آر.",
    )
    kavenegar_api_key = models.CharField(max_length=1024, blank=True, verbose_name="کلید API کاوه‌نگار")
    kavenegar_sender = models.CharField(
        max_length=32,
        blank=True,
        default="20006535",
        verbose_name="شماره فرستنده کاوه‌نگار",
    )
    kavenegar_template_name = models.CharField(
        max_length=128,
        blank=True,
        verbose_name="نام قالب احراز هویت کاوه‌نگار",
        help_text="اختیاری؛ اگر تنظیم شود کد از طریق قالب (lookup) ارسال می‌شود، وگرنه پیام متنی ساده.",
    )
    kavenegar_message = models.CharField(
        max_length=500,
        blank=True,
        default="کد ورود شما به زمینکس: {code}",
        verbose_name="متن پیام (در صورت نبود قالب)",
        help_text="متن سادهٔ پیامک؛ {code} با کد تأیید جایگزین می‌شود.",
    )
    updated_at = models.DateTimeField(auto_now=True, verbose_name="تاریخ بروزرسانی")

    class Meta:
        verbose_name = "تنظیمات پیامک"
        verbose_name_plural = "تنظیمات پیامک"

    def __str__(self):
        return "تنظیمات سرویس پیامک"

    @property
    def smsir_api_key_plain(self) -> str:
        from apps.common.crypto import decrypt_secret

        return decrypt_secret(self.smsir_api_key)

    @property
    def kavenegar_api_key_plain(self) -> str:
        from apps.common.crypto import decrypt_secret

        return decrypt_secret(self.kavenegar_api_key)

    def save(self, *args, **kwargs):
        from apps.common.crypto import encrypt_secret

        if self.smsir_api_key and not self.smsir_api_key.startswith("enc:v1:"):
            self.smsir_api_key = encrypt_secret(self.smsir_api_key)
        if self.kavenegar_api_key and not self.kavenegar_api_key.startswith("enc:v1:"):
            self.kavenegar_api_key = encrypt_secret(self.kavenegar_api_key)
        super().save(*args, **kwargs)

    DEFAULTS = {
        "smsir_api_key": "",
        "smsir_line_number": "",
        "smsir_template_id": "",
        "kavenegar_api_key": "",
        "kavenegar_sender": "20006535",
        "kavenegar_template_name": "",
        "kavenegar_message": "کد ورود شما به زمینکس: {code}",
    }

    @classmethod
    def get_solo(cls):
        from django.core.management.color import no_style
        from django.db import connection

        obj, created = cls.objects.get_or_create(pk=1, defaults=cls.DEFAULTS)
        if created:
            with connection.cursor() as cursor:
                for sql in connection.ops.sequence_reset_sql(no_style(), [cls]):
                    cursor.execute(sql)
        return obj


class SmsLoginCode(models.Model):
    mobile = models.CharField(max_length=16, db_index=True, verbose_name="شماره موبایل")
    code_hash = models.CharField(max_length=255, verbose_name="کد (هش‌شده)")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="تاریخ ایجاد")
    expires_at = models.DateTimeField(db_index=True, verbose_name="انقضا")
    attempts = models.PositiveSmallIntegerField(default=0, verbose_name="تلاش‌های ناموفق")
    consumed_at = models.DateTimeField(null=True, blank=True, verbose_name="تاریخ مصرف")

    class Meta:
        verbose_name = "کد ورود پیامکی"
        verbose_name_plural = "کدهای ورود پیامکی"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.mobile} ({self.created_at:%Y-%m-%d %H:%M})"


AdminProfile = StaffProfile


class ScopeAlias:
    @property
    def scope(self):
        return self.sales_range

    @scope.setter
    def scope(self, value):
        self.sales_range = value

    @property
    def scope_id(self):
        return self.sales_range_id

    @scope_id.setter
    def scope_id(self, value):
        self.sales_range_id = value


class ScopeMembership(ScopeAlias, models.Model):
    class MembershipRole(models.TextChoices):
        MANAGER = "MANAGER", "مدیر رنج"
        MEMBER = "MEMBER", "عضو"

    sales_range = models.ForeignKey(SalesRange, on_delete=models.SET_NULL, null=True, blank=True, related_name="membership_history", verbose_name="رنج مرجع")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="scope_memberships", verbose_name="کاربر")
    membership_role = models.CharField(max_length=20, choices=MembershipRole.choices, verbose_name="نقش در رنج")
    started_at = models.DateTimeField(verbose_name="شروع عضویت")
    ended_at = models.DateTimeField(null=True, blank=True, verbose_name="پایان عضویت")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="تاریخ ایجاد")

    class Meta:
        verbose_name = "عضویت رنج"
        verbose_name_plural = "سوابق عضویت رنج"
        ordering = ["-started_at"]
        indexes = [models.Index(fields=["user", "ended_at"]), models.Index(fields=["sales_range", "ended_at"], name="idx_scope_range_end")]

    def __str__(self):
        return f"{self.user} - {self.sales_range or self.scope}"


class ScopeTransferHistory(models.Model):
    class SubjectType(models.TextChoices):
        PROPERTY_CASE = "PROPERTY_CASE", "پرونده ملک"
        INQUIRY = "INQUIRY", "درخواست متقاضی"

    subject_type = models.CharField(max_length=20, choices=SubjectType.choices, verbose_name="نوع موضوع")
    subject_id = models.PositiveIntegerField(db_index=True, verbose_name="شناسه موضوع")
    from_sales_range = models.ForeignKey(SalesRange, on_delete=models.SET_NULL, null=True, blank=True, related_name="transfers_from", verbose_name="رنج مبدأ")
    to_sales_range = models.ForeignKey(SalesRange, on_delete=models.SET_NULL, null=True, blank=True, related_name="transfers_to", verbose_name="رنج مقصد")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="scope_transfers", verbose_name="انجام‌دهنده")
    reason = models.TextField(blank=True, verbose_name="دلیل")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="زمان ثبت")

    class Meta:
        verbose_name = "سابقه انتقال رنج"
        verbose_name_plural = "سوابق انتقال رنج"
        ordering = ["-created_at"]


ManagementScope = SalesRange


ConsultantProfile = StaffProfile
