from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.accounts.models import ScopeAlias


class LegacyReviewStatus(models.TextChoices):
    NOT_REQUIRED = "NOT_REQUIRED", "نیازی به بازبینی ندارد"
    NEEDS_REVIEW = "NEEDS_REVIEW", "در انتظار بازبینی"
    REVIEWED = "REVIEWED", "بازبینی‌شده"


class Contact(models.Model):
    version = models.PositiveIntegerField(default=1, verbose_name="نسخه")
    full_name = models.CharField(max_length=255, verbose_name="نام و نام خانوادگی")
    national_code = models.CharField(max_length=20, blank=True, db_index=True, verbose_name="کد ملی")
    email = models.EmailField(blank=True, verbose_name="ایمیل")
    notes = models.TextField(blank=True, verbose_name="یادداشت‌ها")
    is_legacy_placeholder = models.BooleanField(default=False, db_index=True, verbose_name="شخص جایگزینِ داده قدیمی")
    legacy_review_status = models.CharField(max_length=20, choices=LegacyReviewStatus.choices, default=LegacyReviewStatus.NOT_REQUIRED, db_index=True, verbose_name="وضعیت بازبینی داده قدیمی")
    legacy_review_notes = models.TextField(blank=True, verbose_name="یادداشت بازبینی داده قدیمی")
    legacy_reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="reviewed_legacy_contacts", verbose_name="بازبین داده قدیمی")
    legacy_reviewed_at = models.DateTimeField(null=True, blank=True, verbose_name="زمان بازبینی داده قدیمی")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="created_contacts", verbose_name="ایجادکننده")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="تاریخ ایجاد")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="تاریخ بروزرسانی")

    class Meta:
        verbose_name = "شخص"
        verbose_name_plural = "اشخاص"
        ordering = ["full_name"]

    def __str__(self):
        return self.full_name


class ContactPhone(models.Model):
    def save(self, *args, **kwargs):
        from django.core.exceptions import ValidationError
        from .phones import normalize_phone

        self.normalized_phone = normalize_phone(self.phone)
        if not self.normalized_phone:
            raise ValidationError({"phone": "شماره تماس باید شامل رقم باشد."})
        if kwargs.get("update_fields") is not None:
            kwargs["update_fields"] = set(kwargs["update_fields"]) | {"normalized_phone"}
        super().save(*args, **kwargs)

    contact = models.ForeignKey(Contact, on_delete=models.CASCADE, related_name="phones", verbose_name="شخص")
    phone = models.CharField(max_length=32, verbose_name="شماره تماس")
    normalized_phone = models.CharField(max_length=32, db_index=True, verbose_name="شماره نرمال‌شده")
    label = models.CharField(max_length=80, blank=True, verbose_name="عنوان")
    is_primary = models.BooleanField(default=False, verbose_name="شماره اصلی")

    class Meta:
        verbose_name = "شماره تماس"
        verbose_name_plural = "شماره‌های تماس"
        constraints = [models.UniqueConstraint(fields=["contact", "normalized_phone"], name="uq_contact_phone")]

    def __str__(self):
        return self.phone


class PropertyParty(models.Model):
    class Role(models.TextChoices):
        OWNER = "OWNER", "مالک"
        REPRESENTATIVE = "REPRESENTATIVE", "نماینده"
        OWNER_REPRESENTATIVE = "OWNER_REPRESENTATIVE", "نماینده مالک"
        TENANT = "TENANT", "مستأجر"
        OTHER = "OTHER", "سایر"

    property = models.ForeignKey("properties.Property", on_delete=models.CASCADE, related_name="contact_links", verbose_name="ملک")
    contact = models.ForeignKey(Contact, on_delete=models.CASCADE, related_name="property_links", verbose_name="شخص")
    ended_at = models.DateTimeField(null=True, blank=True, verbose_name="پایان ارتباط")
    share_percent = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(Decimal("0")), MaxValueValidator(Decimal("100"))], verbose_name="سهم درصدی")
    role = models.CharField(max_length=30, choices=Role.choices, default=Role.OWNER, verbose_name="نقش")
    is_primary = models.BooleanField(default=False, verbose_name="شخص اصلی")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="تاریخ ایجاد")

    class Meta:
        db_table = "crm_propertycontact"
        verbose_name = "شخص مرتبط با ملک"
        verbose_name_plural = "اشخاص مرتبط با ملک"
        constraints = [models.UniqueConstraint(fields=["property", "contact", "role"], name="uq_property_contact_role"), models.CheckConstraint(condition=models.Q(share_percent__isnull=True) | models.Q(share_percent__gte=0, share_percent__lte=100), name="ck_property_party_share_percent")]


class LeadSource(models.TextChoices):
    OWNER_REFERRAL = "OWNER_REFERRAL", "مراجعه یا تماس مالک"
    ADVISOR_NETWORK = "ADVISOR_NETWORK", "شبکه ارتباطی مشاور"
    PORTAL = "PORTAL", "پرتال و آگهی"
    REFERRAL = "REFERRAL", "معرفی"
    WALK_IN = "WALK_IN", "حضوری"
    OTHER = "OTHER", "سایر"


class CaseStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "فعال"
    COMPLETED = "COMPLETED", "تکمیل‌شده"
    CLOSED = "CLOSED", "بسته"
    CANCELLED = "CANCELLED", "لغوشده"
    DUPLICATE = "DUPLICATE", "تکراری"


class LeadStatus(models.TextChoices):
    PENDING = "PENDING", "در انتظار پذیرش"
    ACCEPTED = "ACCEPTED", "پذیرفته‌شده"


