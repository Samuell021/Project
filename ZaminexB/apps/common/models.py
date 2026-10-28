from django.conf import settings
from django.db import models


from apps.basics.models import District


class CompanySettings(models.Model):
    class BrandTheme(models.TextChoices):
        GREEN = "green", "سبز فردا"
        PETROLEUM = "petroleum", "آبی نفتی"
        MIDNIGHT = "midnight", "آبی نیمه‌شب"
        PLUM = "plum", "آلویی"
        COPPER = "copper", "مسی"
        SLATE = "slate", "خاکستری‌آبی"

    company_name = models.CharField(max_length=255, verbose_name="نام شرکت")
    brand_theme = models.CharField(
        max_length=16,
        choices=BrandTheme.choices,
        default=BrandTheme.GREEN,
        verbose_name="رنگ سازمانی",
    )
    license_number = models.CharField(max_length=50, blank=True, verbose_name="شماره پروانه")
    email = models.EmailField(blank=True, verbose_name="ایمیل")
    phone = models.CharField(max_length=50, blank=True, verbose_name="تلفن")
    address = models.TextField(blank=True, verbose_name="آدرس")
    ai_enabled = models.BooleanField(
        default=False, verbose_name="فعال‌سازی هوش مصنوعی"
    )
    ai_api_base_url = models.CharField(
        max_length=500, blank=True,
        verbose_name="آدرس پایه API هوش مصنوعی",
        help_text="مثلاً https://api.openai.com/v1؛ مسیر /chat/completions به‌صورت خودکار افزوده می‌شود.",
    )
    ai_api_key = models.CharField(
        max_length=2048, blank=True,
        verbose_name="کلید API هوش مصنوعی",
        help_text="در سرویس‌های بدون احراز هویت خالی بماند. آدرس سرویس باید HTTPS عمومی باشد.",
    )
    ai_model = models.CharField(
        max_length=200,
        verbose_name="نام مدل",
        help_text="شناسه دقیق مدل در سرویس‌دهنده را وارد کنید؛ مثلاً gpt-4o-mini یا deepseek-chat.",
    )
    ai_last_test = models.JSONField(
        null=True,
        blank=True,
        editable=False,
        verbose_name="نتیجه آخرین آزمون اتصال هوش مصنوعی",
    )
    updated_at = models.DateTimeField(auto_now=True, verbose_name="تاریخ بروزرسانی")

    class Meta:
        verbose_name = "تنظیمات شرکت"
        verbose_name_plural = "تنظیمات شرکت"

    def __str__(self):
        return self.company_name

    @property
    def ai_api_key_plain(self) -> str:
        from .crypto import decrypt_secret
        return decrypt_secret(self.ai_api_key)

    def set_ai_api_key(self, raw: str | None):
        from .crypto import encrypt_secret
        self.ai_api_key = encrypt_secret((raw or "").strip())

    def save(self, *args, **kwargs):
        if self.ai_api_key:
            from .crypto import encrypt_secret
            self.ai_api_key = encrypt_secret(self.ai_api_key)
        super().save(*args, **kwargs)

    def clean(self):
        from django.core.exceptions import ValidationError

        from apps.analytics.ai_url import UnsafeAIURL, assert_public_https_url

        super().clean()
        model_name = (self.ai_model or "").strip()
        if not model_name:
            raise ValidationError({"ai_model": "نام مدل هوش مصنوعی الزامی است."})
        self.ai_model = model_name
        base_url = (self.ai_api_base_url or "").strip()
        if self.ai_enabled and not base_url:
            raise ValidationError({"ai_api_base_url": "برای فعال‌سازی، نشانی پایه سرویس الزامی است."})
        if base_url:
            try:
                self.ai_api_base_url = assert_public_https_url(base_url)
            except UnsafeAIURL as exc:
                raise ValidationError({"ai_api_base_url": str(exc)}) from exc

    DEFAULTS = {
        "company_name": "مشاور املاک زمینکس",
        "brand_theme": BrandTheme.GREEN,
        "license_number": "3541/1402",
        "email": "admin@zaminex.ir",
        "phone": "011-3322-5500",
        "address": "مازندران، ساری، بلوار کشاورز، نبش خیابان فرهنگ، ساختمان زمینکس، طبقه دوم",
        "ai_enabled": False,
        "ai_api_base_url": "",
        "ai_api_key": "",
        "ai_model": "",
        "ai_last_test": None,
    }

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1, defaults=cls.DEFAULTS)
        return obj

    @classmethod
    @property
    def DistrictModel(cls):
        return District


class AIConfiguration(CompanySettings):
    class Meta:
        proxy = True
        verbose_name = "تنظیمات هوش مصنوعی"
        verbose_name_plural = "تنظیمات هوش مصنوعی (API مرکزی)"
