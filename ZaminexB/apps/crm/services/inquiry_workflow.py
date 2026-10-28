from __future__ import annotations

import uuid
from decimal import Decimal

from django.core.exceptions import PermissionDenied, ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.permissions import has_permission, require_permission, user_is_general_manager
from apps.basics.models import DealType, DealTypeVersion
from apps.basics.terms import validate_terms
from apps.listings.models import PropertyFile
from apps.notifications.services import notify_users
from apps.properties.models import Property
from apps.tasks.models import Task

from .. import models
from . import (
    can_manage_sales_range,
    case_visibility_filter,
    commission_amount,
    make_task,
    property_file_snapshot,
    record_transition,
    sales_range_managers,
    scope_team_ids,
    user_sales_range_ids,
)
from .supply_workflow import CaseVersionConflict, ensure_case_version, notify_workflow_event, parse_dt


INQUIRY_STAGE_LABELS = {
    "reception": "پذیرش مدیر",
    "assignment": "ارجاع",
    "acceptance": "پذیرش مسئول",
    "needs": "تکمیل نیاز",
    "matching": "معرفی فایل",
    "viewings": "بازدید",
    "negotiation": "مذاکره",
    "contract": "قرارداد",
    "closed": "بسته‌شده",
}

CONTRACT_EDITABLE_STATUSES = (models.Contract.Status.DRAFT, models.Contract.Status.SIGNING)


def _lock_inquiry(inquiry_id):
    return models.Inquiry.objects.select_for_update(of=("self",)).select_related("contact", "sales_range", "assigned_to").get(pk=inquiry_id)


def _active_introductions(inquiry_id):
    return models.Introduction.objects.filter(inquiry_id=inquiry_id).exclude(status=models.Introduction.Status.CLOSED)


def _active_deals(inquiry_id):
    return models.Deal.objects.filter(inquiry_id=inquiry_id).exclude(
        stage__in=(models.Deal.Stage.LOST,)
    )


def inquiry_stage(inquiry) -> str:
    if inquiry.status in (models.CaseStatus.CLOSED, models.CaseStatus.CANCELLED, models.CaseStatus.DUPLICATE):
        return "closed"
    if inquiry.status == models.CaseStatus.COMPLETED:
        return "contract"
    if inquiry.lead_status == models.LeadStatus.PENDING:
        return "reception"
    if inquiry.acceptance_status in (models.AcceptanceStatus.UNASSIGNED, models.AcceptanceStatus.REJECTED) or not inquiry.assigned_to_id:
        return "assignment"
    if inquiry.acceptance_status in (models.AcceptanceStatus.PENDING, models.AcceptanceStatus.WITHDRAWAL_PENDING):
        return "acceptance"
    introductions = list(_active_introductions(inquiry.pk))
    deals = list(_active_deals(inquiry.pk))
    if not inquiry.needs_confirmed_at and not introductions and not deals:
        return "needs"
    if any(deal.stage in (models.Deal.Stage.AGREED, models.Deal.Stage.CONTRACT, models.Deal.Stage.FINALIZED) for deal in deals):
        return "contract"
    if any(deal.stage == models.Deal.Stage.NEGOTIATION for deal in deals):
        return "negotiation"
    introduction_ids = [intro.pk for intro in introductions]
    if introduction_ids:
        viewings = list(models.Viewing.objects.filter(introduction_id__in=introduction_ids))
        if any(viewing.completed_at is None for viewing in viewings):
            return "viewings"
        if any(viewing.completed_at is not None and viewing.result == models.Viewing.Result.PENDING for viewing in viewings):
            return "viewings"
        if any(
            viewing.completed_at is not None
            and viewing.result == models.Viewing.Result.INTERESTED
            and not any(deal.introduction_id == viewing.introduction_id for deal in deals)
            for viewing in viewings
        ):
            return "viewings"
    return "matching"


def inquiry_stage_responsible(inquiry, stage=None) -> str:
    stage = stage or inquiry_stage(inquiry)
    if stage in ("reception", "assignment"):
        names = [user.get_full_name() or user.username for user in sales_range_managers(inquiry.sales_range)]
        return "، ".join(names) if names else "مدیر رنج تعیین نشده"
    if stage in ("acceptance", "needs", "matching", "viewings", "negotiation"):
        if inquiry.assigned_to_id:
            return inquiry.assigned_to.get_full_name() or inquiry.assigned_to.username
        return "مسئول تعیین نشده"
    if stage == "contract":
        names = [
            user.get_full_name() or user.username
            for user in User.objects.filter(groups__name="GENERAL_MANAGER", is_active=True).distinct()
        ]
        return "، ".join(names) if names else "مدیر کل تعیین نشده"
    return "—"


def can_manage_inquiry(user, inquiry) -> bool:
    if user_is_general_manager(user):
        return True
    if inquiry.sales_range_id and can_manage_sales_range(user, inquiry.sales_range_id):
        return True
    return inquiry.assigned_to_id == user.pk


def _require_inquiry_owner(user, inquiry, message="فقط مسئول پذیرفته‌شده یا مدیر رنج می‌تواند این اقدام را انجام دهد."):
    if not can_manage_inquiry(user, inquiry):
        raise PermissionDenied(message)


def _accepted_owner(inquiry):
    if inquiry.acceptance_status != models.AcceptanceStatus.ACCEPTED or not inquiry.assigned_to_id:
        raise ValidationError({"acceptance_status": "ابتدا ارجاع باید توسط مسئول پذیرفته شود."})


def _require_open_inquiry(inquiry):
    if inquiry.status != models.CaseStatus.ACTIVE:
        raise ValidationError({"status": "این درخواست بسته شده است و تغییر نمی‌پذیرد."})


def _active_listing_for_matching(user):
    queryset = PropertyFile.objects.filter(
        status=PropertyFile.Status.ACTIVE,
        property__review_status=Property.ReviewStatus.APPROVED,
    ).select_related("property", "deal_type", "deal_type_version")
    if user_is_general_manager(user):
        return queryset
    ids = scope_team_ids(user) or set()
    scope_ids = user_sales_range_ids(user) or set()
    scope = Q(assigned_to_id__in=ids) | Q(property__consultant_id__in=ids)
    if scope_ids:
        scope |= Q(property__registration_case__sales_range_id__in=scope_ids)
    return queryset.filter(scope).distinct()


def _deal_family(property_file):
    if property_file.deal_type_version_id:
        return property_file.deal_type_version.family
    if property_file.deal_type_id:
        return property_file.deal_type.family
    return None