class AcceptanceStatus(models.TextChoices):
    UNASSIGNED = "UNASSIGNED", "ارجاع‌نشده"
    PENDING = "PENDING", "در انتظار پذیرش مسئول"
    ACCEPTED = "ACCEPTED", "پذیرفته‌شده توسط مسئول"
    REJECTED = "REJECTED", "رد شده"
    WITHDRAWAL_PENDING = "WITHDRAWAL_PENDING", "در انتظار تصمیم انصراف"


class PropertyRegistrationRequest(ScopeAlias, models.Model):
    code = models.CharField(max_length=40, unique=True, db_index=True, verbose_name="کد پرونده")
    contact = models.ForeignKey(Contact, on_delete=models.PROTECT, related_name="property_cases", verbose_name="شخص مرتبط")
    description = models.TextField(blank=True, verbose_name="شرح اولیه")
    lead_source = models.CharField(max_length=30, choices=LeadSource.choices, default=LeadSource.OWNER_REFERRAL, blank=True, verbose_name="منبع سرنخ")
    property_title = models.CharField(max_length=255, blank=True, verbose_name="عنوان ملک")
    legacy_scope_id = models.PositiveIntegerField(null=True, blank=True, editable=False)
    sales_range = models.ForeignKey("accounts.SalesRange", on_delete=models.PROTECT, null=True, blank=True, related_name="property_cases", verbose_name="رنج مسئول")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="created_property_cases", verbose_name="ثبت‌کننده")
    lead_status = models.CharField(max_length=20, choices=LeadStatus.choices, default=LeadStatus.PENDING, verbose_name="وضعیت پذیرش مدیر")
    lead_accepted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="accepted_property_cases", verbose_name="پذیرنده اولیه")
    lead_accepted_at = models.DateTimeField(null=True, blank=True, verbose_name="زمان پذیرش اولیه")
    acceptance_status = models.CharField(max_length=30, choices=AcceptanceStatus.choices, default=AcceptanceStatus.UNASSIGNED, verbose_name="وضعیت پذیرش مسئول")
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="assigned_property_cases", verbose_name="مسئول فعلی")
    assigned_at = models.DateTimeField(null=True, blank=True, verbose_name="زمان ارجاع")
    accepted_at = models.DateTimeField(null=True, blank=True, verbose_name="زمان پذیرش مسئول")
    due_at = models.DateTimeField(null=True, blank=True, verbose_name="موعد انجام")
    resulting_property = models.OneToOneField("properties.Property", on_delete=models.SET_NULL, null=True, blank=True, related_name="registration_case", verbose_name="ملک حاصل")
    status = models.CharField(max_length=20, choices=CaseStatus.choices, default=CaseStatus.ACTIVE, verbose_name="وضعیت پرونده")
    status_snapshot = models.JSONField(default=dict, blank=True, verbose_name="تصویر وضعیت پیش از بستن")
    is_legacy = models.BooleanField(default=False, db_index=True, verbose_name="پرونده انتقال‌یافته از داده‌های قدیمی")
    legacy_review_status = models.CharField(max_length=20, choices=LegacyReviewStatus.choices, default=LegacyReviewStatus.NOT_REQUIRED, db_index=True, verbose_name="وضعیت بازبینی داده قدیمی")
    legacy_review_notes = models.TextField(blank=True, verbose_name="یادداشت بازبینی داده قدیمی")
    legacy_reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="reviewed_legacy_property_cases", verbose_name="بازبین داده قدیمی")
    legacy_reviewed_at = models.DateTimeField(null=True, blank=True, verbose_name="زمان بازبینی داده قدیمی")
    duplicate_of = models.ForeignKey("self", on_delete=models.SET_NULL, null=True, blank=True, related_name="duplicates", verbose_name="پرونده اصلی")
    closure_reason = models.TextField(blank=True, verbose_name="دلیل بستن")
    version = models.PositiveIntegerField(default=1, verbose_name="نسخه")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="تاریخ ایجاد")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="تاریخ بروزرسانی")

    class Meta:
        verbose_name = "پرونده ثبت ملک"
        verbose_name_plural = "پرونده‌های ثبت ملک"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["sales_range", "lead_status", "acceptance_status"]), models.Index(fields=["assigned_to", "acceptance_status"])]

    def __str__(self):
        return self.code


class RegistrationRequestDealType(models.Model):
    registration_request = models.ForeignKey(PropertyRegistrationRequest, on_delete=models.CASCADE, related_name="desired_deal_types", verbose_name="پرونده ثبت ملک")
    deal_type = models.ForeignKey("basics.DealType", on_delete=models.PROTECT, related_name="registration_requests", verbose_name="نوع معامله")

    class Meta:
        verbose_name = "نوع عرضه مطلوب"
        verbose_name_plural = "انواع عرضه مطلوب"
        constraints = [models.UniqueConstraint(fields=["registration_request", "deal_type"], name="uq_case_deal_type")]


