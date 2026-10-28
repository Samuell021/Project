import os
import uuid

from django.db import models, transaction
from django.db.models import BigIntegerField, Max
from django.db.models.functions import Cast, Substr
from django.db.utils import IntegrityError

from .parties import owner_field, save_owner_updates
from .supply_projection import PropertyManager, read_price, write_price, read_deal_type, write_deal_type, save_initial_supply
from .validators import validate_appraisal_pdf, validate_property_image
from django.conf import settings

from apps.common.attribute_values import BaseAttributeValue


class ActivePropertyManager(PropertyManager):
    def get_queryset(self):
        return super().get_queryset().exclude(
            status__in=(Property.Status.INACTIVE, Property.Status.DRAFT)
        )


class Property(models.Model):
    class Status(models.TextChoices):
        AVAILABLE = "AVAILABLE", "آماده واگذاری"
        RESERVED = "RESERVED", "رزرو شده"
        SOLD = "SOLD", "فروخته/واگذارشده"
        INACTIVE = "INACTIVE", "بایگانی‌شده"
        DRAFT = "DRAFT", "پیش‌نویس"

    class DealType(models.TextChoices):
        SALE = "SALE", "فروش"
        RENT = "RENT", "اجاره"

    class PropertyType(models.TextChoices):
        APARTMENT = "APARTMENT", "آپارتمان"
        VILLA = "VILLA", "ویلا"
        TOWNHOUSE = "TOWNHOUSE", "خانه ویلایی"
        STUDIO = "STUDIO", "استودیو"
        PENTHOUSE = "PENTHOUSE", "پنت‌هاوس"
        COMMERCIAL = "COMMERCIAL", "تجاری/اداری"
        OFFICE = "OFFICE", "دفتر کار"
        SHOP = "SHOP", "مغازه"
        LAND = "LAND", "زمین"
        OTHER = "OTHER", "سایر"

    title = models.CharField(max_length=255, verbose_name="عنوان ملک")
    internal_code = models.CharField(max_length=50, unique=True, verbose_name="کد داخلی")

    consultant = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="properties",
        limit_choices_to={"groups__name__in": ["AGENT", "RANGE_MANAGER"]},
        verbose_name="کارشناس مسئول",
    )

    property_type = models.CharField(
        max_length=20,
        choices=PropertyType.choices,
        verbose_name="نوع ملک (قدیمی)",
    )

    property_usage = models.ForeignKey(
        "basics.PropertyUsage",
        on_delete=models.PROTECT,
        related_name="properties",
        null=True,
        blank=True,
        verbose_name="کاربری ملک",
    )
    property_type_ref = models.ForeignKey(
        "basics.PropertyType",
        on_delete=models.PROTECT,
        related_name="properties",
        null=True,
        blank=True,
        verbose_name="نوع ملک",
    )

    deal_type = property(read_deal_type, write_deal_type)
    price = property(read_price, write_price)
    area = models.PositiveIntegerField(verbose_name="مساحت")
    rooms = models.PositiveIntegerField(default=0, verbose_name="تعداد خواب")
    floor = models.IntegerField(null=True, blank=True, verbose_name="طبقه")
    built_year = models.PositiveIntegerField(null=True, blank=True, verbose_name="سال ساخت")

    address = models.TextField(verbose_name="آدرس کامل")
    neighborhood = models.CharField(
        max_length=255, blank=True, verbose_name="محله / منطقه (متنی)"
    )

    district = models.ForeignKey(
        "basics.District",
        on_delete=models.PROTECT,
        related_name="properties",
        null=True,
        blank=True,
        verbose_name="محله",
    )
    description = models.TextField(blank=True, verbose_name="توضیحات")

    latitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
        null=True,
        blank=True,
        verbose_name="عرض جغرافیایی",
    )
    longitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
        null=True,
        blank=True,
        verbose_name="طول جغرافیایی",
    )

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.AVAILABLE,
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

    class ReviewStatus(models.TextChoices):
        NOT_SUBMITTED = "NOT_SUBMITTED", "ارسال‌نشده"
        PENDING = "PENDING", "در انتظار بررسی"
        APPROVED = "APPROVED", "تأیید شده"
        CHANGES_REQUIRED = "CHANGES_REQUIRED", "نیازمند اصلاح"

    review_status = models.CharField(
        max_length=20,
        choices=ReviewStatus.choices,
        default=ReviewStatus.NOT_SUBMITTED,
        db_index=True,
        verbose_name="وضعیت بررسی ملک",
    )
    review_version = models.PositiveIntegerField(default=0, verbose_name="نسخه بررسی")
    submitted_review_version = models.PositiveIntegerField(default=0, verbose_name="نسخه ارسال‌شده برای بررسی")

    is_shared = models.BooleanField(
        default=False,
        verbose_name="نمایش برای همه کارشناسان",
        help_text="وقتی فعال باشد، همه کارشناسان ملک را می‌بینند و می‌توانند ویرایش کنند (به جز تغییر کارشناس مسئول).",
    )

    legacy_data = models.JSONField(default=dict, blank=True, verbose_name="بایگانی اطلاعات پیشین")
    owner_first_name = owner_field("owner_first_name")
    owner_last_name = owner_field("owner_last_name")
    owner_phone = owner_field("owner_phone")

    created_at = models.DateTimeField(auto_now_add=True, verbose_name="تاریخ ایجاد")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="تاریخ بروزرسانی")

    objects = PropertyManager()
    active_objects = ActivePropertyManager()

    class Meta:
        verbose_name = "ملک"
        verbose_name_plural = "املاک"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["-created_at"], name="idx_property_created_at"),
            models.Index(
                fields=["status", "-created_at"], name="idx_property_status_created"
            ),
            models.Index(fields=["property_type"], name="idx_property_type"),
            models.Index(fields=["area"], name="idx_property_area"),
        ]

    @property
    def listings(self):
        return self.property_files

    def get_deal_type_display(self):
        return dict(self.DealType.choices).get(self.deal_type, "—")

    def __str__(self):
        return self.title

    def refresh_from_db(self, *args, **kwargs):
        super().refresh_from_db(*args, **kwargs)
        for key in ("_primary_owner_contact", "_computed_sale_price", "_owner_updates"):
            self.__dict__.pop(key, None)

    @transaction.atomic
    def save(self, *args, **kwargs):
        self._save_physical(*args, **kwargs)
        save_owner_updates(self)
        save_initial_supply(self)

    def _save_physical(self, *args, **kwargs):
        needs_code = self.pk is None and not _has_sequential_code(self.internal_code)
        if needs_code:
            self.internal_code = _generate_next_internal_code()

        if self.district_id:
            name = self.district.display_name
            if self.neighborhood != name:
                self.neighborhood = name
                update_fields = kwargs.get("update_fields")
                if update_fields is not None and "neighborhood" not in update_fields:
                    kwargs["update_fields"] = list(update_fields) + ["neighborhood"]

        if not needs_code:
            super().save(*args, **kwargs)
            return

        for attempt in range(CODE_INSERT_ATTEMPTS):
            try:
                with transaction.atomic():
                    super().save(*args, **kwargs)
                return
            except IntegrityError:
                if attempt == CODE_INSERT_ATTEMPTS - 1:
                    raise
                self.internal_code = _generate_next_internal_code()


