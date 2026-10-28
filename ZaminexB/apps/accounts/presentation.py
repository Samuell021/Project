from django.middleware.csrf import get_token

from .models import UserRole
from .permissions import has_permission, permission_codes_for_user, user_is_general_manager
from .scoping import range_names_for_user
from apps.common.models import CompanySettings


FRONTEND_ROLE_MAP = {
    UserRole.ADMIN: "admin",
    UserRole.RANGE_MANAGER: "range_manager",
    UserRole.AGENT: "consultant",
    UserRole.FINANCE: "finance",
}

ROLE_LABELS = {
    UserRole.ADMIN: "مدیر",
    UserRole.RANGE_MANAGER: "مدیر رنج",
    UserRole.AGENT: "کارشناس",
    UserRole.FINANCE: "مالی",
}


def frontend_role_for(user) -> str:
    if user_is_general_manager(user):
        return "admin"
    return FRONTEND_ROLE_MAP.get(getattr(user, "role", ""), "consultant")


def role_label_for(user) -> str:
    if user_is_general_manager(user):
        return ROLE_LABELS[UserRole.ADMIN]
    return ROLE_LABELS.get(getattr(user, "role", ""), "کارشناس")


def default_page_for(user) -> str:
    if user_is_general_manager(user):
        return "admin-dashboard"
    if getattr(user, "role", "") == UserRole.FINANCE:
        return "crm-finance"
    if getattr(user, "role", "") == UserRole.RANGE_MANAGER:
        if has_permission(user, "analytics.view"):
            return "admin-dashboard"
        return "properties"
    return "consultant-dashboard"


def build_initial_data(request, page_name=None) -> dict:
    user = request.user
    return {
        "isAuthenticated": True,
        "role": frontend_role_for(user),
        "roleCode": getattr(user, "role", ""),
        "roleLabel": role_label_for(user),
        "brandTheme": (
            CompanySettings.objects.filter(pk=1)
            .values_list("brand_theme", flat=True)
            .first()
            or CompanySettings.BrandTheme.GREEN
        ),
        "permissions": sorted(permission_codes_for_user(user)),
        "rangeNames": range_names_for_user(user),
        "userName": user.get_full_name() or user.username,
        "currentConsultantId": str(user.id),
        "initialPage": page_name or default_page_for(user),
        "loginUrl": "/accounts/login/",
        "logoutUrl": "/accounts/logout/",
        "csrfToken": get_token(request),
        "pageProps": {},
    }