class PropertyAppraisal(models.Model):
    registration_request = models.OneToOneField(PropertyRegistrationRequest, on_delete=models.CASCADE, related_name="appraisal", verbose_name="پرونده ثبت ملک")
    property = models.ForeignKey("properties.Property", on_delete=models.CASCADE, null=True, blank=True, related_name="structured_appraisals", verbose_name="ملک")
    findings = models.JSONField(default=dict, blank=True, verbose_name="یافته‌های کارشناسی")
    report_text = models.TextField(blank=True, verbose_name="گزارش کارشناسی")
    visit_notes = models.TextField(blank=True, verbose_name="توضیحات بازدید")
    is_complete = models.BooleanField(default=False, verbose_name="کارشناسی کامل است")
    archived_reports = models.JSONField(default=list, blank=True, verbose_name="گزارش‌های بایگانی‌شده قبلی")
    version = models.PositiveIntegerField(default=1, verbose_name="نسخه")
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="updated_appraisals", verbose_name="آخرین ویرایش‌کننده")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="تاریخ ایجاد")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="تاریخ بروزرسانی")

    class Meta:
        verbose_name = "گزارش کارشناسی ساخت‌یافته"
        verbose_name_plural = "گزارش‌های کارشناسی ساخت‌یافته"


class PropertyReview(models.Model):
    class Decision(models.TextChoices):
        PENDING = "PENDING", "در انتظار تصمیم"
        APPROVED = "APPROVED", "تأیید شده"
        CHANGES_REQUIRED = "CHANGES_REQUIRED", "نیازمند اصلاح"

    property = models.ForeignKey("properties.Property", on_delete=models.CASCADE, related_name="reviews", verbose_name="ملک")
    registration_request = models.ForeignKey(PropertyRegistrationRequest, on_delete=models.SET_NULL, null=True, blank=True, related_name="property_reviews", verbose_name="پرونده ثبت ملک")
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="submitted_property_reviews", verbose_name="ارسال‌کننده")
    submitted_at = models.DateTimeField(auto_now_add=True, verbose_name="زمان ارسال")
    version = models.PositiveIntegerField(verbose_name="نسخه ارسالی")
    snapshot = models.JSONField(default=dict, blank=True, verbose_name="تصویر ملک هنگام ارسال")
    appraisal_snapshot = models.JSONField(default=dict, blank=True, verbose_name="تصویر کارشناسی هنگام ارسال")
    decision = models.CharField(max_length=20, choices=Decision.choices, default=Decision.PENDING, verbose_name="تصمیم")
    reason = models.TextField(blank=True, verbose_name="دلیل")
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="decided_property_reviews", verbose_name="بررسی‌کننده")
    reviewed_at = models.DateTimeField(null=True, blank=True, verbose_name="زمان تصمیم")

    class Meta:
        verbose_name = "بررسی ملک"
        verbose_name_plural = "بررسی‌های ملک"
        ordering = ["-submitted_at"]
        constraints = [models.UniqueConstraint(fields=["property", "version"], name="uq_property_review_version")]


class AssignmentHistory(models.Model):
    class SubjectType(models.TextChoices):
        PROPERTY_CASE = "PROPERTY_CASE", "پرونده ملک"
        INQUIRY = "INQUIRY", "درخواست متقاضی"

    class Action(models.TextChoices):
        ASSIGNED = "ASSIGNED", "ارجاع"
        ACCEPTED = "ACCEPTED", "پذیرش"
        REJECTED = "REJECTED", "رد ارجاع"
        REASSIGNED = "REASSIGNED", "تغییر مسئول"
        WITHDRAWAL_REQUESTED = "WITHDRAWAL_REQUESTED", "درخواست انصراف"
        WITHDRAWAL_APPROVED = "WITHDRAWAL_APPROVED", "تأیید انصراف"
        WITHDRAWAL_REJECTED = "WITHDRAWAL_REJECTED", "رد انصراف"
        EXTENSION_REQUESTED = "EXTENSION_REQUESTED", "درخواست تمدید"
        EXTENSION_APPROVED = "EXTENSION_APPROVED", "تأیید تمدید"
        EXTENSION_REJECTED = "EXTENSION_REJECTED", "رد تمدید"
        SCOPE_TRANSFERRED = "SCOPE_TRANSFERRED", "انتقال رنج"

    subject_type = models.CharField(max_length=20, choices=SubjectType.choices, verbose_name="نوع موضوع")
    property_case = models.ForeignKey(PropertyRegistrationRequest, on_delete=models.CASCADE, null=True, blank=True, related_name="assignment_history", verbose_name="پرونده ملک")
    inquiry = models.ForeignKey("crm.Inquiry", on_delete=models.CASCADE, null=True, blank=True, related_name="assignment_history", verbose_name="درخواست متقاضی")
    action = models.CharField(max_length=30, choices=Action.choices, verbose_name="رویداد")
    from_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="assignment_history_from", verbose_name="مسئول قبلی")
    to_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="assignment_history_to", verbose_name="مسئول جدید")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="assignment_actions", verbose_name="انجام‌دهنده")
    reason = models.TextField(blank=True, verbose_name="دلیل")
    old_due_at = models.DateTimeField(null=True, blank=True, verbose_name="موعد قبلی")
    new_due_at = models.DateTimeField(null=True, blank=True, verbose_name="موعد جدید")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="زمان ثبت")

    class Meta:
        verbose_name = "سابقه ارجاع"
        verbose_name_plural = "سوابق ارجاع"
        ordering = ["-created_at"]


