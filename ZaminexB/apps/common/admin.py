from datetime import datetime

from django import forms
from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied, ValidationError
from django.http import HttpResponseNotAllowed
from django.shortcuts import redirect
from django.urls import path, reverse
from django.utils import timezone
from django.utils.html import format_html, format_html_join

from .crypto import SecretDecryptionError, decrypt_secret
from .models import AIConfiguration, CompanySettings


def read_probe_result(settings_row) -> dict | None:
    value = settings_row.ai_last_test
    return value if isinstance(value, dict) else None


def store_probe_result(settings_row, result: dict) -> None:
    settings_row.ai_last_test = result
    settings_row.save(update_fields=["ai_last_test"])


class AIApiKeyFormMixin:
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["ai_api_key"].required = False
        self.fields["ai_api_key"].help_text = (
            "کلید هرگز نمایش داده نمی‌شود. برای حفظ کلید فعلی خالی بگذارید؛ "
            "برای جایگزینی، کلید جدید را وارد کنید."
        )

    def clean(self):
        cleaned_data = super().clean()
        key = cleaned_data.get("ai_api_key") or ""
        clear_key = cleaned_data.get("clear_ai_api_key", False)

        if clear_key and key:
            self.add_error(
                "ai_api_key",
                "برای حذف کلید، فیلد کلید را خالی بگذارید.",
            )
        elif clear_key:
            cleaned_data["ai_api_key"] = ""
        elif not key and self.instance.pk and self.instance.ai_api_key:
            try:
                decrypt_secret(self.instance.ai_api_key)
            except SecretDecryptionError as exc:
                self.add_error("ai_api_key", ValidationError(str(exc)))
            else:
                cleaned_data["ai_api_key"] = self.instance.ai_api_key

        return cleaned_data


class CompanySettingsAdminForm(forms.ModelForm):
    class Meta:
        model = CompanySettings
        fields = ("company_name", "license_number", "email", "phone", "address")


class AIConfigurationAdminForm(AIApiKeyFormMixin, forms.ModelForm):
    clear_ai_api_key = forms.BooleanField(
        required=False,
        label="حذف کلید ذخیره‌شده",
        help_text="برای حذف کلید ثبت‌شده این گزینه را فعال کنید.",
    )

    class Meta:
        model = AIConfiguration
        fields = ("ai_enabled", "ai_api_base_url", "ai_api_key", "ai_model")
        widgets = {
            "ai_api_key": forms.PasswordInput(
                attrs={"autocomplete": "new-password"}, render_value=False
            ),
        }


@admin.register(CompanySettings)
class CompanySettingsAdmin(admin.ModelAdmin):
    form = CompanySettingsAdminForm
    list_display = ['company_name', 'email', 'phone', 'updated_at']
    fieldsets = (
        (
            "اطلاعات شرکت",
            {"fields": ("company_name", "license_number", "email", "phone", "address")},
        ),
        (
            "هوش مصنوعی (API مرکزی)",
            {
                "fields": ("ai_settings_link",),
                "description": (
                    "تنظیمات سرویس تحلیل هوش مصنوعی در بخش مستقل "
                    "«تنظیمات هوش مصنوعی (API مرکزی)» مدیریت می‌شود."
                ),
            },
        ),
    )
    readonly_fields = ("ai_settings_link",)

    def get_queryset(self, request):
        CompanySettings.get_solo()
        return super().get_queryset(request).filter(pk=1)

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    @admin.display(description="بخش تنظیمات API")
    def ai_settings_link(self, obj):
        url = reverse("admin:common_aiconfiguration_change", args=[obj.pk])
        return format_html(
            '<a class="button" href="{}">ورود به تنظیمات هوش مصنوعی (API مرکزی)</a>',
            url,
        )


