from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models, transaction

from apps.common.attribute_values import BaseAttributeValue


class PropertyFile(models.Model):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "پیش‌نویس"
        ACTIVE = "ACTIVE", "منتشرشده (فعال)"
        PAUSED = "PAUSED", "متوقف‌شده"
        SOLD = "SOLD", "فروخته‌شده"
        EXPIRED = "EXPIRED", "منقضی‌شده"
        ARCHIVED = "ARCHIVED", "بایگانی‌شده"

    class PublishChannel(models.TextChoices):
        WEBSITE = "WEBSITE", "وب‌سایت"
        INSTAGRAM = "INSTAGRAM", "اینستاگرام"
        TELEGRAM = "TELEGRAM", "تلگرام"
        OTHER = "OTHER", "سایر"

    class Priority(models.IntegerChoices):
        LOW = 1, "اولویت کم"
        NORMAL = 2, "اولویت عادی"
        HIGH = 3, "اولویت بالا"
        URGENT = 4, "اولویت فوری"

    property = models.ForeignKey(
        "properties.Property",
        on_delete=models.CASCADE,
        related_name="property_files",
        verbose_name="ملک",
    )

    deal_type = models.ForeignKey(
        "basics.DealType",
        on_delete=models.PROTECT,
        related_name="property_files",
        null=True,
        blank=True,
        verbose_name="نوع معامله",
    )

    title = models.CharField(max_length=255, verbose_name="عنوان فایل")
    description = models.TextField(blank=True, verbose_name="توضیحات")

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.ACTIVE,
        verbose_name="وضعیت",
    )
    rejection_reason = models.TextField(
        blank=True, default="", verbose_name="دلیل بازگرداندن برای اصلاح"
    )
    review_requested_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        verbose_name="زمان ارسال برای بررسی",
    )

    publish_channel = models.CharField(
        max_length=30,
        choices=PublishChannel.choices,
        verbose_name="کانال انتشار",
    )

    start_date = models.DateTimeField(null=True, blank=True, verbose_name="تاریخ شروع")
    end_date = models.DateTimeField(null=True, blank=True, verbose_name="تاریخ پایان")

    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_property_files",
        verbose_name="مسئول فایل",
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_property_files",
        verbose_name="ایجاد کننده",
    )

    priority = models.IntegerField(
        choices=Priority.choices,
        default=Priority.NORMAL,
        verbose_name="اولویت",
    )

    is_featured = models.BooleanField(default=False, verbose_name="فایل ویژه")

    sale_price = models.DecimalField(
        max_digits=18,
        decimal_places=0,
        null=True,
        blank=True,
        db_index=True,
        verbose_name="قیمت فروش",
    )
    deposit = models.DecimalField(
        max_digits=18,
        decimal_places=0,
        null=True,
        blank=True,
        db_index=True,
        verbose_name="مبلغ رهن / ودیعه",
    )
    monthly_rent = models.DecimalField(
        max_digits=18,
        decimal_places=0,
        null=True,
        blank=True,
        db_index=True,
        verbose_name="اجاره ماهانه",
    )

    price_details = models.JSONField(
        default=dict, blank=True, verbose_name="جزئیات قیمت"
    )

    deal_type_version = models.ForeignKey(
        "basics.DealTypeVersion",
        on_delete=models.PROTECT,
        related_name="property_files",
        null=True,
        blank=True,
        verbose_name="نسخه نوع معامله",
    )
    terms = models.JSONField(default=dict, blank=True, verbose_name="شرایط معامله")
    version = models.PositiveIntegerField(default=1, verbose_name="نسخه شرایط")

    created_at = models.DateTimeField(auto_now_add=True, verbose_name="تاریخ ایجاد")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="تاریخ بروزرسانی")

    class Meta:
        db_table = "listings_listing"
        verbose_name = "فایل"
        verbose_name_plural = "فایل‌ها"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["property", "deal_type"],
                condition=models.Q(deal_type__isnull=False)
                & ~models.Q(status="ARCHIVED"),
                name="uq_listing_property_deal_type",
            )
        ]

    TRANSITIONS = {
        Status.DRAFT: {Status.ACTIVE, Status.PAUSED, Status.ARCHIVED},
        Status.ACTIVE: {Status.PAUSED, Status.SOLD, Status.EXPIRED, Status.ARCHIVED},
        Status.PAUSED: {Status.ACTIVE, Status.DRAFT, Status.SOLD, Status.EXPIRED, Status.ARCHIVED},
        Status.SOLD: {Status.ARCHIVED},
        Status.EXPIRED: {Status.ARCHIVED},
        Status.ARCHIVED: {Status.DRAFT},
    }
    TRACKED_FIELDS = (
        "deal_type_id",
        "deal_type_version_id",
        "terms",
        "sale_price",
        "deposit",
        "monthly_rent",
        "price_details",
        "status",
        "title",
        "description",
        "publish_channel",
        "start_date",
        "end_date",
        "assigned_to_id",
    )

    def snapshot(self):
        values = {}
        for field in self.TRACKED_FIELDS:
            value = getattr(self, field)
            if field in {"sale_price", "deposit", "monthly_rent"} and value is not None:
                value = str(value)
            elif field in {"start_date", "end_date"} and value is not None:
                value = value.isoformat()
            values[field] = value
        values["terms_schema_version"] = self.deal_type_version_id
        return values

    def validate_terms(self):
        if not self.terms:
            return
        if self.deal_type_version_id is None:
            raise ValidationError({"terms": "برای ثبت شرایط معامله، نسخه نوع معامله الزامی است."})
        from apps.basics.terms import validate_terms

        validate_terms(self.deal_type_version.terms_schema, self.terms)

    def transition_to(self, status, reason=""):
        if status == self.status:
            raise ValidationError({"status": "وضعیت جدید با وضعیت فعلی یکسان است."})
        if status not in self.TRANSITIONS.get(self.status, set()):
            raise ValidationError({"status": f"تغییر وضعیت از «{self.get_status_display()}» به این وضعیت مجاز نیست."})
        if status == self.Status.ACTIVE:
            self.assert_publishable()
        self.status = status
        if status == self.Status.ARCHIVED:
            self.rejection_reason = reason
        return self

    def assert_publishable(self):
        if self.property.review_status != "APPROVED":
            raise ValidationError({"property": "انتشار فایل فقط برای ملک تأییدشده مجاز است."})
        if self.deal_type_id is None or self.deal_type_version_id is None:
            raise ValidationError({"dealType": "نوع معامله و نسخه منتشرشده آن برای انتشار الزامی است."})
        version = self.deal_type_version
        if version.status != "PUBLISHED" or version.deal_type_id != self.deal_type_id:
            raise ValidationError({"dealType": "نسخه انتخاب‌شده باید منتشرشده و متعلق به همین نوع معامله باشد."})
        from apps.basics.terms import validate_terms

        validate_terms(version.terms_schema, self.terms)

    @transaction.atomic
    def save(self, *args, **kwargs):
        self.validate_terms()
        update_fields = kwargs.get("update_fields")
        previous = None
        if self.pk:
            previous = type(self).objects.filter(pk=self.pk).values(*self.TRACKED_FIELDS, "version").first()
        if previous is not None:
            changed = any(previous[field] != getattr(self, field) for field in self.TRACKED_FIELDS if field in previous)
            if changed:
                self.version = previous["version"] + 1
                if update_fields is not None and "version" not in update_fields:
                    kwargs["update_fields"] = list(update_fields) + ["version"]
        super().save(*args, **kwargs)
        if previous is None or self.version != previous["version"]:
            PropertyFileVersion.objects.get_or_create(
                property_file=self,
                version_number=self.version,
                defaults={"snapshot": self.snapshot(), "changed_by_id": self.assigned_to_id or self.created_by_id},
            )

    def __str__(self):
        return self.title


