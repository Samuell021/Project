from django.db import migrations, models
import django.db.models.deletion


def map_legacy_scopes(apps, schema_editor):
    LegacyManagementScope = apps.get_model("accounts", "LegacyManagementScope")
    SalesRange = apps.get_model("accounts", "SalesRange")
    alias = schema_editor.connection.alias
    ranges = SalesRange.objects.using(alias)
    scopes = LegacyManagementScope.objects.using(alias)
    for scope in scopes.all().iterator():
        if scope.legacy_range_id:
            scope.sales_range_id = scope.legacy_range_id
            scope.mapping_note = "Mapped using the existing explicit SalesRange link."
            scope.save(update_fields=["sales_range", "mapping_note"], using=alias)
            continue
        base_name = scope.name[:120]
        name = base_name
        if ranges.filter(name=name).exists():
            suffix = f" (CRM legacy {scope.pk})"
            name = f"{base_name[:120 - len(suffix)]}{suffix}"
            counter = 2
            while ranges.filter(name=name).exists():
                suffix = f" (CRM legacy {scope.pk}-{counter})"
                name = f"{base_name[:120 - len(suffix)]}{suffix}"
                counter += 1
            note = "Created as a separate range because a SalesRange with the same name already existed; no name-based merge was performed."
        else:
            note = "Created as a separate range from the legacy CRM scope."
        new_range = ranges.create(name=name, is_active=scope.is_active)
        scope.sales_range_id = new_range.pk
        scope.mapping_note = note
        scope.save(update_fields=["sales_range", "mapping_note"], using=alias)


def keep_legacy_scopes(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0018_seed_crm_permissions"),
        ("crm", "0003_workflowsettings"),
    ]

    operations = [
        migrations.RenameModel(old_name="ManagementScope", new_name="LegacyManagementScope"),
        migrations.AlterModelTable(name="legacymanagementscope", table="accounts_managementscope"),
        migrations.AlterModelOptions(
            name="legacymanagementscope",
            options={
                "ordering": ["name"],
                "verbose_name": "رنج قدیمی CRM",
                "verbose_name_plural": "رنج‌های قدیمی CRM",
            },
        ),
        migrations.AlterField(
            model_name="legacymanagementscope",
            name="legacy_range",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="legacy_management_scope",
                to="accounts.salesrange",
                verbose_name="رنج پیشین",
            ),
        ),
        migrations.AddField(
            model_name="legacymanagementscope",
            name="sales_range",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="crm_legacy_scope",
                to="accounts.salesrange",
                verbose_name="رنج مرجع",
            ),
        ),
        migrations.AddField(
            model_name="legacymanagementscope",
            name="mapping_note",
            field=models.TextField(blank=True, verbose_name="یادداشت نگاشت داده‌های قدیمی"),
        ),
        migrations.AlterField(
            model_name="scopemembership",
            name="scope",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="memberships",
                to="accounts.legacymanagementscope",
                verbose_name="رنج تاریخی",
            ),
        ),
        migrations.AddField(
            model_name="scopemembership",
            name="sales_range",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="membership_history",
                to="accounts.salesrange",
                verbose_name="رنج مرجع",
            ),
        ),
        migrations.AddIndex(
            model_name="scopemembership",
            index=models.Index(fields=["sales_range", "ended_at"], name="idx_scope_range_end"),
        ),
        migrations.AddField(
            model_name="scopetransferhistory",
            name="from_sales_range",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="transfers_from",
                to="accounts.salesrange",
                verbose_name="رنج مبدأ",
            ),
        ),
        migrations.AddField(
            model_name="scopetransferhistory",
            name="to_sales_range",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="transfers_to",
                to="accounts.salesrange",
                verbose_name="رنج مقصد",
            ),
        ),
        migrations.RunPython(map_legacy_scopes, keep_legacy_scopes),
    ]