def create_inquiry(user, data):
    require_permission(user, "case.create")
    contact = get_object_or_404(models.Contact, pk=data.get("contact"))
    sales_range = None
    raw_scope = data.get("sales_range", data.get("scope"))
    from . import resolve_sales_range

    sales_range = resolve_sales_range(user, raw_scope)
    description = str(data.get("description") or "").strip()
    if len(description) > 5000:
        raise ValidationError({"description": "شرح اولیه حداکثر ۵ هزار نویسه است."})
    accepted = user_is_general_manager(user) or (sales_range and can_manage_sales_range(user, sales_range.pk))
    inquiry = models.Inquiry.objects.create(
        code=f"I-{uuid.uuid4().hex[:8].upper()}",
        contact=contact,
        description=description,
        sales_range=sales_range,
        created_by=user,
        lead_status=models.LeadStatus.ACCEPTED if accepted else models.LeadStatus.PENDING,
        lead_accepted_by=user if accepted else None,
        lead_accepted_at=timezone.now() if accepted else None,
    )
    deal_type_id = data.get("deal_type") or data.get("deal_type_id")
    if deal_type_id:
        deal_type = DealType.objects.filter(pk=deal_type_id, is_active=True).first()
        if deal_type is None:
            raise ValidationError({"deal_type": "نوع معامله انتخاب‌شده فعال نیست."})
        version = DealTypeVersion.objects.filter(deal_type=deal_type, status=DealTypeVersion.Status.PUBLISHED).order_by("-version_number").first()
        if version is None:
            raise ValidationError({"deal_type": "نوع معامله فاقد نسخهٔ منتشرشده است."})
        models.InquiryPreference.objects.create(inquiry=inquiry, deal_type=deal_type, deal_type_version=version)
    if not accepted:
        for manager in sales_range_managers(sales_range):
            make_task(
                f"پذیرش درخواست {inquiry.code}",
                manager,
                user,
                timezone.now() + timezone.timedelta(hours=48),
                task_type=Task.TaskType.ADMINISTRATIVE,
                inquiry=inquiry,
            )
            notify_workflow_event(
                [manager],
                title="درخواست متقاضی جدید",
                message=f"درخواست {inquiry.code} در انتظار پذیرش مدیر رنج است.",
                metadata={"subject_type": "INQUIRY", "subject_id": inquiry.pk},
                event_key_prefix=f"inquiry-lead:{inquiry.pk}",
            )
    record_transition("INQUIRY", inquiry.pk, "", "reception" if not accepted else "assignment", user, "ثبت درخواست متقاضی")
    return inquiry


def _normalize_required_conditions(raw):
    if raw in (None, ""):
        return []
    if not isinstance(raw, list):
        raise ValidationError({"required_conditions": "شروط ضروری باید فهرست باشند."})
    if len(raw) > 20:
        raise ValidationError({"required_conditions": "حداکثر ۲۰ شرط ضروری مجاز است."})
    normalized = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValidationError({"required_conditions": "هر شرط ضروری باید یک شیء باشد."})
        label = str(item.get("label") or "").strip()
        if not label:
            raise ValidationError({"required_conditions": "برچسب شرط ضروری الزامی است."})
        field = str(item.get("field") or "").strip()
        operator = str(item.get("operator") or "EQ").upper()
        if operator not in ("EQ", "GTE", "LTE", "IN"):
            raise ValidationError({"required_conditions": "عملگر شرط ضروری معتبر نیست."})
        normalized.append({"label": label[:120], "field": field[:60], "operator": operator, "value": item.get("value")})
    return normalized


def save_inquiry_needs(inquiry_id, user, data):
    inquiry = _lock_inquiry(inquiry_id)
    _require_inquiry_owner(user, inquiry)
    _accepted_owner(inquiry)
    _require_open_inquiry(inquiry)
    ensure_case_version(inquiry, data)
    raw_preferences = data.get("preferences", [])
    if not isinstance(raw_preferences, list) or not raw_preferences:
        raise ValidationError({"preferences": "حداقل یک نوع معامله با بودجه لازم است."})
    if len(raw_preferences) > 12:
        raise ValidationError({"preferences": "حداکثر ۱۲ نوع معامله مجاز است."})
    validated = []
    seen = set()
    for item in raw_preferences:
        if not isinstance(item, dict):
            raise ValidationError({"preferences": "هر نیاز باید یک شیء معتبر باشد."})
        deal_type_id = item.get("deal_type") or item.get("deal_type_id")
        deal_type = DealType.objects.filter(pk=deal_type_id, is_active=True).first()
        if deal_type is None:
            raise ValidationError({"deal_type": "نوع معامله انتخاب‌شده فعال نیست."})
        if deal_type.pk in seen:
            raise ValidationError({"preferences": "برای هر نوع معامله فقط یک نیاز ثبت کنید."})
        seen.add(deal_type.pk)
        version = DealTypeVersion.objects.filter(deal_type=deal_type, status=DealTypeVersion.Status.PUBLISHED).order_by("-version_number").first()
        if version is None:
            raise ValidationError({"deal_type": "نوع معامله فاقد نسخهٔ منتشرشده است."})
        min_amount = _amount(item.get("min_amount"), "min_amount")
        max_amount = _amount(item.get("max_amount"), "max_amount")
        max_deposit = _amount(item.get("max_deposit"), "max_deposit")
        max_monthly_rent = _amount(item.get("max_monthly_rent"), "max_monthly_rent")
        if min_amount is not None and max_amount is not None and min_amount > max_amount:
            raise ValidationError({"max_amount": "حداکثر بودجه نمی‌تواند از حداقل کمتر باشد."})
        min_area = _positive_int(item.get("min_area"), "min_area")
        max_area = _positive_int(item.get("max_area"), "max_area")
        if min_area is not None and max_area is not None and min_area > max_area:
            raise ValidationError({"max_area": "حداکثر متراژ نمی‌تواند از حداقل کمتر باشد."})
        min_rooms = _positive_int(item.get("min_rooms"), "min_rooms")
        criteria = dict(item.get("criteria") or {}) if isinstance(item.get("criteria") or {}, dict) else {}
        criteria["required"] = _normalize_required_conditions(item.get("required_conditions", criteria.get("required", [])))
        if min_rooms is not None:
            criteria["min_rooms"] = min_rooms
        validated.append(
            {
                "deal_type": deal_type,
                "deal_type_version": version,
                "min_amount": min_amount,
                "max_amount": max_amount,
                "max_deposit": max_deposit,
                "max_monthly_rent": max_monthly_rent,
                "min_area": min_area,
                "max_area": max_area,
                "criteria": criteria,
                "districts": _id_list(item.get("districts"), "districts"),
                "property_types": _id_list(item.get("property_types"), "property_types"),
            }
        )
    existing = {pref.deal_type_id: pref for pref in inquiry.preferences.all()}
    for item in validated:
        districts = item.pop("districts")
        property_types = item.pop("property_types")
        pref = existing.pop(item["deal_type"].pk, None)
        if pref is None:
            pref = models.InquiryPreference.objects.create(inquiry=inquiry, **item)
        else:
            for field, value in item.items():
                setattr(pref, field, value)
            pref.save()
        pref.districts.set(districts)
        pref.property_types.set(property_types)
    for stale in existing.values():
        stale.delete()
    inquiry.needs_confirmed_at = timezone.now()
    inquiry.version += 1
    inquiry.save(update_fields=["needs_confirmed_at", "version", "updated_at"])
    record_transition("INQUIRY", inquiry.pk, inquiry_stage(inquiry), "matching", user, "ثبت نیاز و بودجه")
    return inquiry


