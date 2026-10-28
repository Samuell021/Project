from django.db.models import Q

from apps.accounts.models import UserRole
from apps.accounts.permissions import has_permission, user_is_general_manager
from apps.listings.models import PropertyFile
from apps.properties.models import Property
from apps.tasks.models import Task

from .. import models
from . import managed_sales_range_ids, scope_team_ids, user_sales_range_ids


def scoped_deal_queryset(user):
    qs = models.Deal.objects.all()
    if user_is_general_manager(user):
        return qs
    ids = scope_team_ids(user)
    if ids is None:
        return qs
    return qs.filter(
        Q(assigned_to_id__in=ids)
        | Q(introduction__buyer_consultant_id__in=ids)
        | Q(introduction__seller_consultant_id__in=ids)
    ).distinct()


def active_scope_listings_queryset(user):
    qs = PropertyFile.objects.filter(
        status=PropertyFile.Status.ACTIVE,
        property__review_status=Property.ReviewStatus.APPROVED,
    )
    if user_is_general_manager(user):
        return qs
    ids = scope_team_ids(user)
    if ids is None:
        return qs
    sales_range_ids = user_sales_range_ids(user) or set()
    scope = Q(assigned_to_id__in=ids) | Q(property__consultant_id__in=ids)
    if sales_range_ids:
        scope |= Q(property__registration_case__sales_range_id__in=sales_range_ids)
    return qs.filter(scope).distinct()


def scoped_property_file_queryset(user):
    qs = PropertyFile.objects.all()
    if user_is_general_manager(user):
        return qs
    ids = scope_team_ids(user)
    if ids is None:
        return qs
    managed_ids = managed_sales_range_ids(user) or set()
    scope = Q(assigned_to_id__in=ids) | Q(property__consultant_id__in=ids)
    if managed_ids:
        scope |= Q(property__registration_case__sales_range_id__in=managed_ids)
    return qs.filter(scope).distinct()


scoped_listing_queryset = scoped_property_file_queryset


def scoped_property_queryset(user):
    qs = Property.objects.all()
    if user_is_general_manager(user):
        return qs
    ids = scope_team_ids(user)
    if ids is None:
        return qs
    managed_ids = managed_sales_range_ids(user) or set()
    scope = (
        Q(consultant_id__in=ids)
        | Q(registration_case__created_by_id__in=ids)
        | Q(registration_case__assigned_to_id__in=ids)
    )
    if managed_ids:
        scope |= Q(registration_case__sales_range_id__in=managed_ids)
    return qs.filter(scope).distinct()


def user_has_company_finance(user):
    return user_is_general_manager(user) or getattr(user, "role", "") == UserRole.FINANCE


def scoped_commission_queryset(user):
    qs = models.Commission.objects.all()
    if user_has_company_finance(user):
        return qs
    return qs.filter(contract__deal__in=scoped_deal_queryset(user)).distinct()


def scoped_payment_queryset(user):
    qs = models.Payment.objects.all()
    if user_has_company_finance(user):
        return qs
    commissions = scoped_commission_queryset(user)
    return qs.filter(
        Q(allocations__commission__in=commissions)
        | Q(allocations__commission_share__commission__in=commissions)
    ).distinct()


def scoped_contract_queryset(user):
    qs = models.Contract.objects.all()
    if user_is_general_manager(user):
        return qs
    qs = qs.filter(status=models.Contract.Status.FINALIZED)
    if getattr(user, "role", "") == UserRole.FINANCE:
        return qs
    return qs.filter(deal__in=scoped_deal_queryset(user)).distinct()


def scoped_case_queryset(user, queryset, permission_code="case.view"):
    if user_is_general_manager(user):
        return queryset
    if not has_permission(user, permission_code):
        return queryset.none()
    ids = scope_team_ids(user)
    if ids is None:
        return queryset
    scope = Q(created_by=user) | Q(assigned_to=user)
    managed_ids = managed_sales_range_ids(user) or set()
    if managed_ids:
        scope |= Q(sales_range_id__in=managed_ids)
    if ids:
        scope |= Q(created_by_id__in=ids) | Q(assigned_to_id__in=ids)
    return queryset.filter(scope).distinct()


def scoped_task_queryset(user):
    qs = Task.objects.all()
    if user_is_general_manager(user):
        return qs
    ids = scope_team_ids(user)
    if ids is None:
        return qs
    return qs.filter(Q(assigned_to_id__in=ids) | Q(created_by=user)).distinct()