class AssignmentRescheduleRequest(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "در انتظار تصمیم"
        APPROVED = "APPROVED", "تأیید شده"
        REJECTED = "REJECTED", "رد شده"
        CANCELLED = "CANCELLED", "لغو شده"

    property_case = models.ForeignKey(PropertyRegistrationRequest, on_delete=models.CASCADE, null=True, blank=True, related_name="reschedule_requests", verbose_name="پرونده ملک")
    inquiry = models.ForeignKey("crm.Inquiry", on_delete=models.CASCADE, null=True, blank=True, related_name="reschedule_requests", verbose_name="درخواست متقاضی")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING, verbose_name="وضعیت")
    requested_due_at = models.DateTimeField(verbose_name="موعد پیشنهادی")
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="requested_reschedules", verbose_name="درخواست‌کننده")
    requested_at = models.DateTimeField(auto_now_add=True, verbose_name="زمان درخواست")
    reason = models.TextField(verbose_name="دلیل")
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="decided_reschedules", verbose_name="تصمیم‌گیرنده")
    decided_at = models.DateTimeField(null=True, blank=True, verbose_name="زمان تصمیم")
    decision_reason = models.TextField(blank=True, verbose_name="دلیل تصمیم")

    class Meta:
        verbose_name = "درخواست تمدید موعد"
        verbose_name_plural = "درخواست‌های تمدید موعد"
        ordering = ["-requested_at"]


class ConsultantWithdrawalRequest(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "در انتظار تصمیم"
        APPROVED = "APPROVED", "تأیید شده"
        REJECTED = "REJECTED", "رد شده"
        CANCELLED = "CANCELLED", "لغو شده"

    property_case = models.ForeignKey(PropertyRegistrationRequest, on_delete=models.CASCADE, null=True, blank=True, related_name="withdrawal_requests", verbose_name="پرونده ملک")
    inquiry = models.ForeignKey("crm.Inquiry", on_delete=models.CASCADE, null=True, blank=True, related_name="withdrawal_requests", verbose_name="درخواست متقاضی")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING, verbose_name="وضعیت")
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="requested_withdrawals", verbose_name="درخواست‌کننده")
    requested_at = models.DateTimeField(auto_now_add=True, verbose_name="زمان درخواست")
    reason = models.TextField(verbose_name="دلیل")
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="decided_withdrawals", verbose_name="تصمیم‌گیرنده")
    decided_at = models.DateTimeField(null=True, blank=True, verbose_name="زمان تصمیم")
    decision_reason = models.TextField(blank=True, verbose_name="دلیل تصمیم")

    class Meta:
        verbose_name = "درخواست انصراف مسئول"
        verbose_name_plural = "درخواست‌های انصراف مسئول"
        ordering = ["-requested_at"]


class Inquiry(ScopeAlias, models.Model):
    code = models.CharField(max_length=40, unique=True, db_index=True, verbose_name="کد درخواست")
    contact = models.ForeignKey(Contact, on_delete=models.PROTECT, related_name="inquiries", verbose_name="متقاضی")
    description = models.TextField(blank=True, verbose_name="شرح اولیه")
    legacy_scope_id = models.PositiveIntegerField(null=True, blank=True, editable=False)
    sales_range = models.ForeignKey("accounts.SalesRange", on_delete=models.PROTECT, null=True, blank=True, related_name="inquiries", verbose_name="رنج مسئول")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="created_inquiries", verbose_name="ثبت‌کننده")
    lead_status = models.CharField(max_length=20, choices=LeadStatus.choices, default=LeadStatus.PENDING, verbose_name="وضعیت پذیرش مدیر")
    lead_accepted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="accepted_inquiries", verbose_name="پذیرنده اولیه")
    lead_accepted_at = models.DateTimeField(null=True, blank=True, verbose_name="زمان پذیرش اولیه")
    acceptance_status = models.CharField(max_length=30, choices=AcceptanceStatus.choices, default=AcceptanceStatus.UNASSIGNED, verbose_name="وضعیت پذیرش مسئول")
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="assigned_inquiries", verbose_name="مسئول فعلی")
    assigned_at = models.DateTimeField(null=True, blank=True, verbose_name="زمان ارجاع")
    accepted_at = models.DateTimeField(null=True, blank=True, verbose_name="زمان پذیرش مسئول")
    due_at = models.DateTimeField(null=True, blank=True, verbose_name="موعد انجام")
    needs_confirmed_at = models.DateTimeField(null=True, blank=True, verbose_name="زمان تأیید نیاز")
    status = models.CharField(max_length=20, choices=CaseStatus.choices, default=CaseStatus.ACTIVE, verbose_name="وضعیت درخواست")
    duplicate_of = models.ForeignKey("self", on_delete=models.SET_NULL, null=True, blank=True, related_name="duplicates", verbose_name="درخواست اصلی")
    closure_reason = models.TextField(blank=True, verbose_name="دلیل بستن")
    version = models.PositiveIntegerField(default=1, verbose_name="نسخه")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="تاریخ ایجاد")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="تاریخ بروزرسانی")

    class Meta:
        verbose_name = "درخواست متقاضی"
        verbose_name_plural = "درخواست‌های متقاضی"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["sales_range", "lead_status", "acceptance_status"]), models.Index(fields=["assigned_to", "acceptance_status"])]

    def __str__(self):
        return self.code