class PropertyFileVersion(models.Model):
    property_file = models.ForeignKey(PropertyFile, on_delete=models.CASCADE, related_name="versions", verbose_name="فایل")
    version_number = models.PositiveIntegerField(verbose_name="شماره نسخه")
    snapshot = models.JSONField(default=dict, verbose_name="عکس وضعیت")
    changed_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="property_file_versions", verbose_name="تغییر دهنده")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="زمان ثبت")

    class Meta:
        db_table = "listings_listingversion"
        verbose_name = "نسخه فایل عرضه"
        verbose_name_plural = "نسخه‌های فایل عرضه"
        ordering = ["-version_number"]
        constraints = [models.UniqueConstraint(fields=["property_file", "version_number"], name="uq_listing_version")]

    def save(self, *args, **kwargs):
        if self.pk:
            raise ValidationError({"version_number": "نسخه ثبت‌شده قابل بازنویسی نیست."})
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError({"version_number": "نسخه ثبت‌شده قابل حذف نیست."})


class PropertyFileAttributeValue(BaseAttributeValue):
    property_file = models.ForeignKey(
        "listings.PropertyFile",
        on_delete=models.CASCADE,
        db_column="listing_id",
        related_name="attribute_values",
        verbose_name="فایل",
    )

    def __init__(self, *args, **kwargs):
        if "listing" in kwargs:
            kwargs["property_file"] = kwargs.pop("listing")
        super().__init__(*args, **kwargs)

    @property
    def listing(self):
        return self.property_file

    @listing.setter
    def listing(self, value):
        self.property_file = value

    class Meta:
        db_table = "listings_listing_attribute_value"
        verbose_name = "مقدار ویژگی فایل"
        verbose_name_plural = "مقادیر ویژگی فایل"
        constraints = [
            models.UniqueConstraint(
                fields=["property_file", "attribute"],
                name="uq_listing_attribute_value",
            )
        ]
        indexes = [
            models.Index(fields=["attribute", "value_integer"], name="idx_lav_attr_int"),
            models.Index(fields=["attribute", "value_decimal"], name="idx_lav_attr_dec"),
            models.Index(fields=["attribute", "value_boolean"], name="idx_lav_attr_bool"),
            models.Index(fields=["attribute", "value_date"], name="idx_lav_attr_date"),
        ]