CODE_PREFIX = "ZF_"
FIRST_CODE_VALUE = 1111

MAX_CODE_VALUE = 99999

CODE_INSERT_ATTEMPTS = 5

_MIN_WIDTH = len(str(FIRST_CODE_VALUE))
_MAX_WIDTH = len(str(MAX_CODE_VALUE))
_CODE_REGEX = rf"^{CODE_PREFIX}[1-9]{{{_MIN_WIDTH},{_MAX_WIDTH}}}$"


def _has_sequential_code(value):
    return bool(value) and str(value).startswith(CODE_PREFIX)


def _highest_code_value():
    highest = (
        Property.objects.filter(internal_code__regex=_CODE_REGEX)
        .annotate(
            code_value=Cast(
                Substr("internal_code", len(CODE_PREFIX) + 1), BigIntegerField()
            )
        )
        .aggregate(highest=Max("code_value"))["highest"]
    )
    return FIRST_CODE_VALUE - 1 if highest is None else highest


def _generate_next_internal_code():
    value = _highest_code_value() + 1
    while "0" in str(value) and value <= MAX_CODE_VALUE:
        value += 1

    if value > MAX_CODE_VALUE:
        raise RuntimeError(
            f"فضای کدهای داخلی به پایان رسیده است (آخرین کد ممکن: "
            f"{CODE_PREFIX}{MAX_CODE_VALUE})."
        )

    return f"{CODE_PREFIX}{value:0{_MIN_WIDTH}d}"


