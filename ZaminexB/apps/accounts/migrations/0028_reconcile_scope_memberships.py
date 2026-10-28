from django.db import migrations
from django.db.models import Q
from django.utils import timezone


def reconcile_memberships(apps, schema_editor):
    """Give every user a range's member lists already contain an active membership row.

    ``ScopeMembership`` is what the workflow reads (case routing, scope isolation, manager rights),
    while ``SalesRange.managers``/``members`` is what the settings screen edits. The signals keep
    them in step for every ORM change, but a database that was restored from a dump, patched with
    raw SQL or filled straight through the through table can hold the member row without the history
    row. Such a consultant then cannot open a case at all ("برای شما رنج فعالی ثبت نشده است").
    Rebuilding the missing rows is a one-off repair: no member is added or removed, and running the
    migration twice changes nothing.
    """
    alias = schema_editor.connection.alias
    SalesRange = apps.get_model("accounts", "SalesRange")
    Membership = apps.get_model("accounts", "ScopeMembership")
    now = timezone.now()

    for sales_range in SalesRange.objects.using(alias).filter(is_active=True).iterator():
        for role, relation in (("MANAGER", sales_range.managers), ("MEMBER", sales_range.members)):
            for user_id in relation.values_list("pk", flat=True):
                already_active = (
                    Membership.objects.using(alias)
                    .filter(
                        sales_range_id=sales_range.pk,
                        user_id=user_id,
                        membership_role=role,
                        started_at__lte=now,
                    )
                    .filter(Q(ended_at__isnull=True) | Q(ended_at__gt=now))
                    .exists()
                )
                if already_active:
                    continue
                Membership.objects.using(alias).create(
                    sales_range_id=sales_range.pk,
                    user_id=user_id,
                    membership_role=role,
                    started_at=now,
                )


class Migration(migrations.Migration):

    dependencies = [("accounts", "0027_custom_roles_and_group_settings_removal")]

    operations = [migrations.RunPython(reconcile_memberships, migrations.RunPython.noop)]
