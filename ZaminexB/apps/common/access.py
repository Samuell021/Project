from django.db.models import Q

from apps.accounts.permissions import has_permission
from apps.accounts.scoping import team_user_ids, user_in_scope, user_is_admin

__all__ = [
    "accessible_properties_q",
    "can_access_property",
    "can_manage_property",
    "user_is_admin",
]


def can_access_property(user, prop) -> bool:
    if prop is None:
        return True
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if user_is_admin(user):
        return True
    return user_in_scope(user, prop.consultant_id)


def can_manage_property(user, prop) -> bool:
    if prop is None:
        return False
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if user_is_admin(user):
        return True
    if not has_permission(user, "property.edit"):
        return False
    return user_in_scope(user, prop.consultant_id)


def accessible_properties_q(user):
    if user_is_admin(user):
        return Q()
    return Q(consultant_id__in=team_user_ids(user) or set())