class PropertyAttributeValue(BaseAttributeValue):
    property = models.ForeignKey(
        "properties.Property",
        on_delete=models.CASCADE,
        related_name="attribute_values",
        verbose_name="ملک",
    )

    class Meta:
        db_table = "properties_property_attribute_value"
        verbose_name = "مقدار ویژگی ملک"
        verbose_name_plural = "مقادیر ویژگی ملک"
        constraints = [
            models.UniqueConstraint(
                fields=["property", "attribute"],
                name="uq_property_attribute_value",
            )
        ]
        indexes = [
            models.Index(fields=["attribute", "value_integer"], name="idx_pav_attr_int"),
            models.Index(fields=["attribute", "value_decimal"], name="idx_pav_attr_dec"),
            models.Index(fields=["attribute", "value_boolean"], name="idx_pav_attr_bool"),
            models.Index(fields=["attribute", "value_date"], name="idx_pav_attr_date"),
        ]


class PropertyImage(models.Model):
    property = models.ForeignKey(
        "properties.Property",
        on_delete=models.CASCADE,
        related_name="images",
        verbose_name="ملک",
    )
    image = models.ImageField(
        upload_to="properties/images/",
        verbose_name="تصویر",
        validators=[validate_property_image],
        db_index=True,
    )
    sort_order = models.PositiveIntegerField(default=0, verbose_name="ترتیب نمایش")

    class Meta:
        verbose_name = "تصویر ملک"
        verbose_name_plural = "تصاویر ملک"
        ordering = ["sort_order", "id"]

    def __str__(self):
        return f"{self.property.title} - Image {self.pk}"


def appraisal_report_upload_path(instance, filename):
    ext = os.path.splitext(filename)[1].lower()
    if ext != ".pdf":
        ext = ".pdf"
    return f"properties/appraisals/{instance.property_id}/{uuid.uuid4().hex}{ext}"


class PropertyAppraisalReport(models.Model):
    property = models.OneToOneField(
        "properties.Property",
        on_delete=models.CASCADE,
        related_name="appraisal_report",
        verbose_name="ملک",
    )
    file = models.FileField(
        upload_to=appraisal_report_upload_path,
        validators=[validate_appraisal_pdf],
        verbose_name="فایل گزارش کارشناسی",
        help_text="فقط فایل PDF، حداکثر ۱۰ مگابایت.",
    )
    original_filename = models.CharField(max_length=255, verbose_name="نام اصلی فایل")
    file_size = models.PositiveIntegerField(verbose_name="حجم فایل (بایت)")
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="uploaded_appraisal_reports",
        verbose_name="بارگذاری‌کننده",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="تاریخ ایجاد")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="تاریخ بروزرسانی")

    class Meta:
        verbose_name = "گزارش کارشناسی ملک"
        verbose_name_plural = "گزارش‌های کارشناسی ملک"

    def __str__(self):
        return f"{self.property.title} - {self.original_filename}"

    def delete(self, *args, **kwargs):
        pk = self.pk
        super().delete(*args, **kwargs)
        if pk is not None:
            self.file.delete(save=False)