class InquiryPreference(models.Model):
    inquiry = models.ForeignKey(Inquiry, on_delete=models.CASCADE, related_name="preferences", verbose_name="درخواست متقاضی")
    deal_type = models.ForeignKey("basics.DealType", on_delete=models.PROTECT, related_name="inquiry_preferences", verbose_name="نوع معامله")
    deal_type_version = models.ForeignKey("basics.DealTypeVersion", on_delete=models.PROTECT, null=True, blank=True, related_name="inquiry_preferences", verbose_name="نسخه نوع معامله")
    min_amount = models.DecimalField(max_digits=18, decimal_places=0, null=True, blank=True, verbose_name="حداقل مبلغ")
    max_amount = models.DecimalField(max_digits=18, decimal_places=0, null=True, blank=True, verbose_name="حداکثر مبلغ")
    max_deposit = models.DecimalField(max_digits=18, decimal_places=0, null=True, blank=True, verbose_name="حداکثر ودیعه")
    max_monthly_rent = models.DecimalField(max_digits=18, decimal_places=0, null=True, blank=True, verbose_name="حداکثر اجاره ماهانه")
    min_area = models.PositiveIntegerField(null=True, blank=True, verbose_name="حداقل متراژ")
    max_area = models.PositiveIntegerField(null=True, blank=True, verbose_name="حداکثر متراژ")
    criteria = models.JSONField(default=dict, blank=True, verbose_name="شروط و معیارها")
    districts = models.ManyToManyField("basics.District", blank=True, related_name="inquiry_preferences", verbose_name="مناطق مطلوب")
    property_types = models.ManyToManyField("basics.PropertyType", blank=True, related_name="inquiry_preferences", verbose_name="انواع ملک مطلوب")

    class Meta:
        verbose_name = "نیاز و بودجه متقاضی"
        verbose_name_plural = "نیازها و بودجه‌های متقاضی"
        constraints = [models.UniqueConstraint(fields=["inquiry", "deal_type"], name="uq_inquiry_preference_deal_type")]


class Introduction(models.Model):
    class Status(models.TextChoices):
        OPEN = "OPEN", "باز"
        CLOSED = "CLOSED", "بسته"

    class Interest(models.TextChoices):
        UNKNOWN = "UNKNOWN", "بی‌پاسخ"
        INTERESTED = "INTERESTED", "علاقه‌مند"
        NOT_INTERESTED = "NOT_INTERESTED", "بدون علاقه"

    inquiry = models.ForeignKey(Inquiry, on_delete=models.CASCADE, related_name="introductions", verbose_name="درخواست متقاضی")
    property_file = models.ForeignKey("listings.PropertyFile", on_delete=models.PROTECT, db_column="listing_id", related_name="introductions", verbose_name="فایل")
    introduced_terms_snapshot = models.JSONField(default=dict, blank=True, verbose_name="تصویر شرایط هنگام معرفی")
    introduced_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="created_introductions", verbose_name="معرفی‌کننده")
    buyer_consultant = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="buyer_introductions", verbose_name="مشاور متقاضی")
    seller_consultant = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="seller_introductions", verbose_name="مشاور ملک")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN, verbose_name="وضعیت")
    customer_interest = models.CharField(max_length=20, choices=Interest.choices, default=Interest.UNKNOWN, verbose_name="علاقه متقاضی")
    feedback = models.TextField(blank=True, verbose_name="بازخورد")
    rejection_reason = models.TextField(blank=True, verbose_name="دلیل رد")
    version = models.PositiveIntegerField(default=1, verbose_name="نسخه")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="تاریخ ایجاد")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="تاریخ بروزرسانی")

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
        verbose_name = "معرفی فایل"
        verbose_name_plural = "معرفی‌های فایل"
        ordering = ["-created_at"]
        constraints = [models.UniqueConstraint(fields=["inquiry", "property_file"], condition=models.Q(status="OPEN"), name="uq_open_introduction_pair")]


class Viewing(models.Model):
    class Result(models.TextChoices):
        PENDING = "PENDING", "در انتظار نتیجه"
        INTERESTED = "INTERESTED", "مورد پسند"
        NOT_INTERESTED = "NOT_INTERESTED", "مورد پسند نیست"

    introduction = models.ForeignKey(Introduction, on_delete=models.CASCADE, related_name="viewings", verbose_name="معرفی")
    scheduled_at = models.DateTimeField(verbose_name="زمان بازدید")
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="assigned_viewings", verbose_name="مسئول بازدید")
    companion_id = models.PositiveIntegerField(null=True, blank=True, verbose_name="شناسه همراه")
    result = models.CharField(max_length=20, choices=Result.choices, default=Result.PENDING, verbose_name="نتیجه")
    notes = models.TextField(blank=True, verbose_name="یادداشت نتیجه")
    task = models.ForeignKey("tasks.Task", on_delete=models.SET_NULL, null=True, blank=True, related_name="viewings", verbose_name="وظیفه مرتبط")
    completed_at = models.DateTimeField(null=True, blank=True, verbose_name="زمان ثبت نتیجه")
    version = models.PositiveIntegerField(default=1, verbose_name="نسخه")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="تاریخ ایجاد")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="تاریخ بروزرسانی")

    class Meta:
        verbose_name = "بازدید مشتری"
        verbose_name_plural = "بازدیدهای مشتری"
        ordering = ["scheduled_at"]


class Deal(models.Model):
    class Stage(models.TextChoices):
        NEGOTIATION = "NEGOTIATION", "مذاکره"
        AGREED = "AGREED", "توافق‌شده"
        CONTRACT = "CONTRACT", "تنظیم قرارداد"
        LOST = "LOST", "ناموفق"
        FINALIZED = "FINALIZED", "نهایی‌شده"

    introduction = models.ForeignKey(Introduction, on_delete=models.PROTECT, related_name="deals", verbose_name="معرفی")
    viewing = models.ForeignKey(Viewing, on_delete=models.PROTECT, null=True, blank=True, related_name="deals", verbose_name="بازدید مبنا")
    property_file = models.ForeignKey("listings.PropertyFile", on_delete=models.PROTECT, db_column="listing_id", related_name="deals", verbose_name="فایل")
    inquiry = models.ForeignKey(Inquiry, on_delete=models.PROTECT, related_name="deals", verbose_name="درخواست متقاضی")
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="assigned_deals", verbose_name="مسئول مذاکره")
    deal_type_version = models.ForeignKey("basics.DealTypeVersion", on_delete=models.PROTECT, null=True, blank=True, related_name="deals", verbose_name="نسخه نوع معامله")
    stage = models.CharField(max_length=20, choices=Stage.choices, default=Stage.NEGOTIATION, verbose_name="مرحله")
    result_notes = models.TextField(blank=True, verbose_name="توضیحات نتیجه")
    closure_reason = models.TextField(blank=True, verbose_name="دلیل عدم توافق")
    started_at = models.DateTimeField(auto_now_add=True, verbose_name="زمان شروع")
    closed_at = models.DateTimeField(null=True, blank=True, verbose_name="زمان بستن")
    version = models.PositiveIntegerField(default=1, verbose_name="نسخه")

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
        verbose_name = "پرونده مذاکره"
        verbose_name_plural = "پرونده‌های مذاکره"
        ordering = ["-started_at"]


