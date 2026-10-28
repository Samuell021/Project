from django.db import migrations


def restore_scopes(apps, schema_editor):
    alias = schema_editor.connection.alias
    Range = apps.get_model("accounts", "SalesRange")
    Legacy = apps.get_model("accounts", "LegacyManagementScope")
    Membership = apps.get_model("accounts", "ScopeMembership")
    Transfer = apps.get_model("accounts", "ScopeTransferHistory")
    for target in Range.objects.using(alias).all().iterator():
        for snapshot in target.legacy_metadata:
            values = dict(snapshot["scope"])
            identifier = values.pop("id")
            Legacy.objects.using(alias).update_or_create(pk=identifier, defaults=values)
            Legacy.objects.using(alias).filter(pk=identifier).update(**values)
            for item in snapshot["memberships"]:
                Membership.objects.using(alias).filter(pk=item["id"]).update(scope_id=identifier)
            Transfer.objects.using(alias).filter(pk__in=snapshot["transfers_from"]).update(from_scope_id=identifier)
            Transfer.objects.using(alias).filter(pk__in=snapshot["transfers_to"]).update(to_scope_id=identifier)

    if schema_editor.connection.vendor == "postgresql":
        with schema_editor.connection.cursor() as cursor:
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")


class Migration(migrations.Migration):
    dependencies = [("accounts", "0024_remove_legacymanagementscope_legacy_range_and_more"), ("crm", "0007_remove_inquiry_crm_inquiry_scope_i_93cfb8_idx_and_more")]
    operations = [
        migrations.RunPython(migrations.RunPython.noop, restore_scopes),
        migrations.RemoveIndex(model_name="scopemembership", name="accounts_sc_scope_i_352c8c_idx"),
        migrations.RemoveField(model_name="scopemembership", name="scope"),
        migrations.RemoveField(model_name="scopetransferhistory", name="from_scope"),
        migrations.RemoveField(model_name="scopetransferhistory", name="to_scope"),
        migrations.DeleteModel(name="LegacyManagementScope"),
    ]
