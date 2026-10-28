from django.db.models import Q

from .models import SalesRange, User, UserRole
from .permissions import user_group_names, user_is_general_manager

_UNSET = object()


def user_is_admin(user) -> bool:
    return bool(
        user
        and getattr(user, "is_authenticated", False)
        and user_is_general_manager(user)
    )


def user_is_range_manager(user) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if "RANGE_MANAGER" in user_group_names(user):
        return True
    if getattr(user, "role", "") == UserRole.RANGE_MANAGER:
        return True
    from .scope_memberships import active_memberships

    return active_memberships().filter(user=user, membership_role="MANAGER").exists()


def team_user_ids(user):
    if user_is_admin(user):
        return None

    from .scope_memberships import active_memberships

    if user_is_range_manager(user):
        managed = active_memberships().filter(user=user, membership_role="MANAGER").values_list("sales_range_id", flat=True)
        ids = set(active_memberships().filter(sales_range_id__in=managed).values_list("user_id", flat=True))
        ids.add(user.pk)
        return ids
    return {user.pk}


def user_in_scope(user, other_user_id) -> bool:
    if user_is_admin(user):
        return True
    if other_user_id is None:
        return False
    if str(other_user_id) == str(getattr(user, "pk", "")):
        return True
    ids = team_user_ids(user)
    return other_user_id in (ids or set())


def scope_filter(user, field: str) -> Q:
    ids = team_user_ids(user)
    if ids is None:
        return Q()
    return Q(**{f"{field}__in": ids})


def range_names_for_user(user) -> list[str]:
    if user_is_admin(user):
        return list(
            SalesRange.objects.filter(is_active=True)
            .order_by("name")
            .values_list("name", flat=True)
        )
    from .scope_memberships import active_memberships

    memberships = active_memberships().filter(user=user)
    if user_is_range_manager(user):
        memberships = memberships.filter(membership_role="MANAGER")
    return list(memberships.order_by("sales_range__name").values_list("sales_range__name", flat=True).distinct())


def can_manage_team_member(actor, target_user) -> bool:
    if user_is_admin(actor):
        return True
    if not user_is_range_manager(actor):
        return target_user is not None and target_user.pk == actor.pk
    if target_user is None:
        return False
    if target_user.pk == actor.pk:
        return True
    return target_user.pk in (team_user_ids(actor) or set())