class DealParticipant(models.Model):
    class Role(models.TextChoices):
        BUYER = "BUYER", "خریدار"
        SELLER = "SELLER", "فروشنده"
        TENANT = "TENANT", "مستأجر"
        LANDLORD = "LANDLORD", "موجر"
        REPRESENTATIVE = "REPRESENTATIVE", "نماینده"

    deal = models.ForeignKey(Deal, on_delete=models.CASCADE, related_name="participants", verbose_name="پرونده مذاکره")
    contact = models.ForeignKey(Contact, on_delete=models.PROTECT, related_name="deal_participations", verbose_name="شخص")
    participant_role = models.CharField(max_length=20, choices=Role.choices, verbose_name="نقش در معامله")
    is_primary = models.BooleanField(default=False, verbose_name="طرف اصلی")

    class Meta:
        verbose_name = "طرف مذاکره"
        verbose_name_plural = "طرفین مذاکره"
        constraints = [models.UniqueConstraint(fields=["deal", "contact", "participant_role"], name="uq_deal_participant")]


class Contract(models.Model):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "پیش‌نویس"
        SIGNING = "SIGNING", "در حال امضا"
        FINALIZED = "FINALIZED", "قطعی"

    deal = models.OneToOneField(Deal, on_delete=models.PROTECT, related_name="contract", verbose_name="پرونده مذاکره")
    contract_number = models.CharField(max_length=60, unique=True, db_index=True, verbose_name="شماره قرارداد")
    deal_type_version = models.ForeignKey("basics.DealTypeVersion", on_delete=models.PROTECT, null=True, blank=True, related_name="contracts", verbose_name="نسخه نوع معامله")
    terms_snapshot = models.JSONField(default=dict, blank=True, verbose_name="تصویر شرایط قرارداد")
    terms_history = models.JSONField(default=list, blank=True, verbose_name="تاریخچه شرایط قرارداد")
    sale_price = models.DecimalField(max_digits=18, decimal_places=0, null=True, blank=True, verbose_name="مبلغ فروش")
    deposit = models.DecimalField(max_digits=18, decimal_places=0, null=True, blank=True, verbose_name="مبلغ ودیعه")
    monthly_rent = models.DecimalField(max_digits=18, decimal_places=0, null=True, blank=True, verbose_name="اجاره ماهانه")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT, verbose_name="وضعیت")
    signed_at = models.DateTimeField(null=True, blank=True, verbose_name="زمان تکمیل امضاها")
    effective_at = models.DateTimeField(null=True, blank=True, verbose_name="زمان اثر")
    finalized_at = models.DateTimeField(null=True, blank=True, verbose_name="زمان قطعی‌سازی")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="created_contracts", verbose_name="ایجادکننده")
    finalized_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="finalized_contracts", verbose_name="قطعی‌کننده")
    version = models.PositiveIntegerField(default=1, verbose_name="نسخه")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="تاریخ ایجاد")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="تاریخ بروزرسانی")

    class Meta:
        verbose_name = "قرارداد"
        verbose_name_plural = "قراردادها"
        ordering = ["-created_at"]


class ContractParty(models.Model):
    contract = models.ForeignKey(Contract, on_delete=models.CASCADE, related_name="parties", verbose_name="قرارداد")
    contact = models.ForeignKey(Contact, on_delete=models.PROTECT, related_name="contract_parties", verbose_name="شخص")
    party_role = models.CharField(max_length=30, verbose_name="نقش در قرارداد")
    identity_snapshot = models.JSONField(default=dict, blank=True, verbose_name="تصویر هویت هنگام تنظیم")

    class Meta:
        verbose_name = "طرف قرارداد"
        verbose_name_plural = "طرفین قرارداد"
        constraints = [models.UniqueConstraint(fields=["contract", "contact", "party_role"], name="uq_contract_party")]


class ContractSignature(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "در انتظار امضا"
        SIGNED = "SIGNED", "امضا شده"

    contract_party = models.OneToOneField(ContractParty, on_delete=models.CASCADE, related_name="signature", verbose_name="طرف قرارداد")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING, verbose_name="وضعیت")
    signed_at = models.DateTimeField(null=True, blank=True, verbose_name="زمان امضا")
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="recorded_signatures", verbose_name="ثبت‌کننده")

    class Meta:
        verbose_name = "امضای قرارداد"
        verbose_name_plural = "امضاهای قرارداد"


