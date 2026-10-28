from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def map_crm_ranges_and_flag_legacy_data(apps, schema_editor):
    LegacyManagementScope = apps.get_model("accounts", "LegacyManagementScope")
    ScopeMembership = apps.get_model("accounts", "ScopeMembership")
    ScopeTransferHistory = apps.get_model("accounts", "ScopeTransferHistory")
    PropertyCase = apps.get_model("crm", "PropertyRegistrationRequest")
    Inquiry = apps.get_model("crm", "Inquiry")
    Contact = apps.get_model("crm", "Contact")
    Property = apps.get_model("properties", "Property")
    alias = schema_editor.connection.alias

    for membership in ScopeMembership.objects.using(alias).select_related("scope", "user").iterator():
        if membership.scope_id and membership.scope and membership.scope.sales_range_id:
            membership.sales_range_id = membership.scope.sales_range_id
            membership.save(update_fields=["sales_range"], using=alias)
            if membership.ended_at is None:
                target = membership.scope.sales_range
                if membership.membership_role == "MANAGER":
                    target.managers.add(membership.user)
                elif membership.membership_role == "MEMBER":
                    target.members.add(membership.user)

    for case in PropertyCase.objects.using(alias).select_related("scope", "contact", "resulting_property").iterator():
        updates = []
        if case.scope_id and case.scope and case.scope.sales_range_id:
            case.sales_range_id = case.scope.sales_range_id
            updates.append("sales_range")
        if case.code.startswith("R-LEGACY-"):
            case.is_legacy = True
            case.legacy_review_status = "NEEDS_REVIEW"
            updates.extend(["is_legacy", "legacy_review_status"])
            prop = case.resulting_property
            contact = case.contact
            if (
                contact
                and contact.full_name.strip() == "مالک"
                and prop
                and not (prop.owner_first_name or "").strip()
                and not (prop.owner_last_name or "").strip()
                and not (prop.owner_phone or "").strip()
                and not contact.phones.exists()
            ):
                contact.is_legacy_placeholder = True
                contact.legacy_review_status = "NEEDS_REVIEW"
                contact.save(update_fields=["is_legacy_placeholder", "legacy_review_status"], using=alias)
        if updates:
            case.save(update_fields=updates, using=alias)

    for inquiry in Inquiry.objects.using(alias).select_related("scope").iterator():
        if inquiry.scope_id and inquiry.scope and inquiry.scope.sales_range_id:
            inquiry.sales_range_id = inquiry.scope.sales_range_id
            inquiry.save(update_fields=["sales_range"], using=alias)

    for transfer in ScopeTransferHistory.objects.using(alias).select_related("from_scope", "to_scope").iterator():
        updates = []
        if transfer.from_scope_id and transfer.from_scope and transfer.from_scope.sales_range_id:
            transfer.from_sales_range_id = transfer.from_scope.sales_range_id
            updates.append("from_sales_range")
        if transfer.to_scope_id and transfer.to_scope and transfer.to_scope.sales_range_id:
            transfer.to_sales_range_id = transfer.to_scope.sales_range_id
            updates.append("to_sales_range")
        if updates:
            transfer.save(update_fields=updates, using=alias)


def preserve_legacy_data(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0019_sales_range_crm_bridge"),
        ("crm", "0003_workflowsettings"),
    ]

    operations = [
        migrations.AddField(
            model_name="contact",
            name="is_legacy_placeholder",
            field=models.BooleanField(db_index=True, default=False, verbose_name="شخص جایگزینِ داده قدیمی"),
        ),
        migrations.AddField(
            model_name="contact",
            name="legacy_review_status",
            field=models.CharField(choices=[("NOT_REQUIRED", "نیازی به بازبینی ندارد"), ("NEEDS_REVIEW", "در انتظار بازبینی"), ("REVIEWED", "بازبینی‌شده")], db_index=True, default="NOT_REQUIRED", max_length=20, verbose_name="وضعیت بازبینی داده قدیمی"),
        ),
        migrations.AddField(
            model_name="contact",
            name="legacy_review_notes",
            field=models.TextField(blank=True, verbose_name="یادداشت بازبینی داده قدیمی"),
        ),
        migrations.AddField(
            model_name="contact",
            name="legacy_reviewed_at",
            field=models.DateTimeField(blank=True, null=True, verbose_name="زمان بازبینی داده قدیمی"),
        ),
        migrations.AddField(
            model_name="contact",
            name="legacy_reviewed_by",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="reviewed_legacy_contacts", to=settings.AUTH_USER_MODEL, verbose_name="بازبین داده قدیمی"),
        ),
        migrations.AlterField(
            model_name="propertyregistrationrequest",
            name="scope",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="property_cases", to="accounts.legacymanagementscope", verbose_name="رنج تاریخی"),
        ),
        migrations.AddField(
            model_name="propertyregistrationrequest",
            name="sales_range",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="property_cases", to="accounts.salesrange", verbose_name="رنج مسئول"),
        ),
        migrations.AddField(
            model_name="propertyregistrationrequest",
            name="is_legacy",
            field=models.BooleanField(db_index=True, default=False, verbose_name="پرونده انتقال‌یافته از داده‌های قدیمی"),
        ),
        migrations.AddField(
            model_name="propertyregistrationrequest",
            name="legacy_review_status",
            field=models.CharField(choices=[("NOT_REQUIRED", "نیازی به بازبینی ندارد"), ("NEEDS_REVIEW", "در انتظار بازبینی"), ("REVIEWED", "بازبینی‌شده")], db_index=True, default="NOT_REQUIRED", max_length=20, verbose_name="وضعیت بازبینی داده قدیمی"),
        ),
        migrations.AddField(
            model_name="propertyregistrationrequest",
            name="legacy_review_notes",
            field=models.TextField(blank=True, verbose_name="یادداشت بازبینی داده قدیمی"),
        ),
        migrations.AddField(
            model_name="propertyregistrationrequest",
            name="legacy_reviewed_at",
            field=models.DateTimeField(blank=True, null=True, verbose_name="زمان بازبینی داده قدیمی"),
        ),
        migrations.AddField(
            model_name="propertyregistrationrequest",
            name="legacy_reviewed_by",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="reviewed_legacy_property_cases", to=settings.AUTH_USER_MODEL, verbose_name="بازبین داده قدیمی"),
        ),
        migrations.AlterField(
            model_name="inquiry",
            name="scope",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="inquiries", to="accounts.legacymanagementscope", verbose_name="رنج تاریخی"),
        ),
        migrations.AddField(
            model_name="inquiry",
            name="sales_range",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="inquiries", to="accounts.salesrange", verbose_name="رنج مسئول"),
        ),
        migrations.RunPython(map_crm_ranges_and_flag_legacy_data, preserve_legacy_data),
    ]