class PropertyFilePriceHistory(models.Model):
    property_file = models.ForeignKey(PropertyFile, on_delete=models.CASCADE, db_column="listing_id", related_name="price_history", verbose_name="فایل")
    sale_price = models.DecimalField(max_digits=18, decimal_places=0, null=True, blank=True, verbose_name="قیمت فروش")
    deposit = models.DecimalField(max_digits=18, decimal_places=0, null=True, blank=True, verbose_name="مبلغ ودیعه")
    monthly_rent = models.DecimalField(max_digits=18, decimal_places=0, null=True, blank=True, verbose_name="اجاره ماهانه")
    price_details = models.JSONField(default=dict, blank=True, verbose_name="جزئیات قیمت")
    changed_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="property_file_price_changes", verbose_name="تغییر دهنده")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="زمان ثبت")

    def __init__(self, *args, **kwargs):
        if "listing" in kwargs:
            kwargs["property_file"] = kwargs.pop("listing")
        super().__init__(*args, **kwargs)

    @property
    def listing(self):
        return self.property_file

    @listing.setter
    def listing(self, value):
        self.property_file = value

    class Meta:
        db_table = "listings_listingpricehistory"
        verbose_name = "سابقه قیمت فایل عرضه"
        verbose_name_plural = "سوابق قیمت فایل عرضه"
        ordering = ["-created_at"]


Listing = PropertyFile
ListingAttributeValue = PropertyFileAttributeValue
ListingPriceHistory = PropertyFilePriceHistory
ListingVersion = PropertyFileVersion
