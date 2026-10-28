from functools import wraps

from django.core.exceptions import PermissionDenied
from django.contrib.auth.decorators import login_required
from rest_framework.permissions import BasePermission

from .models import GROUP_GENERAL_MANAGER, GROUP_ROLE_MAP, Role, UserRole
from .permission_catalog import DEFAULT_ROLE_PERMISSIONS, PERMISSION_CODES


def user_group_names(user) -> set[str]:
    if not user or not getattr(user, "is_authenticated", False):
        return set()
    return {group.name for group in user.groups.all()}


def user_role_codes(user) -> set[str]:
    codes = set()
    for name in user_group_names(user):
        role_code = GROUP_ROLE_MAP.get(name)
        if role_code:
            codes.add(role_code)
    return codes


def user_is_general_manager(user) -> bool:
    return GROUP_GENERAL_MANAGER in user_group_names(user)


def permission_codes_for_user(user) -> set[str]:
    if not user or not getattr(user, "is_authenticated", False):
        return set()

    if user_is_general_manager(user):
        return set(PERMISSION_CODES)

    return set(user.groups.values_list("permissions__codename", flat=True)) & set(PERMISSION_CODES)



def has_permission(user, code: str) -> bool:
    if user_is_general_manager(user):
        return True
    codes = permission_codes_for_user(user)
    if code in codes:
        return True
    if code.startswith("listing."):
        code = f"property_file.{code.split('.', 1)[1]}"
    return code in codes


def require_permission(user, code: str, message: str = "شما به این بخش دسترسی ندارید."):
    if not has_permission(user, code):
        raise PermissionDenied(message)


class HasPermission(BasePermission):
    permission_code = ""

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and has_permission(request.user, self.permission_code)
        )


def permission_required(code: str, message: str = "شما به این بخش دسترسی ندارید."):
    def decorator(view_func):
        @wraps(view_func)
        @login_required
        def _wrapped_view(request, *args, **kwargs):
            if not has_permission(request.user, code):
                raise PermissionDenied(message)
            return view_func(request, *args, **kwargs)

        return _wrapped_view

    return decorator


def role_required(*allowed_roles):
    def decorator(view_func):
        @wraps(view_func)
        @login_required
        def _wrapped_view(request, *args, **kwargs):
            if request.user.role not in allowed_roles:
                raise PermissionDenied("شما اجازه دسترسی به این صفحه را ندارید.")
            return view_func(request, *args, **kwargs)

        return _wrapped_view

    return decorator


def admin_required(view_func):
    @wraps(view_func)
    def _wrapped_view(request, *args, **kwargs):
        if request.user.is_authenticated and request.user.role == UserRole.ADMIN:
            return view_func(request, *args, **kwargs)
        raise PermissionDenied("شما اجازه دسترسی به این صفحه را ندارید.")

    return _wrapped_view


def agent_required(view_func):
    return role_required(UserRole.AGENT)(view_func)
