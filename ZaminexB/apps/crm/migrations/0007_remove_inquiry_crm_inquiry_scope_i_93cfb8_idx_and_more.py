from django.db import migrations, models
from django.db.models import F


def preserve_ids(apps, schema_editor):
    for name in ["PropertyRegistrationRequest", "Inquiry"]:
        apps.get_model("crm", name).objects.using(schema_editor.connection.alias).update(legacy_scope_id=F("scope_id"))


def restore_ids(apps, schema_editor):
    for name in ["PropertyRegistrationRequest", "Inquiry"]:
        apps.get_model("crm", name).objects.using(schema_editor.connection.alias).update(scope_id=F("legacy_scope_id"))

    if schema_editor.connection.vendor == "postgresql":
        with schema_editor.connection.cursor() as cursor:
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")


class Migration(migrations.Migration):
    dependencies = [("accounts", "0024_remove_legacymanagementscope_legacy_range_and_more"), ("crm", "0006_contact_version_propertyparty_delete_propertycontact_and_more")]
    operations = [
        migrations.AddField(model_name="inquiry", name="legacy_scope_id", field=models.PositiveIntegerField(null=True, blank=True, editable=False)),
        migrations.AddField(model_name="propertyregistrationrequest", name="legacy_scope_id", field=models.PositiveIntegerField(null=True, blank=True, editable=False)),
        migrations.RunPython(preserve_ids, restore_ids),
        migrations.RemoveIndex(model_name="inquiry", name="crm_inquiry_scope_i_93cfb8_idx"),
        migrations.RemoveIndex(model_name="propertyregistrationrequest", name="crm_propert_scope_i_849c16_idx"),
        migrations.RemoveField(model_name="inquiry", name="scope"),
        migrations.RemoveField(model_name="propertyregistrationrequest", name="scope"),
        migrations.AddIndex(model_name="inquiry", index=models.Index(fields=["sales_range", "lead_status", "acceptance_status"], name="crm_inquiry_sales_r_98b650_idx")),
        migrations.AddIndex(model_name="propertyregistrationrequest", index=models.Index(fields=["sales_range", "lead_status", "acceptance_status"], name="crm_propert_sales_r_0d8fcd_idx")),
    ]