@admin.register(AIConfiguration)
class AIConfigurationAdmin(admin.ModelAdmin):
    form = AIConfigurationAdminForm
    change_form_template = "admin/common/aiconfiguration/change_form.html"
    fieldsets = (
        (
            "وضعیت فعلی سرویس",
            {
                "fields": ("ai_status_panel",),
                "description": (
                    "این بخش فقط خواندنی است و وضعیت لحظه‌ای پیکربندی و آخرین "
                    "آزمون اتصال را نشان می‌دهد."
                ),
            },
        ),
        (
            "مشخصات API مرکزی",
            {
                "fields": (
                    "ai_enabled",
                    "ai_api_base_url",
                    "ai_api_key",
                    "clear_ai_api_key",
                    "ai_model",
                ),
                "description": (
                    "سامانه تحلیل‌های هوش مصنوعی (توصیف ملک و کارشناس) را با همین "
                    "مشخصات به سرویس مرکزی می‌فرستد. نشانی پایه باید HTTPS عمومی "
                    "و سازگار با قالب OpenAI Chat Completions باشد؛ مسیر "
                    "<code>/chat/completions</code> خودکار افزوده می‌شود."
                ),
            },
        ),
    )
    readonly_fields = ("ai_status_panel",)

    def get_queryset(self, request):
        AIConfiguration.get_solo()
        return super().get_queryset(request).filter(pk=1)

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def has_view_permission(self, request, obj=None):
        return (
            super().has_view_permission(request, obj)
            or request.user.has_perm("common.view_companysettings")
            or request.user.has_perm("common.change_companysettings")
        )

    def has_change_permission(self, request, obj=None):
        return super().has_change_permission(request, obj) or request.user.has_perm(
            "common.change_companysettings"
        )

    def changelist_view(self, request, extra_context=None):
        settings_row = CompanySettings.get_solo()
        options = self.model._meta
        return redirect(
            reverse(
                "admin:%s_%s_change" % (options.app_label, options.model_name),
                args=[settings_row.pk],
            )
        )

    def get_urls(self):
        custom = [
            path(
                "test-connection/",
                self.admin_site.admin_view(self.test_connection_view),
                name="common_aiconfiguration_test_connection",
            ),
        ]
        return custom + super().get_urls()

    def changeform_view(self, request, object_id=None, form_url="", extra_context=None):
        extra_context = extra_context or {}
        options = self.model._meta
        extra_context["ai_test_url"] = reverse(
            "admin:common_aiconfiguration_test_connection"
        )
        extra_context["ai_back_url"] = reverse(
            "admin:%s_%s_change" % (options.app_label, options.model_name),
            args=[object_id or 1],
        )
        return super().changeform_view(request, object_id, form_url, extra_context)

    def test_connection_view(self, request):
        if request.method != "POST":
            return HttpResponseNotAllowed(["POST"])

        from apps.analytics.ai_service import probe_ai_connection

        settings_row = CompanySettings.get_solo()
        if not self.has_change_permission(request, settings_row):
            raise PermissionDenied

        form = self.form(request.POST, instance=settings_row)
        options = self.model._meta
        change_url = reverse(
            "admin:%s_%s_change" % (options.app_label, options.model_name),
            args=[settings_row.pk],
        )

        if not form.is_valid():
            details = " | ".join(
                "{label}: {errors}".format(
                    label=form.fields[field].label or field,
                    errors=" ".join(errors),
                )
                for field, errors in form.errors.items()
                if field in form.fields
            )
            self.message_user(
                request,
                "تنظیمات ذخیره نشد؛ پیش از آزمون اتصال این موارد را اصلاح کنید: "
                + (details or "خطای نامشخص در فرم."),
                level=messages.ERROR,
            )
            return redirect(change_url)

        form.save()
        result = probe_ai_connection()
        result["checkedAt"] = timezone.now().isoformat()
        store_probe_result(settings_row, result)

        if result["ok"]:
            self.message_user(
                request,
                "اتصال موفق بود؛ سرویس «{provider}» با مدل «{model}» در "
                "{latency} میلی‌ثانیه پاسخ داد. نمونهٔ پاسخ: {sample}".format(
                    provider=result["provider"],
                    model=result["model"],
                    latency=f"{result['latencyMs']:,}",
                    sample=result["sample"] or "—",
                ),
                level=messages.SUCCESS,
            )
        else:
            self.message_user(
                request,
                "آزمون اتصال ناموفق بود: {error}".format(error=result["error"])
                + (f" | پاسخ سرویس: {result['detail']}" if result["detail"] else "")
                + " تنظیمات ذخیره شد؛ پس از اصلاح مقادیر، آزمون را تکرار کنید.",
                level=messages.ERROR,
            )

        return redirect(change_url)

    @admin.display(description="وضعیت و آخرین آزمون اتصال")
    def ai_status_panel(self, obj):
        from apps.analytics.ai_service import (
            identify_ai_provider,
            probe_endpoint,
        )

        active = bool(obj.ai_enabled and (obj.ai_api_base_url or "").strip())
        provider = (
            identify_ai_provider(obj.ai_api_base_url, obj.ai_model)
            if (obj.ai_api_base_url or "").strip()
            else "—"
        )
        rows = [
            ("وضعیت قابلیت", "فعال" if obj.ai_enabled else "غیرفعال"),
            ("آمادهٔ استفاده در تحلیل‌ها", "بله" if active else "خیر"),
            ("سرویس‌دهندهٔ شناسایی‌شده", provider),
            ("نام مدل", (obj.ai_model or "").strip() or "—"),
            ("نشانی نهایی درخواست", probe_endpoint() or "—"),
            ("کلید API", "ثبت شده است" if obj.ai_api_key else "ثبت نشده است"),
        ]

        probe = read_probe_result(obj)
        if probe is None:
            probe_row = (
                "آخرین آزمون اتصال",
                format_html(
                    '<span class="ai-badge ai-badge-muted">{}</span>',
                    "هنوز آزمونی انجام نشده است",
                ),
            )
        else:
            checked = probe.get("checkedAt") or ""
            try:
                checked = datetime.fromisoformat(checked).strftime("%Y-%m-%d %H:%M")
            except (TypeError, ValueError):
                checked = checked or "—"
            if probe.get("ok"):
                summary = format_html(
                    '<span class="ai-badge ai-badge-ok">{}</span> · زمان پاسخ {} میلی‌ثانیه · {}',
                    "موفق",
                    f"{int(probe.get('latencyMs') or 0):,}",
                    checked,
                )
                sample = probe.get("sample") or ""
                if sample:
                    summary = format_html(
                        '{}<div class="ai-sample">نمونهٔ پاسخ: {}</div>',
                        summary,
                        sample,
                    )
            else:
                summary = format_html(
                    '<span class="ai-badge ai-badge-fail">{}</span> · {} · {}',
                    "ناموفق",
                    probe.get("error") or "خطای نامشخص",
                    checked,
                )
                detail = probe.get("detail") or ""
                if detail:
                    summary = format_html(
                        '{}<div class="ai-sample">پاسخ سرویس: {}</div>',
                        summary,
                        detail,
                    )
            probe_row = ("آخرین آزمون اتصال", summary)

        cells = format_html_join(
            "",
            "<tr><th>{}</th><td>{}</td></tr>",
            ((label, value) for label, value in rows + [probe_row]),
        )
        return format_html(
            '<div class="ai-status"><table class="ai-status-table">{}</table></div>',
            cells,
        )
