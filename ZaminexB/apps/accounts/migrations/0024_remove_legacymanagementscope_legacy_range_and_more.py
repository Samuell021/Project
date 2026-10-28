from django.db import migrations, models
from django.utils import timezone


def serialize_row(row):
    return {key: value.isoformat() if hasattr(value, "isoformat") else value for key, value in row.items()}


def unify_scopes(apps, schema_editor):
    alias = schema_editor.connection.alias
    Range = apps.get_model("accounts", "SalesRange")
    Legacy = apps.get_model("accounts", "LegacyManagementScope")
    Membership = apps.get_model("accounts", "ScopeMembership")
    Transfer = apps.get_model("accounts", "ScopeTransferHistory")
    now = timezone.now()
    for old in Legacy.objects.using(alias).all().iterator():
        target = Range.objects.using(alias).filter(pk=old.sales_range_id or old.legacy_range_id).first()
        if target is None:
            name = old.name
            if Range.objects.using(alias).filter(name=name).exists():
                name = f"{old.name[:95]} ـ سابق {old.pk}"
            target = Range.objects.using(alias).create(name=name, is_active=old.is_active)
        snapshot = {
            "scope": serialize_row(Legacy.objects.using(alias).filter(pk=old.pk).values().get()),
            "memberships": [serialize_row(row) for row in Membership.objects.using(alias).filter(scope_id=old.pk).values()],
            "transfers_from": [row.pk for row in Transfer.objects.using(alias).filter(from_scope_id=old.pk)],
            "transfers_to": [row.pk for row in Transfer.objects.using(alias).filter(to_scope_id=old.pk)],
        }
        target.legacy_metadata = [*target.legacy_metadata, snapshot]
        target.save(update_fields=["legacy_metadata"], using=alias)
        for model_name in ["PropertyRegistrationRequest", "Inquiry"]:
            apps.get_model("crm", model_name).objects.using(alias).filter(scope_id=old.pk, sales_range_id__isnull=True).update(sales_range_id=target.pk)
        Membership.objects.using(alias).filter(scope_id=old.pk, sales_range_id__isnull=True).update(sales_range_id=target.pk)
        Transfer.objects.using(alias).filter(from_scope_id=old.pk, from_sales_range_id__isnull=True).update(from_sales_range_id=target.pk)
        Transfer.objects.using(alias).filter(to_scope_id=old.pk, to_sales_range_id__isnull=True).update(to_sales_range_id=target.pk)
    for membership in Membership.objects.using(alias).filter(sales_range_id__isnull=False, started_at__lte=now).iterator():
        if membership.ended_at is not None and membership.ended_at <= now:
            continue
        target = Range.objects.using(alias).get(pk=membership.sales_range_id)
        relation = target.managers if membership.membership_role == "MANAGER" else target.members
        relation.add(membership.user_id)
    for target in Range.objects.using(alias).all().iterator():
        for role, relation in [("MANAGER", target.managers), ("MEMBER", target.members)]:
            for user_id in relation.values_list("pk", flat=True):
                if not Membership.objects.using(alias).filter(sales_range=target, user_id=user_id, membership_role=role, ended_at__isnull=True).exists():
                    Membership.objects.using(alias).create(sales_range=target, user_id=user_id, membership_role=role, started_at=now)


class Migration(migrations.Migration):
    dependencies = [("accounts", "0023_groupsettings"), ("crm", "0006_contact_version_propertyparty_delete_propertycontact_and_more")]
    operations = [
        migrations.AddField(model_name="salesrange", name="legacy_metadata", field=models.JSONField(default=list, blank=True, verbose_name="سوابق نگاشت")),
        migrations.AddField(model_name="salesrange", name="version", field=models.PositiveIntegerField(default=1, verbose_name="نسخه")),
        migrations.RunPython(unify_scopes, migrations.RunPython.noop),
    ]
