from contextvars import ContextVar

from django.db import transaction
from django.db.models import Q
from django.db.models.signals import m2m_changed, post_delete, post_save
from django.dispatch import receiver
from django.utils import timezone

from .models import SalesRange, ScopeMembership


projecting_membership = ContextVar("projecting_membership", default=False)


def active_memberships(at=None):
    now = at or timezone.now()
    return ScopeMembership.objects.filter(started_at__lte=now, sales_range__is_active=True).filter(Q(ended_at__isnull=True) | Q(ended_at__gt=now))


def synchronize_projection(instance):
    if not instance.sales_range_id:
        return
    relation = instance.sales_range.managers if instance.membership_role == ScopeMembership.MembershipRole.MANAGER else instance.sales_range.members
    active = active_memberships().filter(sales_range_id=instance.sales_range_id, user_id=instance.user_id, membership_role=instance.membership_role).exists()
    exists = relation.filter(pk=instance.user_id).exists()
    token = projecting_membership.set(True)
    try:
        if active and not exists:
            relation.add(instance.user_id)
        elif not active and exists:
            relation.remove(instance.user_id)
    finally:
        projecting_membership.reset(token)


@receiver(post_save, sender=ScopeMembership)
@receiver(post_delete, sender=ScopeMembership)
def membership_projection(sender, instance, **kwargs):
    synchronize_projection(instance)


@receiver(m2m_changed, sender=SalesRange.managers.through)
@receiver(m2m_changed, sender=SalesRange.members.through)
def compatibility_membership_change(sender, instance, action, reverse, pk_set, **kwargs):
    if projecting_membership.get():
        return
    role = ScopeMembership.MembershipRole.MANAGER if sender == SalesRange.managers.through else ScopeMembership.MembershipRole.MEMBER
    if action == "pre_clear":
        relation = instance.managed_ranges if reverse and role == "MANAGER" else instance.sales_ranges if reverse else instance.managers if role == "MANAGER" else instance.members
        instance._clearing_scope_members = list(relation.values_list("pk", flat=True))
        return
    if action not in {"post_add", "post_remove", "post_clear"}:
        return
    identifiers = pk_set if action != "post_clear" else getattr(instance, "_clearing_scope_members", [])
    now = timezone.now()
    with transaction.atomic():
        for identifier in sorted(identifiers or []):
            sales_range_id, user_id = (identifier, instance.pk) if reverse else (instance.pk, identifier)
            SalesRange.objects.select_for_update().get(pk=sales_range_id)
            lookup = {"sales_range_id": sales_range_id, "user_id": user_id, "membership_role": role}
            current = ScopeMembership.objects.filter(**lookup, started_at__lte=now).filter(Q(ended_at__isnull=True) | Q(ended_at__gt=now))
            if action == "post_add":
                if not current.exists():
                    ScopeMembership.objects.create(**lookup, started_at=now)
            else:
                current.update(ended_at=now)