def _amount(raw, field):
    if raw in (None, ""):
        return None
    if isinstance(raw, bool):
        raise ValidationError({field: "مبلغ باید عدد صحیح تومان باشد."})
    try:
        value = Decimal(str(raw))
    except Exception:
        raise ValidationError({field: "مبلغ باید عدد صحیح تومان باشد."})
    if not value.is_finite() or value < 0 or value >= Decimal("1e18") or value != value.to_integral_value():
        raise ValidationError({field: "مبلغ باید عدد صحیح نامنفی تومان باشد."})
    return value


def _positive_int(raw, field):
    if raw in (None, ""):
        return None
    if isinstance(raw, bool):
        raise ValidationError({field: "مقدار باید عدد صحیح نامنفی باشد."})
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise ValidationError({field: "مقدار باید عدد صحیح نامنفی باشد."})
    if value < 0:
        raise ValidationError({field: "مقدار باید عدد صحیح نامنفی باشد."})
    return value


def _id_list(raw, field):
    if raw in (None, ""):
        return []
    if not isinstance(raw, list):
        raise ValidationError({field: "فهرست شناسه‌ها معتبر نیست."})
    values = []
    for item in raw:
        try:
            values.append(int(item))
        except (TypeError, ValueError):
            raise ValidationError({field: "فهرست شناسه‌ها معتبر نیست."})
    return values


def _condition_result(property_file, property_obj, condition):
    field = condition.get("field") or ""
    operator = condition.get("operator") or "EQ"
    expected = condition.get("value")
    source = {
        "area": property_obj.area,
        "rooms": property_obj.rooms,
        "built_year": property_obj.built_year,
        "floor": property_obj.floor,
        "sale_price": property_file.sale_price,
        "deposit": property_file.deposit,
        "monthly_rent": property_file.monthly_rent,
    }.get(field)
    if source is None:
        return None
    try:
        if operator == "GTE":
            return Decimal(str(source)) >= Decimal(str(expected))
        if operator == "LTE":
            return Decimal(str(source)) <= Decimal(str(expected))
        if operator == "IN":
            return str(source) in [str(item) for item in (expected or [])]
        return str(source) == str(expected)
    except Exception:
        return None


def match_listings(inquiry_id, user=None):
    inquiry = models.Inquiry.objects.select_related("contact").get(pk=inquiry_id)
    preferences = list(inquiry.preferences.select_related("deal_type", "deal_type_version").prefetch_related("districts", "property_types"))
    results = []
    for property_file in _active_listing_for_matching(user or inquiry.created_by):
        pref = next((item for item in preferences if item.deal_type_id == property_file.deal_type_id), None)
        reasons = []
        blockers = []
        property_obj = property_file.property
        reasons.append({"label": "نوع معامله", "passed": pref is not None, "detail": property_file.deal_type.display_name if property_file.deal_type_id else "نامشخص"})
        if pref is None:
            blockers.append("نوع معامله در نیاز متقاضی نیست")
        else:
            district_ids = set(pref.districts.values_list("id", flat=True))
            property_type_ids = set(pref.property_types.values_list("id", flat=True))
            district_passed = not district_ids or property_obj.district_id in district_ids
            reasons.append({"label": "منطقه", "passed": district_passed, "detail": property_obj.district.display_name if property_obj.district_id else "منطقه ثبت نشده"})
            if not district_passed:
                blockers.append("منطقه با مناطق مطلوب منطبق نیست")
            type_passed = not property_type_ids or (property_obj.property_type_ref_id and property_obj.property_type_ref_id in property_type_ids)
            reasons.append({"label": "نوع ملک", "passed": type_passed, "detail": property_obj.get_property_type_display()})
            if not type_passed:
                blockers.append("نوع ملک با انواع مطلوب منطبق نیست")
            min_area = pref.min_area
            max_area = pref.max_area
            area_passed = (min_area is None or property_obj.area >= min_area) and (max_area is None or property_obj.area <= max_area)
            reasons.append({"label": "متراژ", "passed": area_passed, "detail": f"{property_obj.area} متر"})
            if not area_passed:
                blockers.append("متراژ در بازه نیاز نیست")
            min_rooms = (pref.criteria or {}).get("min_rooms")
            rooms_passed = not min_rooms or property_obj.rooms >= int(min_rooms)
            reasons.append({"label": "تعداد اتاق", "passed": rooms_passed, "detail": f"{property_obj.rooms} خواب"})
            if not rooms_passed:
                blockers.append("تعداد اتاق کمتر از نیاز است")
            budget_passed, budget_detail = _budget_result(pref, property_file)
            reasons.append({"label": "بودجه", "passed": budget_passed, "detail": budget_detail})
            if not budget_passed:
                blockers.append("مبلغ یا ودیعه خارج از بودجه است")
            for condition in (pref.criteria or {}).get("required", []):
                outcome = _condition_result(property_file, property_obj, condition)
                reasons.append({"label": f"شرط ضروری: {condition.get('label')}", "passed": bool(outcome), "detail": "بررسی‌نشده" if outcome is None else ""})
                if outcome is not True:
                    blockers.append(f"شرط ضروری برقرار نیست: {condition.get('label')}")
        passed_count = sum(1 for reason in reasons if reason["passed"])
        percent = int(round(passed_count * 100 / len(reasons))) if reasons else 0
        already_introduced = models.Introduction.objects.filter(
            inquiry=inquiry,
            property_file=property_file,
            status=models.Introduction.Status.OPEN,
        ).exists()
        results.append(
            {
                "property_file_id": property_file.pk,
                "listing_id": property_file.pk,
                "property_id": property_file.property_id,
                "title": property_file.title,
                "property_title": property_obj.title,
                "district": property_obj.district.display_name if property_obj.district_id else property_obj.neighborhood,
                "area": property_obj.area,
                "deal_type": property_file.deal_type_id,
                "deal_type_name": property_file.deal_type.display_name if property_file.deal_type_id else "",
                "sale_price": property_file.sale_price,
                "deposit": property_file.deposit,
                "monthly_rent": property_file.monthly_rent,
                "matched": not blockers,
                "match_percent": 100 if not blockers else max(0, min(percent, 99)),
                "reasons": reasons,
                "blockers": blockers,
                "already_introduced": already_introduced,
                "buyer_consultant_name": _user_name(inquiry.assigned_to),
                "seller_consultant_name": _user_name(property_file.assigned_to or property_obj.consultant),
                "snapshot": property_file_snapshot(property_file),
            }
        )
    results.sort(key=lambda item: (-item["match_percent"], item["property_file_id"]))
    return results



def _user_name(user):
    if not user:
        return ""
    return user.get_full_name().strip() or user.username