class ContractAttachment(models.Model):
    contract = models.ForeignKey(Contract, on_delete=models.CASCADE, related_name="attachments", verbose_name="قرارداد")
    document_type = models.CharField(max_length=80, blank=True, verbose_name="نوع مدرک")
    file = models.FileField(upload_to="contracts/attachments/", null=True, blank=True, verbose_name="فایل")
    filename = models.CharField(max_length=255, blank=True, verbose_name="نام فایل")
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="uploaded_contract_attachments", verbose_name="بارگذاری‌کننده")
    uploaded_at = models.DateTimeField(auto_now_add=True, verbose_name="زمان بارگذاری")

    class Meta:
        verbose_name = "پیوست قرارداد"
        verbose_name_plural = "پیوست‌های قرارداد"
        ordering = ["-uploaded_at"]


class ContractAmendment(models.Model):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "پیش‌نویس"
        APPROVED = "APPROVED", "تأیید شده"

    contract = models.ForeignKey(Contract, on_delete=models.CASCADE, related_name="amendments", verbose_name="قرارداد")
    amendment_number = models.PositiveIntegerField(verbose_name="شماره اصلاحیه")
    reason = models.TextField(verbose_name="دلیل")
    previous_terms_snapshot = models.JSONField(default=dict, blank=True, verbose_name="شرایط قبلی")
    new_terms_snapshot = models.JSONField(default=dict, blank=True, verbose_name="شرایط جدید")
    effective_at = models.DateTimeField(null=True, blank=True, verbose_name="زمان اثر")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT, verbose_name="وضعیت")
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="approved_amendments", verbose_name="تأییدکننده")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="تاریخ ایجاد")

    class Meta:
        verbose_name = "اصلاحیه قرارداد"
        verbose_name_plural = "اصلاحیه‌های قرارداد"
        ordering = ["amendment_number"]
        constraints = [models.UniqueConstraint(fields=["contract", "amendment_number"], name="uq_contract_amendment_number")]


class CommissionPolicyVersion(models.Model):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "پیش‌نویس"
        PUBLISHED = "PUBLISHED", "منتشرشده"
        ARCHIVED = "ARCHIVED", "بایگانی‌شده"

    class CalculationMethod(models.TextChoices):
        PERCENT = "PERCENT", "درصدی"
        FLAT = "FLAT", "مبلغ ثابت"

    name = models.CharField(max_length=160, verbose_name="نام سیاست")
    deal_type = models.ForeignKey("basics.DealType", on_delete=models.PROTECT, related_name="commission_policies", verbose_name="نوع معامله")
    version_number = models.PositiveIntegerField(verbose_name="شماره نسخه")
    calculation_method = models.CharField(max_length=20, choices=CalculationMethod.choices, verbose_name="روش محاسبه")
    parameters = models.JSONField(default=dict, blank=True, verbose_name="پارامترهای محاسبه")
    rounding_rule = models.CharField(max_length=80, blank=True, verbose_name="قاعده گرد کردن")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT, verbose_name="وضعیت")
    effective_from = models.DateTimeField(null=True, blank=True, verbose_name="اثر از")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="created_commission_policies", verbose_name="ایجادکننده")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="تاریخ ایجاد")

    class Meta:
        verbose_name = "نسخه سیاست کمیسیون"
        verbose_name_plural = "نسخه‌های سیاست کمیسیون"
        ordering = ["name", "version_number"]
        constraints = [models.UniqueConstraint(fields=["deal_type", "version_number"], name="uq_policy_deal_type_version")]


class Commission(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "در انتظار تأیید"
        APPROVED = "APPROVED", "تأیید شده"
        PARTIALLY_PAID = "PARTIALLY_PAID", "وصول جزئی"
        PAID = "PAID", "تسویه‌شده"

    contract = models.ForeignKey(Contract, on_delete=models.PROTECT, related_name="commissions", verbose_name="قرارداد")
    debtor_contact = models.ForeignKey(Contact, on_delete=models.PROTECT, related_name="commissions", verbose_name="بدهکار")
    policy_version = models.ForeignKey(CommissionPolicyVersion, on_delete=models.PROTECT, null=True, blank=True, related_name="commissions", verbose_name="نسخه سیاست")
    calculation_snapshot = models.JSONField(default=dict, blank=True, verbose_name="تصویر محاسبه")
    calculated_amount = models.DecimalField(max_digits=18, decimal_places=0, default=0, verbose_name="مبلغ محاسبه‌شده")
    adjustment_amount = models.DecimalField(max_digits=18, decimal_places=0, default=0, verbose_name="مبلغ تعدیل")
    final_amount = models.DecimalField(max_digits=18, decimal_places=0, default=0, verbose_name="مبلغ نهایی")
    adjustment_reason = models.TextField(blank=True, verbose_name="دلیل تعدیل")
    due_at = models.DateTimeField(null=True, blank=True, verbose_name="سررسید")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING, verbose_name="وضعیت")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="تاریخ ایجاد")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="تاریخ بروزرسانی")

    class Meta:
        verbose_name = "مطالبه کمیسیون"
        verbose_name_plural = "مطالبات کمیسیون"
        ordering = ["-created_at"]
        constraints = [models.UniqueConstraint(fields=["contract", "debtor_contact"], name="uq_commission_contract_debtor")]


