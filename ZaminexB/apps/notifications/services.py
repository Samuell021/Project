from __future__ import annotations

import uuid

from .models import Notification


def notification_poll_cache_key(user_id):
    from apps.common import cache_utils

    return cache_utils.make_key("poll", "notifications", user_id)


def invalidate_notification_cache(user_ids) -> None:
    from apps.common import cache_utils

    targets = {user_id for user_id in user_ids if user_id}
    for user_id in targets:
        cache_utils.cache_delete(notification_poll_cache_key(user_id))


def notify_users(
    users,
    *,
    notification_type,
    title,
    message,
    metadata=None,
    event_key_prefix: str | None = None,
):
    recipients = []
    seen = set()
    for user in users:
        user_id = getattr(user, "pk", None)
        if not user_id or user_id in seen:
            continue
        seen.add(user_id)
        recipients.append(user)

    if not recipients:
        return []

    created = Notification.objects.bulk_create(
        [
            Notification(
                event_key=f"{event_key_prefix}:{user.pk}" if event_key_prefix else str(uuid.uuid4()),
                user=user,
                type=notification_type,
                title=title,
                message=message,
                metadata=metadata or {},
            )
            for user in recipients
        ],
        ignore_conflicts=True,
    )
    invalidate_notification_cache([user.pk for user in recipients])
    return created


def admin_recipients(actor=None):
    from apps.accounts.models import User, UserRole

    queryset = User.objects.filter(groups__name="GENERAL_MANAGER", is_active=True)
    actor_id = getattr(actor, "pk", None)
    if actor_id and getattr(actor, "role", "") == UserRole.ADMIN:
        queryset = queryset.exclude(pk=actor_id)
    return list(queryset)


def permission_recipients(permission_code, actor=None):
    from apps.accounts.models import Role, User
    from apps.accounts.scoping import user_in_scope, user_is_admin

    role_codes = list(
        Role.objects.filter(permissions__code=permission_code).values_list(
            "code", flat=True
        )
    )
    if not role_codes:
        return []
    users = User.objects.filter(
        groups__name__in=[
            "GENERAL_MANAGER" if code == "ADMIN" else code for code in role_codes
        ],
        is_active=True,
    ).distinct()
    actor_id = getattr(actor, "pk", None)
    recipients = []
    for user in users:
        if actor_id and user.pk == actor_id:
            continue
        if not user_is_admin(user) and actor_id and not user_in_scope(user, actor_id):
            continue
        recipients.append(user)
    return recipients


def notify_admins_pending_review(
    *,
    notification_type,
    title,
    message,
    metadata=None,
    actor=None,
    permission_code=None,
    event_key_prefix: str | None = None,
):
    recipients = (
        permission_recipients(permission_code, actor)
        if permission_code
        else admin_recipients(actor)
    )
    return notify_users(
        recipients,
        notification_type=notification_type,
        title=title,
        message=message,
        metadata=metadata,
        event_key_prefix=event_key_prefix,
    )


def actor_display_name(user) -> str:
    if user is None:
        return "کاربر نامشخص"
    full_name = ""
    get_full_name = getattr(user, "get_full_name", None)
    if callable(get_full_name):
        full_name = (get_full_name() or "").strip()
    return full_name or (getattr(user, "username", "") or "کاربر نامشخص")