def _budget_result(pref, property_file):
    family = _deal_family(property_file)
    rental = family in ("RENT", "FULL_MORTGAGE")
    checks = []
    if rental:
        if pref.max_deposit is not None:
            checks.append(property_file.deposit is not None and property_file.deposit <= pref.max_deposit)
        if pref.max_monthly_rent is not None:
            checks.append(property_file.monthly_rent is not None and property_file.monthly_rent <= pref.max_monthly_rent)
    elif pref.max_amount is not None:
        if property_file.sale_price is None:
            checks.append(False)
        else:
            checks.append(pref.min_amount is None or property_file.sale_price >= pref.min_amount)
            checks.append(property_file.sale_price <= pref.max_amount)
    if not checks:
        return True, "بدون سقف بودجه"
    return all(checks), "در بازه بودجه" if all(checks) else "خارج از بازه بودجه"


def introduce_listing(inquiry_id, user, data):
    require_permission(user, "introduction.manage")
    inquiry = _lock_inquiry(inquiry_id)
    _require_inquiry_owner(user, inquiry)
    _require_open_inquiry(inquiry)
    if inquiry.acceptance_status != models.AcceptanceStatus.ACCEPTED and not user_is_general_manager(user):
        raise ValidationError({"acceptance_status": "معرفی فقط برای مسئول پذیرفته‌شده ممکن است."})
    listing_id = data.get("listing_id") or data.get("property_file_id") or data.get("property_file") or data.get("listing")
    property_file = get_object_or_404(_active_listing_for_matching(user), pk=listing_id)
    if property_file.status != PropertyFile.Status.ACTIVE or property_file.property.review_status != Property.ReviewStatus.APPROVED:
        raise ValidationError({"listing_id": "فایل انتخاب‌شده فعال و قابل عرضه نیست."})
    pref_exists = inquiry.preferences.filter(deal_type_id=property_file.deal_type_id).exists()
    if not pref_exists:
        raise ValidationError({"listing_id": "نوع معامله این فایل در نیاز متقاضی ثبت نشده است."})
    existing = models.Introduction.objects.filter(
        inquiry=inquiry,
        property_file=property_file,
        status=models.Introduction.Status.OPEN,
    ).first()
    if existing:
        return existing, False
    snapshot = property_file_snapshot(property_file)
    snapshot["property_title"] = property_file.property.title
    snapshot["district"] = property_file.property.district.display_name if property_file.property.district_id else property_file.property.neighborhood
    snapshot["area"] = property_file.property.area
    snapshot["rooms"] = property_file.property.rooms
    snapshot["deal_type_name"] = property_file.deal_type.display_name if property_file.deal_type_id else ""
    seller = property_file.assigned_to or property_file.property.consultant
    try:
        intro = models.Introduction.objects.create(
            inquiry=inquiry,
            property_file=property_file,
            introduced_terms_snapshot=snapshot,
            introduced_by=user,
            buyer_consultant=inquiry.assigned_to,
            seller_consultant=seller,
        )
    except IntegrityError:
        return models.Introduction.objects.get(inquiry=inquiry, property_file=property_file, status=models.Introduction.Status.OPEN), False
    if seller and seller.pk != user.pk:
        make_task(
            f"هماهنگی بازدید متقاضی {inquiry.code}",
            seller,
            user,
            timezone.now() + timezone.timedelta(days=2),
            property_obj=property_file.property,
            task_type=Task.TaskType.VIEWING,
            inquiry=inquiry,
        )
        notify_workflow_event(
            [seller],
            title="معرفی فایل به متقاضی",
            message=f"فایل {property_file.title} برای درخواست {inquiry.code} معرفی شد.",
            metadata={"subject_type": "INTRODUCTION", "subject_id": intro.pk},
            event_key_prefix=f"introduction:{intro.pk}",
        )
    record_transition("INQUIRY", inquiry.pk, "matching", "matching", user, "معرفی فایل", operation_id=f"introduction:{intro.pk}")
    return intro, True


def update_introduction(intro_id, user, data):
    require_permission(user, "introduction.manage")
    intro = models.Introduction.objects.select_for_update(of=("self",)).select_related("inquiry", "property_file").get(pk=intro_id)
    inquiry = intro.inquiry
    participants = {intro.buyer_consultant_id, intro.seller_consultant_id, intro.introduced_by_id} - {None}
    if not user_is_general_manager(user) and user.pk not in participants and not can_manage_inquiry(user, inquiry):
        raise PermissionDenied("شما اجازه ثبت بازخورد این معرفی را ندارید.")
    ensure_case_version(intro, data)
    interest = str(data.get("customer_interest") or "").upper()
    if interest and interest not in models.Introduction.Interest.values:
        raise ValidationError({"customer_interest": "علاقه متقاضی معتبر نیست."})
    rejection_reason = str(data.get("rejection_reason") or "").strip()
    feedback = str(data.get("feedback") or "").strip()
    if interest == models.Introduction.Interest.NOT_INTERESTED and not rejection_reason:
        raise ValidationError({"rejection_reason": "برای رد فایل، دلیل الزامی است."})
    if interest:
        intro.customer_interest = interest
    if rejection_reason:
        intro.rejection_reason = rejection_reason[:2000]
    if feedback:
        intro.feedback = feedback[:5000]
    if interest == models.Introduction.Interest.NOT_INTERESTED:
        intro.status = models.Introduction.Status.CLOSED
    intro.version += 1
    intro.save(update_fields=["customer_interest", "rejection_reason", "feedback", "status", "version", "updated_at"])
    record_transition("INQUIRY", inquiry.pk, inquiry_stage(inquiry), inquiry_stage(inquiry), user, "ثبت بازخورد معرفی", operation_id=f"introduction:{intro.pk}")
    return intro