class CommissionShare(models.Model):
    class BeneficiaryType(models.TextChoices):
        USER = "USER", "کاربر"
        COMPANY = "COMPANY", "مجموعه"

    class Status(models.TextChoices):
        PENDING = "PENDING", "در انتظار تأیید"
        APPROVED = "APPROVED", "تأیید شده"
        PARTIALLY_PAID = "PARTIALLY_PAID", "پرداخت جزئی"
        PAID = "PAID", "پرداخت‌شده"

    commission = models.ForeignKey(Commission, on_delete=models.CASCADE, related_name="shares", verbose_name="مطالبه کمیسیون")
    beneficiary_type = models.CharField(max_length=20, choices=BeneficiaryType.choices, default=BeneficiaryType.USER, verbose_name="نوع ذی‌نفع")
    beneficiary_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="commission_shares", verbose_name="ذی‌نفع")
    share_percent = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True, verbose_name="درصد سهم")
    amount = models.DecimalField(max_digits=18, decimal_places=0, default=0, verbose_name="مبلغ سهم")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING, verbose_name="وضعیت")

    class Meta:
        verbose_name = "سهم کمیسیون"
        verbose_name_plural = "سهم‌های کمیسیون"
        ordering = ["id"]


class Payment(models.Model):
    class Direction(models.TextChoices):
        IN = "IN", "دریافت"
        OUT = "OUT", "پرداخت"

    class Status(models.TextChoices):
        CONFIRMED = "CONFIRMED", "تأیید شده"
        REVERSED = "REVERSED", "برگشت‌خورده"

    direction = models.CharField(max_length=10, choices=Direction.choices, verbose_name="جهت")
    contact = models.ForeignKey(Contact, on_delete=models.PROTECT, null=True, blank=True, related_name="payments", verbose_name="شخص")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="payments", verbose_name="کاربر")
    amount = models.DecimalField(max_digits=18, decimal_places=0, verbose_name="مبلغ")
    paid_at = models.DateTimeField(verbose_name="زمان پرداخت")
    method = models.CharField(max_length=80, blank=True, verbose_name="روش پرداخت")
    reference_number = models.CharField(max_length=120, blank=True, db_index=True, verbose_name="شماره مرجع")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.CONFIRMED, verbose_name="وضعیت")
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="recorded_payments", verbose_name="ثبت‌کننده")
    reversal_of = models.OneToOneField("self", on_delete=models.PROTECT, null=True, blank=True, related_name="reversal", verbose_name="سند برگشتی از")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="تاریخ ایجاد")

    class Meta:
        verbose_name = "وجه"
        verbose_name_plural = "وجوه"
        ordering = ["-paid_at"]


class PaymentAllocation(models.Model):
    payment = models.ForeignKey(Payment, on_delete=models.CASCADE, related_name="allocations", verbose_name="وجه")
    commission = models.ForeignKey(Commission, on_delete=models.PROTECT, null=True, blank=True, related_name="allocations", verbose_name="مطالبه کمیسیون")
    commission_share = models.ForeignKey(CommissionShare, on_delete=models.PROTECT, null=True, blank=True, related_name="allocations", verbose_name="سهم کمیسیون")
    amount = models.DecimalField(max_digits=18, decimal_places=0, verbose_name="مبلغ تخصیص")

    class Meta:
        verbose_name = "تخصیص وجه"
        verbose_name_plural = "تخصیص‌های وجه"
        ordering = ["id"]


class StageTransitionHistory(models.Model):
    subject_type = models.CharField(max_length=40, db_index=True, verbose_name="نوع موضوع")
    subject_id = models.PositiveIntegerField(db_index=True, verbose_name="شناسه موضوع")
    from_stage = models.CharField(max_length=60, blank=True, verbose_name="مرحله قبلی")
    to_stage = models.CharField(max_length=60, blank=True, verbose_name="مرحله جدید")
    reason = models.TextField(blank=True, verbose_name="دلیل")
    changed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="stage_transitions", verbose_name="انجام‌دهنده")
    changed_at = models.DateTimeField(auto_now_add=True, verbose_name="زمان تغییر")
    operation_id = models.CharField(max_length=80, blank=True, db_index=True, verbose_name="شناسه عملیات")

    class Meta:
        verbose_name = "سابقه تغییر مرحله"
        verbose_name_plural = "سوابق تغییر مرحله"
        ordering = ["-changed_at"]


class CommandReceipt(models.Model):
    idempotency_key = models.CharField(max_length=120, verbose_name="کلید تکرار امن")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="command_receipts", verbose_name="انجام‌دهنده")
    action = models.CharField(max_length=80, verbose_name="فرمان")
    request_hash = models.CharField(max_length=64, verbose_name="هش درخواست")
    result = models.JSONField(default=dict, blank=True, verbose_name="نتیجه")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="زمان ثبت")

    class Meta:
        verbose_name = "رسید فرمان"
        verbose_name_plural = "رسیدهای فرمان"
        constraints = [models.UniqueConstraint(fields=["actor", "action", "idempotency_key"], name="uq_command_receipt")]


class WorkflowSettings(models.Model):
    assignment_waiting_hours = models.PositiveIntegerField(default=48, verbose_name="مهلت پاسخ ارجاع (ساعت)")
    default_assignment_due_days = models.PositiveIntegerField(default=5, verbose_name="مهلت پیش‌فرض انجام ارجاع (روز)")
    withdrawal_decision_note_required = models.BooleanField(default=False, verbose_name="الزام دلیل تصمیم انصراف")
    extension_decision_note_required = models.BooleanField(default=False, verbose_name="الزام دلیل تصمیم تمدید")
    stall_threshold_days = models.PositiveIntegerField(default=7, verbose_name="آستانه هشدار توقف (روز)")
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="updated_workflow_settings", verbose_name="آخرین ویرایش‌کننده")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="زمان آخرین ویرایش")

    class Meta:
        verbose_name = "تنظیمات جریان کار"
        verbose_name_plural = "تنظیمات جریان کار"

    def __str__(self):
        return "تنظیمات جریان کار"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


PropertyContact = PropertyParty