def schedule_viewing(user, data):
    require_permission(user, "viewing.manage")
    intro_id = data.get("introduction")
    intro = models.Introduction.objects.select_for_update(of=("self",)).select_related("inquiry", "property_file__property").get(pk=intro_id)
    inquiry = intro.inquiry
    _require_open_inquiry(inquiry)
    if intro.status != models.Introduction.Status.OPEN:
        raise ValidationError({"introduction": "این معرفی بسته شده است."})
    if intro.property_file.status != PropertyFile.Status.ACTIVE or intro.property_file.property.review_status != Property.ReviewStatus.APPROVED:
        raise ValidationError({"introduction": "فایل مرتبط فعال و قابل عرضه نیست."})
    participants = {intro.buyer_consultant_id, intro.seller_consultant_id, intro.introduced_by_id} - {None}
    manager = user_is_general_manager(user) or can_manage_inquiry(user, inquiry)
    if not manager and user.pk not in participants:
        raise PermissionDenied("فقط مدیر رنج یا کارشناس معرفی‌شده می‌تواند بازدید ثبت کند.")
    scheduled_at = parse_dt(data.get("scheduled_at"), "scheduled_at", required=True)
    if scheduled_at < timezone.now() - timezone.timedelta(days=1):
        raise ValidationError({"scheduled_at": "زمان بازدید نمی‌تواند در گذشته باشد."})
    assigned = None
    if data.get("assigned_to"):
        assigned = get_object_or_404(User, pk=data.get("assigned_to"), is_active=True)
        if not manager and assigned.pk not in participants:
            raise PermissionDenied("مسئول بازدید باید یکی از کارشناسان معرفی‌شده باشد.")
    assigned = assigned or intro.buyer_consultant or user
    companion = None
    if data.get("companion"):
        companion = get_object_or_404(User, pk=data.get("companion"), is_active=True)
    duplicate = models.Viewing.objects.filter(introduction=intro, scheduled_at=scheduled_at, completed_at__isnull=True).first()
    if duplicate:
        return duplicate, False
    viewing = models.Viewing.objects.create(
        introduction=intro,
        scheduled_at=scheduled_at,
        assigned_to=assigned,
        companion_id=companion.pk if companion else None,
        notes=str(data.get("notes") or "")[:2000],
    )
    task = make_task(
        f"بازدید {inquiry.code} — {intro.property_file.title}",
        assigned,
        user,
        scheduled_at,
        property_obj=intro.property_file.property,
        task_type=Task.TaskType.VIEWING,
        inquiry=inquiry,
    )
    viewing.task = task
    viewing.save(update_fields=["task"])
    notify_workflow_event(
        [assigned],
        title="بازدید برنامه‌ریزی‌شده",
        message=f"بازدید درخواست {inquiry.code} برای {intro.property_file.title} ثبت شد.",
        metadata={"subject_type": "VIEWING", "subject_id": viewing.pk},
        event_key_prefix=f"viewing:{viewing.pk}",
    )
    record_transition("INQUIRY", inquiry.pk, "matching", "viewings", user, "ثبت زمان بازدید", operation_id=f"viewing:{viewing.pk}")
    return viewing, True


def complete_viewing(viewing_id, user, data):
    require_permission(user, "viewing.manage")
    viewing = models.Viewing.objects.select_for_update(of=("self",)).select_related("introduction__inquiry", "task").get(pk=viewing_id)
    intro = viewing.introduction
    inquiry = intro.inquiry
    participants = {viewing.assigned_to_id, intro.buyer_consultant_id, intro.seller_consultant_id, intro.introduced_by_id} - {None}
    if not user_is_general_manager(user) and user.pk not in participants and not can_manage_inquiry(user, inquiry):
        raise PermissionDenied("فقط مدیر رنج یا کارشناس معرفی‌شده می‌تواند نتیجه بازدید را ثبت کند.")
    result = str(data.get("result") or "").upper()
    if result not in (models.Viewing.Result.INTERESTED, models.Viewing.Result.NOT_INTERESTED):
        raise ValidationError({"result": "نتیجه بازدید نامعتبر است."})
    notes = str(data.get("notes") or "").strip()
    if viewing.completed_at is not None:
        if viewing.result == result:
            return viewing, False
        raise ValidationError({"result": "نتیجه این بازدید قبلاً ثبت شده است."})
    viewing.result = result
    viewing.notes = notes[:5000]
    viewing.completed_at = timezone.now()
    viewing.version += 1
    viewing.save(update_fields=["result", "notes", "completed_at", "version", "updated_at"])
    if viewing.task_id:
        task = viewing.task
        if task.status != Task.Status.COMPLETED:
            task.status = Task.Status.COMPLETED
            task.completed_at = timezone.now()
            task.save(update_fields=["status", "completed_at", "updated_at"])
    if result == models.Viewing.Result.INTERESTED:
        intro.customer_interest = models.Introduction.Interest.INTERESTED
        intro.save(update_fields=["customer_interest", "updated_at"])
    else:
        intro.customer_interest = models.Introduction.Interest.NOT_INTERESTED
        intro.feedback = notes or intro.feedback
        intro.save(update_fields=["customer_interest", "feedback", "updated_at"])
    record_transition("INQUIRY", inquiry.pk, "viewings", "viewings", user, "ثبت نتیجه بازدید", operation_id=f"viewing:{viewing.pk}")
    return viewing, True


def _buyer_role(family):
    return models.DealParticipant.Role.TENANT if family in ("RENT", "FULL_MORTGAGE") else models.DealParticipant.Role.BUYER


def _seller_role(family):
    return models.DealParticipant.Role.LANDLORD if family in ("RENT", "FULL_MORTGAGE") else models.DealParticipant.Role.SELLER


def create_deal(user, data):
    require_permission(user, "deal.manage")
    intro_id = data.get("introduction") or data.get("introduction_id")
    viewing_id = data.get("viewing") or data.get("viewing_id")
    introduction = None
    viewing = None
    if viewing_id:
        viewing = get_object_or_404(models.Viewing.objects.select_related("introduction__inquiry"), pk=viewing_id)
        introduction = viewing.introduction
        if viewing.completed_at is None:
            raise ValidationError({"viewing": "ابتدا نتیجه بازدید را ثبت کنید."})
        if viewing.result == models.Viewing.Result.NOT_INTERESTED:
            raise ValidationError({"viewing": "نتیجه بازدید عدم تمایل متقاضی است؛ مذاکره قابل شروع نیست."})
    elif intro_id:
        introduction = get_object_or_404(models.Introduction.objects.select_related("inquiry"), pk=intro_id)
    else:
        raise ValidationError({"introduction": "معرفی یا بازدید مبنا انتخاب نشده است."})
    inquiry = _lock_inquiry(introduction.inquiry_id)
    _require_open_inquiry(inquiry)
    if introduction.status != models.Introduction.Status.OPEN:
        raise ValidationError({"introduction": "این معرفی بسته شده است."})
    property_file = introduction.property_file
    if property_file.status != PropertyFile.Status.ACTIVE or property_file.property.review_status != Property.ReviewStatus.APPROVED:
        raise ValidationError({"introduction": "فایل انتخاب‌شده فعال و قابل معامله نیست."})
    if not user_is_general_manager(user) and not can_manage_inquiry(user, inquiry):
        participants = {introduction.buyer_consultant_id, introduction.seller_consultant_id, introduction.introduced_by_id} - {None}
        if user.pk not in participants:
            raise PermissionDenied("شما اجازه شروع مذاکره برای این معرفی را ندارید.")
    existing = models.Deal.objects.filter(
        inquiry=inquiry,
        property_file=property_file,
        stage__in=(models.Deal.Stage.NEGOTIATION, models.Deal.Stage.AGREED, models.Deal.Stage.CONTRACT),
    ).first()
    if existing:
        return existing, False
    family = _deal_family(property_file)
    deal = models.Deal.objects.create(
        introduction=introduction,
        viewing=viewing,
        property_file=property_file,
        inquiry=inquiry,
        assigned_to=inquiry.assigned_to or user,
        deal_type_version=property_file.deal_type_version,
    )
    payloads = data.get("participants") or []
    if not isinstance(payloads, list) or len(payloads) > 50:
        raise ValidationError({"participants": "فهرست طرف‌های مذاکره معتبر نیست."})
    if payloads:
        for payload in payloads:
            _attach_participant(deal, inquiry, property_file, payload, user)
    else:
        models.DealParticipant.objects.get_or_create(
            deal=deal,
            contact=inquiry.contact,
            participant_role=_buyer_role(family),
            defaults={"is_primary": True},
        )
        owners = models.PropertyParty.objects.filter(property_id=property_file.property_id, role__in=(models.PropertyParty.Role.OWNER, models.PropertyParty.Role.OWNER_REPRESENTATIVE)).select_related("contact")
        if not owners.exists():
            raise ValidationError({"participants": "پیش از شروع مذاکره، مالک را به ملک پیوند دهید."})
        for owner in owners:
            models.DealParticipant.objects.get_or_create(
                deal=deal,
                contact=owner.contact,
                participant_role=_seller_role(family),
                defaults={"is_primary": owner.is_primary},
            )
    record_transition("INQUIRY", inquiry.pk, inquiry_stage(inquiry), "negotiation", user, "شروع مذاکره", operation_id=f"deal:{deal.pk}")
    record_transition("DEAL", deal.pk, "", models.Deal.Stage.NEGOTIATION, user, "شروع مذاکره")
    if introduction.seller_consultant_id and introduction.seller_consultant_id != user.pk:
        notify_workflow_event(
            [introduction.seller_consultant],
            title="مذاکره جدید",
            message=f"مذاکره‌ای برای فایل {property_file.title} آغاز شد.",
            metadata={"subject_type": "DEAL", "subject_id": deal.pk},
            event_key_prefix=f"deal-start:{deal.pk}",
        )
    return deal, True


def _attach_participant(deal, inquiry, property_file, payload, user):
    if not isinstance(payload, dict):
        raise ValidationError({"participants": "ساختار طرف مذاکره معتبر نیست."})
    contact = models.Contact.objects.filter(pk=payload.get("contact")).first()
    if contact is None:
        raise ValidationError({"participants": "طرف مذاکره انتخاب‌شده وجود ندارد."})
    allowed = {inquiry.contact_id}
    allowed.update(
        models.PropertyParty.objects.filter(property_id=property_file.property_id).values_list("contact_id", flat=True)
    )
    if not user_is_general_manager(user) and contact.pk not in allowed:
        raise PermissionDenied("طرف مذاکره باید با پرونده متقاضی یا اشخاص مرتبط با ملک مرتبط باشد.")
    role = payload.get("participant_role")
    if role not in models.DealParticipant.Role.values:
        raise ValidationError({"participant_role": "نقش طرف مذاکره معتبر نیست."})
    participant, _ = models.DealParticipant.objects.get_or_create(
        deal=deal,
        contact=contact,
        participant_role=role,
        defaults={"is_primary": bool(payload.get("is_primary"))},
    )
    return participant


def succeed_deal(deal_id, user, data):
    require_permission(user, "deal.manage")
    deal = models.Deal.objects.select_for_update(of=("self",)).select_related("inquiry", "property_file__property").get(pk=deal_id)
    if not user_is_general_manager(user) and not can_manage_inquiry(user, deal.inquiry):
        participants = {deal.introduction.buyer_consultant_id, deal.introduction.seller_consultant_id} - {None}
        if user.pk not in participants:
            raise PermissionDenied("شما اجازه ثبت نتیجه این مذاکره را ندارید.")
    ensure_case_version(deal, data)
    if deal.stage == models.Deal.Stage.AGREED:
        return deal, False
    if deal.stage != models.Deal.Stage.NEGOTIATION:
        raise ValidationError({"stage": "این مذاکره در مرحله مذاکره نیست."})
    deal.stage = models.Deal.Stage.AGREED
    deal.result_notes = str(data.get("result_notes") or "")[:5000]
    deal.version += 1
    deal.save(update_fields=["stage", "result_notes", "version"])
    record_transition("DEAL", deal.pk, models.Deal.Stage.NEGOTIATION, models.Deal.Stage.AGREED, user, deal.result_notes)
    managers = list(User.objects.filter(groups__name="GENERAL_MANAGER", is_active=True).distinct())
    for manager in managers:
        make_task(
            f"آماده‌سازی قرارداد درخواست {deal.inquiry.code}",
            manager,
            user,
            timezone.now() + timezone.timedelta(days=3),
            property_obj=deal.property_file.property,
            task_type=Task.TaskType.CONTRACT,
            inquiry=deal.inquiry,
        )
    notify_workflow_event(
        managers,
        title="مذاکره موفق",
        message=f"مذاکره درخواست {deal.inquiry.code} به توافق رسید؛ قرارداد را تنظیم کنید.",
        metadata={"subject_type": "DEAL", "subject_id": deal.pk},
        event_key_prefix=f"deal-agreed:{deal.pk}",
    )
    return deal, True


def close_deal(deal_id, user, data):
    require_permission(user, "deal.manage")
    deal = models.Deal.objects.select_for_update(of=("self",)).select_related("inquiry").get(pk=deal_id)
    if not user_is_general_manager(user) and not can_manage_inquiry(user, deal.inquiry):
        raise PermissionDenied("شما اجازه بستن این مذاکره را ندارید.")
    ensure_case_version(deal, data)
    reason = str(data.get("closure_reason") or data.get("reason") or "").strip()
    if not reason:
        raise ValidationError({"closure_reason": "ثبت دلیل عدم توافق الزامی است."})
    if deal.stage == models.Deal.Stage.LOST:
        return deal, False
    if deal.stage in (models.Deal.Stage.FINALIZED,):
        raise ValidationError({"stage": "مذاکره نهایی‌شده قابل بستن نیست."})
    previous = deal.stage
    deal.stage = models.Deal.Stage.LOST
    deal.closure_reason = reason[:5000]
    deal.closed_at = timezone.now()
    deal.version += 1
    deal.save(update_fields=["stage", "closure_reason", "closed_at", "version"])
    record_transition("DEAL", deal.pk, previous, models.Deal.Stage.LOST, user, reason)
    return deal, True


def create_contract(deal_id, user, data):
    require_permission(user, "contract.manage")
    if not user_is_general_manager(user):
        raise PermissionDenied("تنظیم قرارداد فقط برای مدیر کل مجاز است.")
    deal = models.Deal.objects.select_for_update(of=("self",)).select_related("inquiry", "property_file__property", "property_file__deal_type").get(pk=deal_id)
    existing = models.Contract.objects.filter(deal=deal).first()
    if existing:
        return existing, False
    if deal.stage != models.Deal.Stage.AGREED:
        raise ValidationError({"deal": "قرارداد فقط از مذاکرهٔ توافق‌شده ساخته می‌شود."})
    property_file = deal.property_file
    if property_file.status != PropertyFile.Status.ACTIVE:
        raise ValidationError({"deal": "فایل مرتبط فعال نیست."})
    version = deal.deal_type_version or property_file.deal_type_version
    if version is None:
        raise ValidationError({"deal": "نسخهٔ نوع معامله برای این فایل ثبت نشده است."})
    number = f"C-{timezone.now():%Y%m}-{deal.pk:05d}"
    if models.Contract.objects.filter(contract_number=number).exists():
        number = f"C-{timezone.now():%Y%m}-{uuid.uuid4().hex[:6].upper()}"
    contract = models.Contract.objects.create(
        deal=deal,
        contract_number=number,
        deal_type_version=version,
        terms_snapshot={},
        created_by=user,
    )
    for participant in deal.participants.select_related("contact"):
        contact = participant.contact
        party, _ = models.ContractParty.objects.get_or_create(
            contract=contract,
            contact=contact,
            party_role=participant.participant_role,
            defaults={
                "identity_snapshot": {
                    "full_name": contact.full_name,
                    "national_code": contact.national_code,
                    "phones": list(contact.phones.values_list("phone", flat=True)),
                }
            },
        )
        models.ContractSignature.objects.get_or_create(contract_party=party)
    deal.stage = models.Deal.Stage.CONTRACT
    deal.version += 1
    deal.save(update_fields=["stage", "version"])
    record_transition("DEAL", deal.pk, models.Deal.Stage.AGREED, models.Deal.Stage.CONTRACT, user, "تنظیم قرارداد", operation_id=f"contract:{contract.pk}")
    Task.objects.filter(inquiry=deal.inquiry, task_type=Task.TaskType.CONTRACT, status=Task.Status.PENDING).update(status=Task.Status.COMPLETED, completed_at=timezone.now())
    return contract, True


def _contract_terms(contract, data):
    version = contract.deal_type_version
    if version is None:
        raise ValidationError({"deal_type_version": "نسخهٔ نوع معامله برای قرارداد ثبت نشده است."})
    schema = version.terms_schema or {}
    fields = (schema or {}).get("fields") or []
    allowed = {field.get("key") for field in fields if isinstance(field, dict)}
    raw = data.get("terms", data.get("terms_snapshot"))
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise ValidationError({"terms": "شرایط قرارداد باید یک شیء ساخت‌یافته باشد."})
    terms = {}
    for key in allowed:
        value = raw.get(key)
        if value in (None, ""):
            mapped = {"sale_price": data.get("sale_price"), "deposit": data.get("deposit"), "monthly_rent": data.get("monthly_rent")}.get(key)
            value = mapped
        if value in (None, ""):
            continue
        if isinstance(value, Decimal):
            value = int(value)
        terms[key] = value
    validate_terms(schema, terms)
    return terms


def save_contract_terms(contract_id, user, data):
    require_permission(user, "contract.manage")
    if not user_is_general_manager(user):
        raise PermissionDenied("ویرایش شرایط قرارداد فقط برای مدیر کل مجاز است.")
    contract = models.Contract.objects.select_for_update().get(pk=contract_id)
    if contract.status not in CONTRACT_EDITABLE_STATUSES:
        raise ValidationError({"status": "قرارداد قطعی‌شده قابل ویرایش نیست."})
    if contract.parties.filter(signature__status=models.ContractSignature.Status.SIGNED).exists():
        raise ValidationError({"status": "پس از امضای طرفین، شرایط قابل تغییر نیست."})
    ensure_case_version(contract, data)
    terms = _contract_terms(contract, data)
    history = list(contract.terms_history or [])
    history.append({"changed_by": user.pk, "changed_at": timezone.now().isoformat(), "version": contract.version, "terms": contract.terms_snapshot or {}})
    contract.terms_history = history
    contract.terms_snapshot = terms
    contract.sale_price = _decimal_or_none(terms.get("sale_price"))
    contract.deposit = _decimal_or_none(terms.get("deposit"))
    contract.monthly_rent = _decimal_or_none(terms.get("monthly_rent"))
    effective_at = data.get("effective_at")
    if effective_at not in (None, ""):
        contract.effective_at = parse_dt(effective_at, "effective_at", required=True)
    contract.version += 1
    contract.save(update_fields=["terms_history", "terms_snapshot", "sale_price", "deposit", "monthly_rent", "effective_at", "version", "updated_at"])
    return contract


def _decimal_or_none(value):
    if value in (None, ""):
        return None
    return Decimal(str(value))


def validate_contract_terms(contract):
    version = contract.deal_type_version
    if version is None:
        raise ValidationError({"deal_type_version": "نسخهٔ نوع معامله ثبت نشده است."})
    validate_terms(version.terms_schema or {}, contract.terms_snapshot or {})


def sign_contract(contract_id, user, data):
    require_permission(user, "contract.manage")
    if not user_is_general_manager(user):
        raise PermissionDenied("ثبت امضا فقط برای مدیر کل مجاز است.")
    contract = models.Contract.objects.select_for_update().get(pk=contract_id)
    if contract.status == models.Contract.Status.FINALIZED:
        raise ValidationError({"status": "قرارداد قطعی‌شده قابل تغییر نیست."})
    if not contract.parties.exists():
        raise ValidationError({"parties": "طرفین قرارداد ثبت نشده‌اند."})
    validate_contract_terms(contract)
    party = get_object_or_404(models.ContractParty, pk=data.get("contract_party") or data.get("party"), contract=contract)
    signature, _ = models.ContractSignature.objects.get_or_create(contract_party=party)
    if signature.status == models.ContractSignature.Status.SIGNED:
        raise ValidationError({"contract_party": "این طرف قبلاً امضا کرده است."})
    signature.status = models.ContractSignature.Status.SIGNED
    signature.signed_at = timezone.now()
    signature.recorded_by = user
    signature.save(update_fields=["status", "signed_at", "recorded_by"])
    if contract.status == models.Contract.Status.DRAFT:
        contract.status = models.Contract.Status.SIGNING
    if not contract.parties.filter(signature__status=models.ContractSignature.Status.PENDING).exists():
        contract.signed_at = timezone.now()
    contract.version += 1
    contract.save(update_fields=["status", "signed_at", "version", "updated_at"])
    record_transition("CONTRACT", contract.pk, models.Contract.Status.DRAFT, contract.status, user, "ثبت امضای طرف", operation_id=f"signature:{party.pk}")
    return contract


def finalize_contract(contract_id, user):
    require_permission(user, "contract.manage")
    if not user_is_general_manager(user):
        raise PermissionDenied("قطعی‌سازی قرارداد فقط برای مدیر کل مجاز است.")
    contract = models.Contract.objects.select_for_update(of=("self",)).select_related("deal__property_file__property", "deal__inquiry").get(pk=contract_id)
    if contract.status == models.Contract.Status.FINALIZED:
        return contract, False
    validate_contract_terms(contract)
    if not contract.parties.exists():
        raise ValidationError({"parties": "طرفین قرارداد ثبت نشده‌اند."})
    if contract.parties.filter(signature__status=models.ContractSignature.Status.PENDING).exists():
        raise ValidationError({"parties": "امضای همه طرف‌ها کامل نیست."})
    deal = contract.deal
    property_file = deal.property_file
    prop = Property.objects.select_for_update().get(pk=property_file.property_id)
    family = _deal_family(property_file)
    conflict = models.Contract.objects.filter(
        deal__property_file__property=prop,
        status=models.Contract.Status.FINALIZED,
    ).exclude(pk=contract.pk)
    if family:
        conflict = conflict.filter(deal__property_file__deal_type__family=family)
    if conflict.exists():
        raise ValidationError({"detail": "برای این ملک قرارداد قطعی ناسازگار وجود دارد."})
    contract.status = models.Contract.Status.FINALIZED
    contract.finalized_at = timezone.now()
    contract.finalized_by = user
    if contract.effective_at is None:
        contract.effective_at = contract.finalized_at
    contract.version += 1
    contract.save(update_fields=["status", "finalized_at", "finalized_by", "effective_at", "version", "updated_at"])
    deal.stage = models.Deal.Stage.FINALIZED
    deal.closed_at = timezone.now()
    deal.version += 1
    deal.save(update_fields=["stage", "closed_at", "version"])
    record_transition("DEAL", deal.pk, models.Deal.Stage.CONTRACT, models.Deal.Stage.FINALIZED, user, "قطعی‌سازی قرارداد", operation_id=f"contract:{contract.pk}")
    property_file.status = PropertyFile.Status.SOLD
    property_file.save(update_fields=["status", "updated_at"])
    if family:
        PropertyFile.objects.filter(property=prop, deal_type__family=family, status=PropertyFile.Status.ACTIVE).exclude(pk=property_file.pk).update(status=PropertyFile.Status.ARCHIVED)
        siblings = models.Deal.objects.filter(
            property_file__property=prop,
            property_file__deal_type__family=family,
            stage__in=(models.Deal.Stage.NEGOTIATION, models.Deal.Stage.AGREED, models.Deal.Stage.CONTRACT),
        ).exclude(pk=deal.pk)
        for sibling in siblings:
            sibling.stage = models.Deal.Stage.LOST
            sibling.closure_reason = "قرارداد قطعی هم‌خانواده برای همین ملک ثبت شد."
            sibling.closed_at = timezone.now()
            sibling.version += 1
            sibling.save(update_fields=["stage", "closure_reason", "closed_at", "version"])
    inquiry = deal.inquiry
    inquiry.status = models.CaseStatus.COMPLETED
    inquiry.version += 1
    inquiry.save(update_fields=["status", "version", "updated_at"])
    record_transition("INQUIRY", inquiry.pk, "contract", "contract", user, "قرارداد قطعی شد", operation_id=f"contract:{contract.pk}")
    _create_commission(contract, deal, user)
    notify_workflow_event(
        [deal.assigned_to, property_file.assigned_to, contract.created_by],
        title="قرارداد قطعی شد",
        message=f"قرارداد {contract.contract_number} قطعی شد و فایل بسته شد.",
        metadata={"subject_type": "CONTRACT", "subject_id": contract.pk},
        event_key_prefix=f"contract-finalized:{contract.pk}",
    )
    Task.objects.filter(inquiry=inquiry, task_type__in=(Task.TaskType.CONTRACT, Task.TaskType.NEGOTIATION), status=Task.Status.PENDING).update(status=Task.Status.COMPLETED, completed_at=timezone.now())
    return contract, True


def _create_commission(contract, deal, user):
    policy = models.CommissionPolicyVersion.objects.filter(
        deal_type_id=deal.property_file.deal_type_id,
        status=models.CommissionPolicyVersion.Status.PUBLISHED,
    ).order_by("-version_number").first()
    base = contract.sale_price or contract.deposit or Decimal("0")
    if policy is None:
        notify_workflow_event(
            [user],
            title="سیاست کمیسیون منتشرشده نیست",
            message=f"برای قرارداد {contract.contract_number} سیاست کمیسیون منتشرشده تعریف نشده است.",
            metadata={"subject_type": "CONTRACT", "subject_id": contract.pk},
            event_key_prefix=f"commission-missing:{contract.pk}",
        )
        return None
    amount = commission_amount(policy, base)
    commission, _ = models.Commission.objects.get_or_create(
        contract=contract,
        debtor_contact=deal.inquiry.contact,
        defaults={
            "policy_version": policy,
            "calculation_snapshot": {
                "policy": policy.pk,
                "policy_version": policy.version_number,
                "method": policy.calculation_method,
                "parameters": policy.parameters,
                "base_amount": int(base),
            },
            "calculated_amount": amount,
            "final_amount": amount,
            "due_at": timezone.now() + timezone.timedelta(days=30),
        },
    )
    return commission


def create_amendment(contract_id, user, data):
    require_permission(user, "contract.manage")
    if not user_is_general_manager(user):
        raise PermissionDenied("ثبت اصلاحیه فقط برای مدیر کل مجاز است.")
    contract = models.Contract.objects.select_for_update().get(pk=contract_id)
    if contract.status != models.Contract.Status.FINALIZED:
        raise ValidationError({"status": "اصلاحیه فقط برای قرارداد قطعی ثبت می‌شود."})
    reason = str(data.get("reason") or "").strip()
    if not reason:
        raise ValidationError({"reason": "دلیل اصلاحیه الزامی است."})
    effective_at = parse_dt(data.get("effective_at"), "effective_at", required=True)
    new_terms = data.get("new_terms_snapshot", data.get("terms"))
    if not isinstance(new_terms, dict) or not new_terms:
        raise ValidationError({"new_terms_snapshot": "شرایط جدید اصلاحیه الزامی است."})
    validate_terms(contract.deal_type_version.terms_schema or {}, new_terms)
    number = (contract.amendments.order_by("-amendment_number").values_list("amendment_number", flat=True).first() or 0) + 1
    amendment = models.ContractAmendment.objects.create(
        contract=contract,
        amendment_number=number,
        reason=reason[:5000],
        previous_terms_snapshot=contract.terms_snapshot or {},
        new_terms_snapshot=new_terms,
        effective_at=effective_at,
        status=models.ContractAmendment.Status.APPROVED,
        approved_by=user,
    )
    record_transition("CONTRACT", contract.pk, "FINALIZED", "FINALIZED", user, f"اصلاحیه {number}", operation_id=f"amendment:{amendment.pk}")
    notify_workflow_event(
        [contract.created_by, contract.deal.assigned_to],
        title="اصلاحیه قرارداد ثبت شد",
        message=f"اصلاحیه شماره {number} برای قرارداد {contract.contract_number} ثبت شد.",
        metadata={"subject_type": "CONTRACT", "subject_id": contract.pk},
        event_key_prefix=f"amendment:{amendment.pk}",
    )
    return amendment


def inquiry_relation_snapshot(inquiry):
    introductions = list(models.Introduction.objects.filter(inquiry=inquiry).select_related("property_file").order_by("-created_at"))
    deals = list(models.Deal.objects.filter(inquiry=inquiry).select_related("property_file").order_by("-started_at"))
    contracts = list(models.Contract.objects.filter(deal__inquiry=inquiry).order_by("-created_at"))
    viewings = list(models.Viewing.objects.filter(introduction__inquiry=inquiry).order_by("scheduled_at"))
    return {
        "introductions": introductions,
        "deals": deals,
        "contracts": contracts,
        "viewings": viewings,
    }


def scope_visibility_for_followups(user):
    return case_visibility_filter(user, "inquiry")
