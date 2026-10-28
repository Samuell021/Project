from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import APIException

from apps.accounts.models import SalesRange, User
from apps.accounts.permissions import has_permission, require_permission, user_is_general_manager
from apps.basics.models import Attribute, DealType, DealTypeVersion, District, PropertyType, PropertyUsage
from apps.basics.terms import validate_terms
from apps.listings.models import PropertyFile, PropertyFilePriceHistory
from apps.notifications.models import Notification
from apps.notifications.services import notify_users
from apps.properties.models import Property, PropertyAttributeValue
from apps.tasks.models import Task

from .. import models
from ..phones import normalize_phone


CASE_CONFLICT_DETAIL = "پرونده توسط کاربر دیگری تغییر کرده است؛ اطلاعات را تازه کنید"


class CaseVersionConflict(APIException):
    status_code = 409
    default_detail = CASE_CONFLICT_DETAIL
    default_code = "version_conflict"


def parse_dt(raw, field="due_at", required=False):
    if raw in (None, ""):
        if required:
            raise ValidationError({field: "وارد کردن تاریخ و زمان الزامی است."})
        return None
    if hasattr(raw, "tzinfo"):
        dt = raw
    else:
        dt = parse_datetime(str(raw).strip())
        if dt is None:
            raise ValidationError({field: "فرمت تاریخ و زمان معتبر نیست."})
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


def ensure_case_version(instance, payload):
    if payload is None:
        return
    expected = payload.get("version")
    if expected is None:
        return
    if isinstance(expected, bool):
        raise ValidationError({"version": "نسخهٔ ارسالی معتبر نیست."})
    try:
        expected_num = int(expected)
    except (TypeError, ValueError):
        raise ValidationError({"version": "نسخهٔ ارسالی معتبر نیست."})
    if expected_num != instance.version:
        raise CaseVersionConflict(CASE_CONFLICT_DETAIL)


def property_case_stage(case) -> str:
    if case.status in (
        models.CaseStatus.CLOSED,
        models.CaseStatus.CANCELLED,
        models.CaseStatus.DUPLICATE,
    ):
        return "closed"
    if case.lead_status == models.LeadStatus.PENDING:
        return "reception"
    if case.acceptance_status in (
        models.AcceptanceStatus.UNASSIGNED,
        models.AcceptanceStatus.REJECTED,
    ) or not case.assigned_to_id:
        return "assignment"
    if case.acceptance_status == models.AcceptanceStatus.PENDING:
        return "acceptance"
    prop = getattr(case, "resulting_property", None)
    if prop is not None:
        if prop.review_status == Property.ReviewStatus.PENDING:
            return "review"
        if prop.review_status == Property.ReviewStatus.APPROVED:
            return "listing"
    return "appraisal"


def case_has_locked_contract(case, finalized_only=False) -> bool:
    if not getattr(case, "resulting_property_id", None):
        return False
    base = models.Contract.objects.filter(
        deal__introduction__property_file__property_id=case.resulting_property_id
    )
    if finalized_only:
        return base.filter(status=models.Contract.Status.FINALIZED).exists()
    return base.filter(
        Q(status__in=(models.Contract.Status.SIGNING, models.Contract.Status.FINALIZED))
        | Q(parties__signature__status=models.ContractSignature.Status.SIGNED)
    ).exists()


def notify_workflow_event(users, *, title, message, metadata, event_key_prefix, notification_type=Notification.NotificationType.TASK_ASSIGNED):
    clean = [u for u in (users or []) if getattr(u, "pk", None) and getattr(u, "is_active", True)]
    if not clean:
        return []
    return notify_users(
        clean,
        notification_type=notification_type,
        title=title,
        message=message,
        metadata=metadata,
        event_key_prefix=event_key_prefix,
    )


def range_manager_recipients(sales_range):
    from . import sales_range_managers

    managers = sales_range_managers(sales_range)
    if managers:
        return managers
    return list(User.objects.filter(groups__name="GENERAL_MANAGER", is_active=True))


@transaction.atomic
def create_property_case(user, data):
    from . import (
        can_manage_sales_range,
        make_task,
        record_transition,
        resolve_sales_range,
    )

    require_permission(user, "case.create")
    contact_id = data.get("contact")
    contact = None
    if contact_id not in (None, "", 0, "0"):
        try:
            cid = int(contact_id)
        except (TypeError, ValueError):
            raise ValidationError({"contact": "شناسه شخص معتبر نیست."})
        contact = models.Contact.objects.filter(pk=cid).first()
        if contact is None:
            raise ValidationError({"contact": "شخص انتخاب‌شده یافت نشد."})
    else:
        raw_contact = data.get("new_contact") if isinstance(data.get("new_contact"), dict) else data
        full_name = str(raw_contact.get("contact_full_name") or raw_contact.get("full_name") or "").strip()
        phone = str(raw_contact.get("contact_phone") or raw_contact.get("phone") or "").strip()
        email = str(raw_contact.get("contact_email") or raw_contact.get("email") or "").strip()
        if not full_name:
            raise ValidationError({"contact_full_name": "نام کامل شخص مرتبط الزامی است."})
        if not phone and not email:
            raise ValidationError({"contact_phone": "حداقل یک راه ارتباطی (شماره تماس یا ایمیل) الزامی است."})
        normalized = ""
        if phone:
            normalized = normalize_phone(phone)
            if not normalized:
                raise ValidationError({"contact_phone": "شماره تماس معتبر نیست."})
            existing_phone = models.ContactPhone.objects.select_related("contact").filter(normalized_phone=normalized).first()
            if existing_phone is not None:
                contact = existing_phone.contact
        if contact is None:
            contact = models.Contact.objects.create(
                full_name=full_name,
                email=email,
                created_by=user,
            )
            if normalized:
                models.ContactPhone.objects.create(
                    contact=contact,
                    phone=phone,
                    normalized_phone=normalized,
                    is_primary=True,
                )

    description = str(data.get("description") or "").strip()
    lead_source = str(data.get("lead_source") or models.LeadSource.OWNER_REFERRAL).strip().upper()
    if lead_source not in models.LeadSource.values:
        raise ValidationError({"lead_source": "منبع سرنخ معتبر نیست."})

    sales_range = resolve_sales_range(user, data.get("sales_range", data.get("scope")))
    auto_accept = user_is_general_manager(user) or can_manage_sales_range(
        user, sales_range.pk if sales_range else None
    )
    now = timezone.now()
    code = f"R-{timezone.now():%Y%m%d}-{uuid.uuid4().hex[:6].upper()}"
    deal_ids = data.get("desired_deal_type_ids") or []
    valid_deal_types = []
    if deal_ids:
        if not isinstance(deal_ids, list):
            raise ValidationError({"desired_deal_type_ids": "لیست انواع معامله معتبر نیست."})
        valid_deal_types = list(DealType.objects.filter(pk__in=[int(i) for i in deal_ids], is_active=True))

    case = models.PropertyRegistrationRequest.objects.create(
        code=code,
        contact=contact,
        description=description,
        lead_source=lead_source,
        sales_range=sales_range,
        created_by=user,
        lead_status=models.LeadStatus.ACCEPTED if auto_accept else models.LeadStatus.PENDING,
        lead_accepted_by=user if auto_accept else None,
        lead_accepted_at=now if auto_accept else None,
    )
    for dt in valid_deal_types:
        models.RegistrationRequestDealType.objects.get_or_create(
            registration_request=case, deal_type=dt
        )
    record_transition("PROPERTY_CASE", case.pk, "", case.lead_status, user)
    if not auto_accept:
        managers = range_manager_recipients(sales_range)
        for manager in managers:
            make_task(
                f"بررسی سرنخ {case.code}",
                manager,
                user,
                now + timedelta(days=1),
            )
        notify_workflow_event(
            managers,
            title="سرنخ جدید",
            message=f"پرونده {case.code} در انتظار پذیرش مدیر است.",
            metadata={"subject_type": "PROPERTY_CASE", "subject_id": case.pk, "code": case.code},
            event_key_prefix=f"case-lead-created:{case.pk}",
        )
    return case


@transaction.atomic
def reject_assignment(subject, user, reason, payload=None):
    from . import history, record_transition, subject_kind

    ensure_case_version(subject, payload)
    if subject.assigned_to_id != user.pk:
        raise PermissionDenied("فقط مسئول فعلی می‌تواند ارجاع را رد کند.")
    if subject.acceptance_status != models.AcceptanceStatus.PENDING:
        raise ValidationError({"acceptance_status": "این ارجاع در انتظار پذیرش نیست."})
    clean_reason = str(reason or "").strip()
    if not clean_reason:
        raise ValidationError({"reason": "ثبت دلیل برای رد ارجاع الزامی است."})

    previous_user = subject.assigned_to
    old_due = subject.due_at
    subject.assigned_to = None
    subject.assigned_at = None
    subject.accepted_at = None
    subject.due_at = None
    subject.acceptance_status = models.AcceptanceStatus.REJECTED
    subject.version += 1
    subject.save(
        update_fields=[
            "assigned_to",
            "assigned_at",
            "accepted_at",
            "due_at",
            "acceptance_status",
            "version",
            "updated_at",
        ]
    )
    subject.reschedule_requests.filter(
        status=models.AssignmentRescheduleRequest.Status.PENDING
    ).update(status=models.AssignmentRescheduleRequest.Status.CANCELLED)
    subject.withdrawal_requests.filter(
        status=models.ConsultantWithdrawalRequest.Status.PENDING
    ).update(status=models.ConsultantWithdrawalRequest.Status.CANCELLED)
    Task.objects.filter(
        assigned_to=previous_user,
        title__contains=subject.code,
        status=Task.Status.PENDING,
    ).update(status=Task.Status.CANCELLED)
    history(
        subject,
        models.AssignmentHistory.Action.REJECTED,
        user,
        from_user=previous_user,
        reason=clean_reason,
        old_due_at=old_due,
    )
    record_transition(
        subject_kind(subject),
        subject.pk,
        models.AcceptanceStatus.PENDING,
        models.AcceptanceStatus.REJECTED,
        user,
        clean_reason,
    )
    managers = range_manager_recipients(subject.sales_range)
    notify_workflow_event(
        managers,
        title="رد ارجاع پرونده",
        message=f"ارجاع پرونده {subject.code} توسط مشاور رد شد: {clean_reason}",
        metadata={"subject_type": subject_kind(subject), "subject_id": subject.pk, "reason": clean_reason},
        event_key_prefix=f"case-assign-reject:{subject_kind(subject)}:{subject.pk}:v{subject.version}",
    )
    return subject


@transaction.atomic
def change_assignee(subject, user, new_assignee, due_at, reason="", payload=None):
    from . import can_manage_sales_range, history, make_task, subject_kind, workflow_settings

    ensure_case_version(subject, payload)
    if subject.lead_status != models.LeadStatus.ACCEPTED:
        raise ValidationError({"lead_status": "ابتدا پذیرش مدیر باید انجام شود."})
    if subject.status in (
        models.CaseStatus.CLOSED,
        models.CaseStatus.CANCELLED,
        models.CaseStatus.DUPLICATE,
    ):
        raise ValidationError({"status": "پرونده بسته است و امکان تغییر مسئول ندارد."})
    if not (user_is_general_manager(user) or can_manage_sales_range(user, subject.sales_range_id)):
        raise PermissionDenied("شما اجازه تغییر مسئول این پرونده را ندارید.")
    if new_assignee is None or not new_assignee.is_active:
        raise ValidationError({"assigned_to": "مسئول انتخاب‌شده فعال نیست."})
    member = bool(
        subject.sales_range_id
        and SalesRange.objects.filter(pk=subject.sales_range_id, is_active=True)
        .filter(Q(members=new_assignee) | Q(managers=new_assignee))
        .exists()
    )
    if not member and not user_is_general_manager(new_assignee):
        raise ValidationError({"assigned_to": "مسئول انتخاب‌شده عضو فعال این رنج نیست."})
    parsed_due = parse_dt(due_at, "due_at", required=True)
    if parsed_due <= timezone.now():
        raise ValidationError({"due_at": "موعد انجام باید در آینده باشد."})
    if (
        subject.acceptance_status == models.AcceptanceStatus.PENDING
        and subject.assigned_at
        and subject.assigned_to_id != new_assignee.pk
    ):
        waiting_hours = workflow_settings().assignment_waiting_hours
        if timezone.now() < subject.assigned_at + timedelta(hours=waiting_hours):
            raise ValidationError(
                {"assigned_to": f"ارجاع بدون پاسخ تا {waiting_hours} ساعت قابل تغییر نیست."}
            )
    previous = subject.assigned_to
    old_due = subject.due_at
    now = timezone.now()
    subject.assigned_to = new_assignee
    subject.assigned_at = now
    subject.accepted_at = None
    subject.due_at = parsed_due
    subject.acceptance_status = models.AcceptanceStatus.PENDING
    subject.version += 1
    subject.save(
        update_fields=[
            "assigned_to",
            "assigned_at",
            "accepted_at",
            "due_at",
            "acceptance_status",
            "version",
            "updated_at",
        ]
    )
    subject.reschedule_requests.filter(
        status=models.AssignmentRescheduleRequest.Status.PENDING
    ).update(status=models.AssignmentRescheduleRequest.Status.CANCELLED)
    subject.withdrawal_requests.filter(
        status=models.ConsultantWithdrawalRequest.Status.PENDING
    ).update(status=models.ConsultantWithdrawalRequest.Status.CANCELLED)
    if previous and previous.pk != new_assignee.pk:
        Task.objects.filter(
            assigned_to=previous,
            title__contains=subject.code,
            status=Task.Status.PENDING,
        ).update(status=Task.Status.CANCELLED)
    if isinstance(subject, models.PropertyRegistrationRequest) and subject.resulting_property_id:
        prop = Property.objects.select_for_update().get(pk=subject.resulting_property_id)
        prop.consultant = new_assignee
        prop.save(update_fields=["consultant", "updated_at"])
        PropertyFile.objects.filter(property=prop).exclude(
            status=PropertyFile.Status.ARCHIVED
        ).update(assigned_to=new_assignee)
    history(
        subject,
        models.AssignmentHistory.Action.REASSIGNED,
        user,
        from_user=previous,
        to_user=new_assignee,
        reason=reason,
        old_due_at=old_due,
        new_due_at=parsed_due,
    )
    make_task(
        f"پذیرش ارجاع {subject.code}",
        new_assignee,
        user,
        parsed_due,
        getattr(subject, "resulting_property", None),
    )
    notify_workflow_event(
        [new_assignee],
        title="ارجاع پرونده",
        message=f"مسئولیت پرونده {subject.code} به شما ارجاع شد.",
        metadata={"subject_type": subject_kind(subject), "subject_id": subject.pk, "code": subject.code},
        event_key_prefix=f"case-change-assignee:{subject_kind(subject)}:{subject.pk}:v{subject.version}",
    )
    return subject


@transaction.atomic
def set_property_title(case, user, title, reason="", payload=None):
    from . import can_manage_sales_range, record_transition

    ensure_case_version(case, payload)
    if not (user_is_general_manager(user) or can_manage_sales_range(user, case.sales_range_id)):
        raise PermissionDenied("فقط مدیر رنج همان پرونده یا مدیر ارشد اجازهٔ تعیین عنوان ملک را دارد.")
    clean_title = str(title or "").strip()
    if not clean_title:
        raise ValidationError({"property_title": "عنوان ملک نمی‌تواند خالی باشد."})
    if len(clean_title) > 255:
        raise ValidationError({"property_title": "عنوان ملک حداکثر ۲۵۵ نویسه است."})
    old_title = case.property_title or ""
    case.property_title = clean_title
    case.version += 1
    case.save(update_fields=["property_title", "version", "updated_at"])
    if case.resulting_property_id:
        prop = Property.objects.select_for_update().get(pk=case.resulting_property_id)
        prop.title = clean_title
        prop.save(update_fields=["title", "updated_at"])
    record_transition(
        "PROPERTY_CASE",
        case.pk,
        old_title,
        clean_title,
        user,
        str(reason or "تبت یا ویرایش عنوان مدیریتی ملک").strip(),
    )
    return case


def _sync_property_parties(prop, case, data, actor):
    raw_parties = data.get("parties")
    if isinstance(raw_parties, list):
        now = timezone.now()
        models.PropertyParty.objects.filter(property=prop, ended_at__isnull=True).update(
            ended_at=now, is_primary=False
        )
        for index, item in enumerate(raw_parties):
            if not isinstance(item, dict):
                raise ValidationError({"parties": "ساختار اشخاص ملک معتبر نیست."})
            role = str(item.get("role") or models.PropertyParty.Role.OWNER).strip().upper()
            if role not in models.PropertyParty.Role.values:
                raise ValidationError({"parties": "نقش شخص در ملک معتبر نیست."})
            cid = item.get("contact")
            party_contact = None
            if cid not in (None, "", 0, "0"):
                party_contact = models.Contact.objects.filter(pk=int(cid)).first()
            if party_contact is None:
                fname = str(item.get("full_name") or "").strip()
                phone = str(item.get("phone") or "").strip()
                if not fname:
                    raise ValidationError({"parties": "نام کامل شخص مرتبط با ملک الزامی است."})
                norm = normalize_phone(phone) if phone else ""
                if phone and not norm:
                    raise ValidationError({"parties": "شماره تماس شخص مرتبط معتبر نیست."})
                if norm:
                    found = models.ContactPhone.objects.select_related("contact").filter(normalized_phone=norm).first()
                    party_contact = found.contact if found else None
                if party_contact is None:
                    party_contact = models.Contact.objects.create(full_name=fname, created_by=actor)
                    if norm:
                        models.ContactPhone.objects.create(
                            contact=party_contact, phone=phone, normalized_phone=norm, is_primary=True
                        )
            share_raw = item.get("share_percent")
            share_val = None
            if share_raw not in (None, ""):
                share_val = Decimal(str(share_raw))
                if share_val < 0 or share_val > 100:
                    raise ValidationError({"parties": "سهم مالکیت باید بین ۰ تا ۱۰۰ باشد."})
            link, created = models.PropertyParty.objects.update_or_create(
                property=prop,
                contact=party_contact,
                role=role,
                defaults={
                    "ended_at": None,
                    "share_percent": share_val,
                    "is_primary": bool(item.get("is_primary", index == 0 and role == models.PropertyParty.Role.OWNER)),
                },
            )
            prop.__dict__.pop("_primary_owner_contact", None)
        return

    if not models.PropertyParty.objects.filter(property=prop, role="OWNER", ended_at__isnull=True).exists():
        contact = case.contact
        models.PropertyParty.objects.update_or_create(
            property=prop,
            contact=contact,
            role="OWNER",
            defaults={"ended_at": None, "is_primary": True},
        )
        prop.__dict__.pop("_primary_owner_contact", None)


def _coordinate_value(raw, field, minimum, maximum):
    if raw in (None, ""):
        return None
    try:
        value = Decimal(str(raw).strip())
    except (InvalidOperation, TypeError, ValueError):
        raise ValidationError({field: "مختصات باید عدد معتبر باشد."})
    if not value.is_finite() or value < minimum or value > maximum:
        raise ValidationError({field: "مختصات خارج از بازهٔ مجاز است."})
    try:
        return value.quantize(Decimal("0.000001"))
    except InvalidOperation:
        raise ValidationError({field: "دقت مختصات معتبر نیست."})


def _sync_property_attributes(prop, property_type, payload):
    if not isinstance(payload, dict):
        raise ValidationError({"attributes": "ویژگی‌های ملک باید به شکل شیء کلید/مقدار ارسال شوند."})

    from apps.properties.serializers import PropertySerializer

    links = []
    if property_type is not None:
        links = list(
            property_type.attribute_links.filter(
                is_active=True,
                attribute__is_active=True,
                attribute__deleted_at__isnull=True,
                attribute__entity=Attribute.Entity.PROPERTY,
                attribute__is_core=False,
            ).select_related("attribute")
        )
    allowed = {link.attribute.name: link.attribute for link in links}
    unknown = [name for name in payload if name not in allowed]
    if unknown:
        raise ValidationError({"attributes": f"ویژگی‌ها با نوع ملک انتخاب‌شده سازگار نیستند: {'، '.join(unknown)}"})

    # The workspace sends a complete schema-shaped value set. Drop stale values
    # from a previous type and omitted optional values, then use the canonical
    # Property serializer's typed validation/storage implementation.
    PropertyAttributeValue.objects.filter(property=prop).exclude(
        attribute_id__in=[attribute.pk for attribute in allowed.values()]
    ).delete()
    retained_names = list(payload.keys())
    omitted = PropertyAttributeValue.objects.filter(property=prop)
    if retained_names:
        omitted = omitted.exclude(attribute__name__in=retained_names)
    omitted.delete()
    PropertySerializer().save_attribute_payload(prop, payload)


def _sync_legacy_property_feature_columns(prop):
    """Keep legacy searchable property columns in sync with dynamic values."""
    from apps.properties.features import mirror_feature_columns

    mirror_feature_columns(prop)


def _validate_required_property_attributes(prop):
    property_type = prop.property_type_ref
    if property_type is None:
        return
    required_links = property_type.attribute_links.filter(
        is_active=True,
        is_required=True,
        attribute__is_active=True,
        attribute__deleted_at__isnull=True,
        attribute__is_core=False,
    ).select_related("attribute")
    missing = []
    for link in required_links:
        value = PropertyAttributeValue.objects.filter(
            property=prop, attribute=link.attribute
        ).first()
        if value is None or value.value in (None, "", []):
            missing.append(link.attribute.display_name)
    if missing:
        raise ValidationError({"attributes": f"تکمیل ویژگی‌های الزامی نوع ملک لازم است: {'، '.join(missing)}"})


def _attribute_review_snapshot(prop):
    values = []
    for item in prop.attribute_values.select_related("attribute").order_by("attribute__sort_order"):
        raw = item.value
        if isinstance(raw, Decimal):
            raw = str(raw)
        elif hasattr(raw, "isoformat"):
            raw = raw.isoformat()
        values.append({
            "id": item.attribute_id,
            "name": item.attribute.name,
            "display_name": item.attribute.display_name,
            "value": raw,
            "display_value": item.display_value,
        })
    return values


@transaction.atomic
def save_workspace(case, user, data):
    from . import can_manage_sales_range

    # `of=("self",)` locks only the case row. `resulting_property` is nullable, so the join is an
    # outer one, and PostgreSQL refuses `FOR UPDATE` on its nullable side; locking the joined rows is
    # not needed here anyway.
    case = models.PropertyRegistrationRequest.objects.select_for_update(of=("self",)).select_related(
        "resulting_property"
    ).get(pk=case.pk)
    ensure_case_version(case, data)
    allowed = (
        user_is_general_manager(user)
        or can_manage_sales_range(user, case.sales_range_id)
        or (
            case.assigned_to_id == user.pk
            and case.acceptance_status == models.AcceptanceStatus.ACCEPTED
        )
    )
    if not allowed:
        raise PermissionDenied("فقط مسئول پذیرفته‌شده یا مدیر رنج می‌تواند اطلاعات کارشناسی را ثبت کند.")
    if case.lead_status != models.LeadStatus.ACCEPTED:
        raise ValidationError({"lead_status": "ابتدا سرنخ پرونده باید توسط مدیر پذیرفته شود."})
    if case.status in (
        models.CaseStatus.CLOSED,
        models.CaseStatus.CANCELLED,
        models.CaseStatus.DUPLICATE,
    ):
        raise ValidationError({"status": "امکان ویرایش کارشناسی در پروندهٔ بسته وجود ندارد."})

    prop = case.resulting_property
    if prop is not None and prop.review_status == Property.ReviewStatus.PENDING:
        raise ValidationError({"property": "ملک در صف بررسی مدیر است و تا اعلام نظر قابل ویرایش نیست."})

    is_manager = user_is_general_manager(user) or can_manage_sales_range(user, case.sales_range_id)

    def clean_int(val, field, minimum=None, maximum=None):
        if val in (None, ""):
            return None
        if isinstance(val, bool):
            raise ValidationError({field: "مقدار عددی معتبر نیست."})
        try:
            num = int(val)
        except (TypeError, ValueError):
            raise ValidationError({field: "مقدار عددی معتبر نیست."})
        if minimum is not None and num < minimum:
            raise ValidationError({field: f"مقدار باید بزرگ‌تر یا مساوی {minimum} باشد."})
        if maximum is not None and num > maximum:
            raise ValidationError({field: f"مقدار باید کوچک‌تر یا مساوی {maximum} باشد."})
        return num

    if "district" in data:
        district_raw = data.get("district")
        district_id = clean_int(district_raw, "district", minimum=1) if district_raw not in (None, "") else None
    else:
        district_id = prop.district_id if prop else None
    district_obj = None
    if district_id is not None:
        district_obj = District.objects.select_related("city__province").filter(pk=district_id).first()
        if district_obj is None:
            raise ValidationError({"district": "محلهٔ انتخاب‌شده وجود ندارد."})
        if not district_obj.is_active or not district_obj.city_id or not district_obj.city.is_active or not district_obj.city.province.is_active:
            raise ValidationError({"district": "محله باید به شهر و استان فعال متصل باشد."})

    if "property_type_ref" in data:
        type_ref_raw = data.get("property_type_ref")
        property_type_ref_id = clean_int(type_ref_raw, "property_type_ref", minimum=1) if type_ref_raw not in (None, "") else None
    else:
        property_type_ref_id = prop.property_type_ref_id if prop else None
    property_type_ref = None
    if property_type_ref_id is not None:
        property_type_ref = PropertyType.objects.select_related("property_usage").filter(
            pk=property_type_ref_id, is_active=True
        ).first()
        if property_type_ref is None:
            raise ValidationError({"property_type_ref": "نوع ملک انتخاب‌شده فعال یا معتبر نیست."})

    if "property_usage" in data:
        usage_raw = data.get("property_usage")
        property_usage_id = clean_int(usage_raw, "property_usage", minimum=1) if usage_raw not in (None, "") else None
    else:
        property_usage_id = prop.property_usage_id if prop else None
    if property_type_ref is not None:
        if property_usage_id not in (None, property_type_ref.property_usage_id):
            raise ValidationError({"property_usage": "کاربری باید با نوع مرجع ملک انتخاب‌شده مطابقت داشته باشد."})
        property_usage_id = property_type_ref.property_usage_id
    if property_usage_id is not None and not PropertyUsage.objects.filter(pk=property_usage_id, is_active=True).exists():
        raise ValidationError({"property_usage": "کاربری انتخاب‌شده فعال یا معتبر نیست."})

    latitude_raw = data.get("latitude") if "latitude" in data else (prop.latitude if prop else None)
    longitude_raw = data.get("longitude") if "longitude" in data else (prop.longitude if prop else None)
    if (latitude_raw in (None, "")) != (longitude_raw in (None, "")):
        raise ValidationError({"coordinates": "عرض و طول جغرافیایی باید با هم ثبت یا با هم خالی شوند."})
    latitude = _coordinate_value(latitude_raw, "latitude", Decimal("-90"), Decimal("90"))
    longitude = _coordinate_value(longitude_raw, "longitude", Decimal("-180"), Decimal("180"))
    if latitude is not None and longitude is not None:
        duplicate_coords = Property.objects.filter(latitude=latitude, longitude=longitude)
        if prop is not None:
            duplicate_coords = duplicate_coords.exclude(pk=prop.pk)
        if duplicate_coords.exists():
            raise ValidationError({"latitude": "این مختصات برای ملک دیگری ثبت شده است."})

    property_type = str(data.get("property_type") or (prop.property_type if prop else Property.PropertyType.APARTMENT)).strip().upper()
    if property_type_ref is not None:
        from apps.properties.serializers import LEGACY_TYPE_BY_NAME
        property_type = LEGACY_TYPE_BY_NAME.get(property_type_ref.name.lower(), property_type)
    if property_type not in Property.PropertyType.values:
        raise ValidationError({"property_type": "نوع ملک معتبر نیست."})

    area = clean_int(data.get("area"), "area", minimum=0)
    dynamic_attributes_supplied = "attributes" in data
    # Keep compatibility with older workspace clients, but the current CRM
    # form stores these features in the type-specific dynamic attribute map.
    rooms = None if dynamic_attributes_supplied else clean_int(data.get("rooms"), "rooms", minimum=0, maximum=100)
    floor = None if dynamic_attributes_supplied else clean_int(data.get("floor"), "floor", minimum=-10, maximum=200)
    built_year = None if dynamic_attributes_supplied else clean_int(data.get("built_year"), "built_year", minimum=0, maximum=3000)

    address = str(data.get("address") if "address" in data else (prop.address if prop else "")).strip()
    neighborhood = str(data.get("neighborhood") if "neighborhood" in data else (prop.neighborhood if prop else "")).strip()
    prop_desc = str(data.get("description") if "description" in data else (prop.description if prop else case.description or "")).strip()

    if is_manager and str(data.get("property_title") or "").strip():
        case.property_title = str(data.get("property_title")).strip()

    resolved_title = case.property_title or str(data.get("title") or (prop.title if prop else case.code)).strip() or case.code

    if prop is None:
        prop = Property.objects.create(
            title=resolved_title,
            consultant=case.assigned_to or user,
            property_type=property_type,
            property_type_ref_id=property_type_ref_id,
            property_usage_id=property_usage_id,
            area=area if area is not None else 0,
            rooms=rooms if rooms is not None else 0,
            floor=floor,
            built_year=built_year,
            address=address,
            district_id=district_id,
            latitude=latitude,
            longitude=longitude,
            neighborhood=neighborhood,
            description=prop_desc,
            status=Property.Status.DRAFT,
            review_status=Property.ReviewStatus.NOT_SUBMITTED,
        )
        case.resulting_property = prop
    else:
        prop = Property.objects.select_for_update().get(pk=prop.pk)
        prop.consultant = case.assigned_to or prop.consultant or user
        prop.property_type = property_type
        prop.property_type_ref_id = property_type_ref_id
        prop.property_usage_id = property_usage_id
        if area is not None:
            prop.area = area
        if not dynamic_attributes_supplied:
            if rooms is not None:
                prop.rooms = rooms
            if "floor" in data:
                prop.floor = floor
            if "built_year" in data:
                prop.built_year = built_year
        if "address" in data:
            prop.address = address
        if "district" in data:
            prop.district_id = district_id
        if "latitude" in data or "longitude" in data:
            prop.latitude = latitude
            prop.longitude = longitude
        if "neighborhood" in data:
            prop.neighborhood = neighborhood
        if "description" in data:
            prop.description = prop_desc
        if is_manager and ("title" in data or "property_title" in data):
            prop.title = resolved_title
        elif not case.property_title and "title" in data and str(data.get("title") or "").strip():
            prop.title = str(data.get("title")).strip()
        if prop.review_status == Property.ReviewStatus.APPROVED:
            prop.review_status = Property.ReviewStatus.NOT_SUBMITTED
        prop.rejection_reason = ""
        prop.save()
        for active_file in PropertyFile.objects.select_for_update().filter(
            property=prop, status=PropertyFile.Status.ACTIVE
        ):
            active_file.status = PropertyFile.Status.PAUSED
            active_file.save(update_fields=["status", "updated_at"])

    if "attributes" in data:
        _sync_property_attributes(prop, property_type_ref, data.get("attributes"))
        _sync_legacy_property_feature_columns(prop)

    _sync_property_parties(prop, case, data, user)

    findings = data.get("findings")
    if findings is not None and not isinstance(findings, dict):
        raise ValidationError({"findings": "یافته‌های کارشناسی باید یک شیء ساخت‌یافته باشد."})

    appraisal, created = models.PropertyAppraisal.objects.get_or_create(registration_request=case)
    appraisal.property = prop
    if findings is not None:
        appraisal.findings = findings
    if "report_text" in data:
        appraisal.report_text = str(data.get("report_text") or "").strip()
    if "visit_notes" in data:
        appraisal.visit_notes = str(data.get("visit_notes") or "").strip()
    if "is_complete" in data:
        appraisal.is_complete = bool(data.get("is_complete"))
    appraisal.updated_by = user
    if not created:
        appraisal.version += 1
    appraisal.save()

    if case.status == models.CaseStatus.COMPLETED:
        case.status = models.CaseStatus.ACTIVE
    case.version += 1
    case.save(update_fields=["resulting_property", "property_title", "status", "version", "updated_at"])
    return case


@transaction.atomic
def submit_property_for_review(case, user, payload=None):
    from . import can_manage_sales_range, record_transition

    # Same rule as `save_workspace`: `resulting_property` and the reverse `appraisal` relation are
    # both nullable, so only the case row may be locked.
    case = models.PropertyRegistrationRequest.objects.select_for_update(of=("self",)).select_related(
        "resulting_property", "appraisal"
    ).get(pk=case.pk)
    ensure_case_version(case, payload)
    allowed = (
        user_is_general_manager(user)
        or can_manage_sales_range(user, case.sales_range_id)
        or (
            case.assigned_to_id == user.pk
            and case.acceptance_status == models.AcceptanceStatus.ACCEPTED
        )
    )
    if not allowed:
        raise PermissionDenied("فقط مسئول پذیرفته‌شده یا مدیر رنج می‌تواند ملک را برای بررسی بفرستد.")
    prop = case.resulting_property
    appraisal = getattr(case, "appraisal", None)
    errors = {}
    if prop is None:
        errors["property"] = "ابتدا اطلاعات ملک و کارشناسی را ذخیره کنید."
    else:
        if not str(prop.address or "").strip():
            errors["address"] = "ثبت نشانی ملک الزامی است."
        if not prop.district_id or (prop.district and prop.district.needs_location_review):
            errors["district"] = "انتخاب منطقهٔ معتبر الزامی است."
        if not prop.area or prop.area <= 0:
            errors["area"] = "متراژ ملک باید عددی مثبت باشد."
        if not prop.property_type and not prop.property_type_ref_id:
            errors["property_type"] = "انتخاب نوع ملک الزامی است."
        elif prop.property_type_ref_id:
            try:
                _validate_required_property_attributes(prop)
            except ValidationError as exc:
                errors.update(getattr(exc, "message_dict", {"attributes": exc.messages}))
    if appraisal is None or not appraisal.is_complete or not str(appraisal.report_text or "").strip():
        errors["appraisal"] = "گزارش کارشناسی کامل ثبت نشده است."
    if errors:
        raise ValidationError(errors)

    prop = Property.objects.select_for_update().get(pk=prop.pk)
    if prop.review_status == Property.ReviewStatus.PENDING:
        raise ValidationError({"property": "این ملک هم‌اکنون در صف بررسی قرار دارد."})

    prop.review_version += 1
    prop.submitted_review_version = prop.review_version
    prop.review_status = Property.ReviewStatus.PENDING
    prop.review_requested_at = timezone.now()
    prop.rejection_reason = ""
    prop.save(
        update_fields=[
            "review_version",
            "submitted_review_version",
            "review_status",
            "review_requested_at",
            "rejection_reason",
            "updated_at",
        ]
    )
    snapshot = {
        "title": prop.title,
        "property_title": case.property_title,
        "address": prop.address,
        "district_id": prop.district_id,
        "neighborhood": prop.neighborhood,
        "area": prop.area,
        "rooms": prop.rooms,
        "floor": prop.floor,
        "built_year": prop.built_year,
        "property_type": prop.property_type,
        "property_type_ref_id": prop.property_type_ref_id,
        "property_type_ref_name": prop.property_type_ref.name if prop.property_type_ref_id else None,
        "property_type_display": prop.property_type_ref.display_name if prop.property_type_ref_id else prop.get_property_type_display(),
        "property_usage_id": prop.property_usage_id,
        "property_usage_name": prop.property_usage.display_name if prop.property_usage_id else None,
        "review_version": prop.review_version,
        "submitted_review_version": prop.submitted_review_version,
        "province_id": prop.district.city.province_id if prop.district_id and prop.district.city_id else None,
        "province_name": prop.district.city.province.display_name if prop.district_id and prop.district.city_id else None,
        "city_id": prop.district.city_id if prop.district_id else None,
        "city_name": prop.district.city.display_name if prop.district_id and prop.district.city_id else None,
        "location_path": prop.district.full_path if prop.district_id else None,
        "latitude": str(prop.latitude) if prop.latitude is not None else None,
        "longitude": str(prop.longitude) if prop.longitude is not None else None,
        "attributes": _attribute_review_snapshot(prop),
        "images": [
            {
                "id": image.pk,
                "sort_order": image.sort_order,
                "url": image.image.url if image.image else "",
            }
            for image in prop.images.order_by("sort_order", "id")
        ],
    }
    review = models.PropertyReview.objects.create(
        property=prop,
        registration_request=case,
        submitted_by=user,
        version=prop.review_version,
        snapshot=snapshot,
        appraisal_snapshot={
            "findings": appraisal.findings,
            "report_text": appraisal.report_text,
            "visit_notes": appraisal.visit_notes,
            "version": appraisal.version,
        },
    )
    case.version += 1
    case.save(update_fields=["version", "updated_at"])
    record_transition("PROPERTY_CASE", case.pk, "appraisal", "review", user)
    managers = range_manager_recipients(case.sales_range)
    notify_workflow_event(
        managers,
        title="ملک در انتظار بررسی",
        message=f"ملک پرونده {case.code} برای بررسی و تأیید مدیر ارسال شد.",
        metadata={
            "subject_type": "PROPERTY_CASE",
            "subject_id": case.pk,
            "propertyId": prop.pk,
            "reviewId": review.pk,
            "code": case.code,
        },
        event_key_prefix=f"property-review-submit:{review.pk}",
        notification_type=Notification.NotificationType.PROPERTY_PENDING_REVIEW,
    )
    return review


@transaction.atomic
def review_property(case, user, data):
    from . import can_manage_sales_range, record_transition

    if not (user_is_general_manager(user) or can_manage_sales_range(user, case.sales_range_id)):
        raise PermissionDenied("شما اجازه بررسی و تأیید این ملک را ندارید.")
    if "case_version" in data and data.get("case_version") is not None:
        ensure_case_version(case, {"version": data.get("case_version")})
    prop = case.resulting_property
    if prop is None or prop.review_status != Property.ReviewStatus.PENDING:
        raise ValidationError({"property": "ملکی در انتظار بررسی نیست."})
    prop = Property.objects.select_for_update().get(pk=prop.pk)
    review = (
        prop.reviews.select_for_update()
        .filter(
            version=prop.submitted_review_version,
            decision=models.PropertyReview.Decision.PENDING,
        )
        .order_by("-submitted_at")
        .first()
    )
    if review is None:
        raise ValidationError({"version": "رکورد بررسی فعال یافت نشد."})
    raw_version = data.get("version")
    if raw_version is not None:
        try:
            submitted_version = int(raw_version)
        except (TypeError, ValueError):
            raise ValidationError({"version": "نسخه ارسالی معتبر نیست."})
        if submitted_version != prop.submitted_review_version:
            raise CaseVersionConflict(CASE_CONFLICT_DETAIL)

    decision = str(data.get("decision") or "").strip().upper()
    reason = str(data.get("reason") or "").strip()

    if decision == models.PropertyReview.Decision.APPROVED:
        title = str(data.get("property_title") or case.property_title or "").strip()
        if not title:
            raise ValidationError({"property_title": "برای تأیید ملک، ثبت عنوان مدیریتی ملک الزامی است."})
        case.property_title = title
        prop.title = title
        prop.review_status = Property.ReviewStatus.APPROVED
        if prop.status == Property.Status.DRAFT:
            prop.status = Property.Status.AVAILABLE
        prop.rejection_reason = ""
        case.status = models.CaseStatus.COMPLETED
        notif_type = Notification.NotificationType.PROPERTY_APPROVED
        notif_title = "تأیید ملک"
        notif_msg = f"ملک «{title}» در پرونده {case.code} تأیید شد و آماده ثبت فایل عرضه است."
        target_stage = "listing"
    elif decision == models.PropertyReview.Decision.CHANGES_REQUIRED:
        if not reason:
            raise ValidationError({"reason": "ثبت دلیل برگشت برای اصلاح الزامی است."})
        prop.review_status = Property.ReviewStatus.CHANGES_REQUIRED
        prop.rejection_reason = reason
        notif_type = Notification.NotificationType.PROPERTY_REJECTED
        notif_title = "نیازمند اصلاح کارشناسی"
        notif_msg = f"ملک پرونده {case.code} برای اصلاح بازگردانده شد: {reason}"
        target_stage = "appraisal"
    else:
        raise ValidationError({"decision": "تصمیم بررسی نامعتبر است."})

    prop.review_requested_at = None
    prop.save(
        update_fields=[
            "title",
            "status",
            "review_status",
            "rejection_reason",
            "review_requested_at",
            "updated_at",
        ]
    )
    review.decision = decision
    review.reason = reason
    review.reviewed_by = user
    review.reviewed_at = timezone.now()
    review.save(update_fields=["decision", "reason", "reviewed_by", "reviewed_at"])

    case.version += 1
    case.save(update_fields=["property_title", "status", "version", "updated_at"])
    record_transition("PROPERTY_CASE", case.pk, "review", target_stage, user, reason)

    recipient = case.assigned_to or review.submitted_by or prop.consultant
    if recipient:
        notify_workflow_event(
            [recipient],
            title=notif_title,
            message=notif_msg,
            metadata={
                "subject_type": "PROPERTY_CASE",
                "subject_id": case.pk,
                "propertyId": prop.pk,
                "reviewId": review.pk,
                "decision": decision,
            },
            event_key_prefix=f"property-review-decision:{review.pk}:{decision}",
            notification_type=notif_type,
        )
    return review


@transaction.atomic
def reopen_appraisal(case, user, reason, payload=None):
    from . import can_manage_sales_range, make_task, record_transition

    ensure_case_version(case, payload)
    allowed = (
        user_is_general_manager(user)
        or can_manage_sales_range(user, case.sales_range_id)
        or (
            case.assigned_to_id == user.pk
            and case.acceptance_status == models.AcceptanceStatus.ACCEPTED
        )
    )
    if not allowed:
        raise PermissionDenied("شما اجازه بازگشایی کارشناسی این پرونده را ندارید.")
    clean_reason = str(reason or "").strip()
    if not clean_reason:
        raise ValidationError({"reason": "دلیل کارشناسی مجدد الزامی است."})
    if not case.resulting_property_id:
        raise ValidationError({"status": "پرونده فاقد ملک ثبت‌شده برای کارشناسی مجدد است."})
    if case_has_locked_contract(case, finalized_only=True):
        raise ValidationError({"status": "پرونده دارای قرارداد قطعی است و امکان کارشناسی مجدد ندارد."})

    prop = Property.objects.select_for_update().get(pk=case.resulting_property_id)
    if case.status != models.CaseStatus.COMPLETED and prop.review_status != Property.ReviewStatus.APPROVED:
        raise ValidationError({"status": "فقط ملک تأییدشده قابل بازگشت به کارشناسی مجدد است."})

    appraisal = getattr(case, "appraisal", None)
    if appraisal is not None:
        history_list = list(appraisal.archived_reports or [])
        history_list.append(
            {
                "version": appraisal.version,
                "report_text": appraisal.report_text,
                "visit_notes": appraisal.visit_notes,
                "findings": appraisal.findings,
                "archived_at": timezone.now().isoformat(),
                "archived_by_id": user.pk,
                "reason": clean_reason,
            }
        )
        appraisal.archived_reports = history_list
        appraisal.is_complete = False
        appraisal.version += 1
        appraisal.updated_by = user
        appraisal.save(
            update_fields=["archived_reports", "is_complete", "version", "updated_by", "updated_at"]
        )

    prop.review_status = Property.ReviewStatus.NOT_SUBMITTED
    prop.save(update_fields=["review_status", "updated_at"])

    for active_file in PropertyFile.objects.select_for_update().filter(
        property=prop, status=PropertyFile.Status.ACTIVE
    ):
        active_file.status = PropertyFile.Status.PAUSED
        active_file.save(update_fields=["status", "updated_at"])

    case.status = models.CaseStatus.ACTIVE
    case.version += 1
    case.save(update_fields=["status", "version", "updated_at"])
    record_transition("PROPERTY_CASE", case.pk, "listing", "appraisal", user, clean_reason)
    if case.assigned_to:
        make_task(
            f"کارشناسی مجدد {case.code}",
            case.assigned_to,
            user,
            case.due_at or (timezone.now() + timedelta(days=7)),
            prop,
            Task.TaskType.SITE_VISIT,
            clean_reason,
        )
    return case


@transaction.atomic
def mark_duplicate(subject, user, duplicate_of, reason, payload=None):
    return change_case_status(
        subject,
        user,
        models.CaseStatus.DUPLICATE,
        reason=reason,
        duplicate_of=duplicate_of,
        payload=payload,
    )


@transaction.atomic
def change_case_status(subject, user, status_value, reason="", duplicate_of=None, due_at=None, payload=None):
    from . import can_manage_sales_range, can_view_case, record_transition, subject_kind

    ensure_case_version(subject, payload)
    if not (user_is_general_manager(user) or can_manage_sales_range(user, subject.sales_range_id)):
        raise PermissionDenied("شما اجازه تغییر وضعیت این پرونده را ندارید.")

    normalized = str(status_value or "").strip().upper()
    is_reopen = normalized in ("REOPEN", models.CaseStatus.ACTIVE)

    if isinstance(subject, models.PropertyRegistrationRequest):
        if case_has_locked_contract(subject, finalized_only=False) and normalized != models.CaseStatus.COMPLETED:
            raise ValidationError(
                {"status": "در صورت وجود قرارداد امضاشده یا نهایی، تغییر وضعیت پرونده مجاز نیست."}
            )

    clean_reason = str(reason or "").strip()

    if is_reopen:
        old = subject.status
        snap = getattr(subject, "status_snapshot", None) or {}
        restored_status = snap.get("status")
        if restored_status not in (models.CaseStatus.ACTIVE, models.CaseStatus.COMPLETED):
            prop = getattr(subject, "resulting_property", None)
            restored_status = (
                models.CaseStatus.COMPLETED
                if prop is not None and prop.review_status == Property.ReviewStatus.APPROVED
                else models.CaseStatus.ACTIVE
            )
        subject.status = restored_status
        subject.closure_reason = ""
        subject.duplicate_of = None
        if due_at not in (None, ""):
            parsed_due = parse_dt(due_at, "due_at", required=False)
            if parsed_due is not None:
                subject.due_at = parsed_due
        if hasattr(subject, "status_snapshot"):
            subject.status_snapshot = {}
        subject.version += 1
        update_fields = ["status", "closure_reason", "duplicate_of", "due_at", "version", "updated_at"]
        if hasattr(subject, "status_snapshot"):
            update_fields.append("status_snapshot")
        subject.save(update_fields=update_fields)
        record_transition(subject_kind(subject), subject.pk, old, subject.status, user, clean_reason or "بازگشایی پرونده")
        return subject

    if normalized not in models.CaseStatus.values:
        raise ValidationError({"status": "وضعیت انتخاب‌شده معتبر نیست."})

    if normalized in (
        models.CaseStatus.CLOSED,
        models.CaseStatus.CANCELLED,
        models.CaseStatus.DUPLICATE,
    ) and not clean_reason:
        raise ValidationError({"closure_reason": "ثبت دلیل برای تغییر وضعیت الزامی است."})

    if normalized == models.CaseStatus.DUPLICATE:
        if duplicate_of is None:
            raise ValidationError({"duplicate_of": "انتخاب پرونده اصلی برای ثبت تکراری الزامی است."})
        if type(duplicate_of) is not type(subject) or duplicate_of.pk == subject.pk:
            raise ValidationError({"duplicate_of": "پرونده اصلی باید از همان نوع و متمایز از پرونده فعلی باشد."})
        if duplicate_of.sales_range_id != subject.sales_range_id:
            raise PermissionDenied("پرونده اصلی باید در همان رنج باشد.")
        if not can_view_case(user, duplicate_of):
            raise PermissionDenied("شما به پرونده اصلی دسترسی ندارید.")

    old = subject.status
    paused_listing_ids = []
    if (
        isinstance(subject, models.PropertyRegistrationRequest)
        and normalized in (models.CaseStatus.CLOSED, models.CaseStatus.CANCELLED, models.CaseStatus.DUPLICATE)
    ):
        if subject.resulting_property_id:
            for pf in PropertyFile.objects.select_for_update().filter(
                property_id=subject.resulting_property_id,
                status=PropertyFile.Status.ACTIVE,
            ):
                pf.status = PropertyFile.Status.PAUSED
                pf.save(update_fields=["status", "updated_at"])
                paused_listing_ids.append(pf.pk)
        subject.reschedule_requests.filter(
            status=models.AssignmentRescheduleRequest.Status.PENDING
        ).update(status=models.AssignmentRescheduleRequest.Status.CANCELLED)
        subject.withdrawal_requests.filter(
            status=models.ConsultantWithdrawalRequest.Status.PENDING
        ).update(status=models.ConsultantWithdrawalRequest.Status.CANCELLED)
        Task.objects.filter(
            property_case=subject,
            status=Task.Status.PENDING,
        ).update(status=Task.Status.CANCELLED)
        subject.status_snapshot = {
            "status": old if old in (models.CaseStatus.ACTIVE, models.CaseStatus.COMPLETED) else models.CaseStatus.ACTIVE,
            "paused_listing_ids": paused_listing_ids,
        }

    subject.status = normalized
    subject.closure_reason = clean_reason
    subject.duplicate_of = duplicate_of if normalized == models.CaseStatus.DUPLICATE else None
    subject.version += 1
    update_fields = ["status", "closure_reason", "duplicate_of", "version", "updated_at"]
    if hasattr(subject, "status_snapshot"):
        update_fields.append("status_snapshot")
    subject.save(update_fields=update_fields)
    record_transition(subject_kind(subject), subject.pk, old, normalized, user, clean_reason)
    return subject


def _decimal_or_none(raw, field):
    if raw in (None, ""):
        return None
    if isinstance(raw, bool):
        raise ValidationError({field: "مبلغ واردشده معتبر نیست."})
    try:
        value = Decimal(str(raw))
    except Exception:
        raise ValidationError({field: "مبلغ واردشده معتبر نیست."})
    if not value.is_finite() or value < 0 or value != value.to_integral_value() or value >= Decimal("1e18"):
        raise ValidationError({field: "مبلغ باید عدد صحیح نامنفی به تومان باشد."})
    return value


@transaction.atomic
def save_listing(user, data, property_obj=None, listing_instance=None):
    from . import can_manage_sales_range

    require_permission(user, "property_file.create")
    if listing_instance is not None:
        listing_instance = PropertyFile.objects.select_for_update(of=("self",)).select_related("property", "deal_type").get(pk=listing_instance.pk)
        if data.get("version") is not None:
            try:
                expected_ver = int(data.get("version"))
            except (TypeError, ValueError):
                raise ValidationError({"version": "نسخه فایل عرضه معتبر نیست."})
            if expected_ver != listing_instance.version:
                raise CaseVersionConflict(CASE_CONFLICT_DETAIL)
        prop = Property.objects.select_for_update().get(pk=listing_instance.property_id)
    else:
        prop_id = property_obj.pk if property_obj is not None else data.get("property")
        if not prop_id:
            raise ValidationError({"property": "ملک هدف مشخص نشده است."})
        prop = get_object_or_404(Property.objects.select_for_update(), pk=prop_id)

    if prop.review_status != Property.ReviewStatus.APPROVED:
        raise ValidationError({"property": "فایل عرضه فقط برای ملک تأییدشده ساخته یا ویرایش می‌شود."})
    if prop.status in (Property.Status.SOLD, Property.Status.INACTIVE, Property.Status.DRAFT):
        raise ValidationError({"property": "وضعیت ملک اجازهٔ ثبت یا فعال‌سازی فایل عرضه را نمی‌دهد."})

    case = getattr(prop, "registration_case", None)
    if case is not None and case.status in (
        models.CaseStatus.CLOSED,
        models.CaseStatus.CANCELLED,
        models.CaseStatus.DUPLICATE,
    ):
        raise ValidationError({"property": "پروندهٔ این ملک بسته است و امکان ثبت فایل عرضه وجود ندارد."})

    responsible_user = (
        case.assigned_to
        if case is not None and case.acceptance_status == models.AcceptanceStatus.ACCEPTED and case.assigned_to_id
        else prop.consultant
    )
    if responsible_user is None or not responsible_user.is_active:
        raise ValidationError({"assigned_to": "ملک فاقد مسئول فعال برای عرضه است."})

    allowed = (
        user_is_general_manager(user)
        or responsible_user.pk == user.pk
        or (case is not None and can_manage_sales_range(user, case.sales_range_id))
    )
    if not allowed:
        raise PermissionDenied("فقط مسئول ملک یا مدیر رنج اجازهٔ ثبت و ویرایش فایل عرضه را دارد.")

    raw_dt = data.get("deal_type")
    if raw_dt in (None, ""):
        if listing_instance is not None:
            deal_type = listing_instance.deal_type
        else:
            raise ValidationError({"deal_type": "انتخاب نوع معامله الزامی است."})
    else:
        try:
            deal_type_id = int(raw_dt)
        except (TypeError, ValueError):
            raise ValidationError({"deal_type": "نوع معامله انتخاب‌شده معتبر نیست."})
        deal_type = get_object_or_404(DealType, pk=deal_type_id)

    if not deal_type.is_active:
        raise ValidationError({"deal_type": "نوع معامله انتخاب‌شده غیرفعال است."})

    version = (
        DealTypeVersion.objects.filter(
            deal_type=deal_type, status=DealTypeVersion.Status.PUBLISHED
        )
        .order_by("-version_number")
        .first()
    )
    if version is None:
        raise ValidationError({"deal_type": "نوع معامله فاقد نسخهٔ منتشرشده است."})

    sale_price = _decimal_or_none(data.get("sale_price"), "sale_price")
    deposit = _decimal_or_none(data.get("deposit"), "deposit")
    monthly_rent = _decimal_or_none(data.get("monthly_rent"), "monthly_rent")
    price_details = data.get("price_details")
    if price_details in (None, ""):
        price_details = {}
    if not isinstance(price_details, dict):
        raise ValidationError({"price_details": "جزئیات قیمت باید یک شیء JSON باشد."})

    raw_terms = data.get("terms")
    if raw_terms is not None and not isinstance(raw_terms, dict):
        raise ValidationError({"terms": "شرایط معامله باید یک شیء ساخت‌یافته باشد."})

    merged_terms = dict(raw_terms or {})
    if sale_price is not None and "sale_price" not in merged_terms:
        merged_terms["sale_price"] = int(sale_price)
    if deposit is not None and "deposit" not in merged_terms:
        merged_terms["deposit"] = int(deposit)
    if monthly_rent is not None and "monthly_rent" not in merged_terms:
        merged_terms["monthly_rent"] = int(monthly_rent)
    for key, val in price_details.items():
        if key not in merged_terms and val not in (None, ""):
            merged_terms[key] = val

    target_status = str(data.get("status") or PropertyFile.Status.ACTIVE).strip().upper()
    if target_status not in (
        PropertyFile.Status.DRAFT,
        PropertyFile.Status.ACTIVE,
        PropertyFile.Status.PAUSED,
    ):
        raise ValidationError({"status": "وضعیت فایل عرضه باید یکی از پیش‌نویس، فعال یا متوقف باشد."})

    if version.terms_schema:
        schema_fields = (version.terms_schema or {}).get("fields") or []
        allowed_keys = {f.get("key") for f in schema_fields if isinstance(f, dict) and f.get("key")}
        filtered_terms = {k: v for k, v in merged_terms.items() if not allowed_keys or k in allowed_keys or k in (raw_terms or {})}
        if target_status == PropertyFile.Status.ACTIVE or filtered_terms:
            validate_terms(version.terms_schema, filtered_terms)
        merged_terms = filtered_terms

    if sale_price is None and "sale_price" in merged_terms and merged_terms["sale_price"] not in (None, ""):
        sale_price = _decimal_or_none(merged_terms["sale_price"], "sale_price")
    if deposit is None and "deposit" in merged_terms and merged_terms["deposit"] not in (None, ""):
        deposit = _decimal_or_none(merged_terms["deposit"], "deposit")
    if monthly_rent is None and "monthly_rent" in merged_terms and merged_terms["monthly_rent"] not in (None, ""):
        monthly_rent = _decimal_or_none(merged_terms["monthly_rent"], "monthly_rent")

    existing = listing_instance or (
        PropertyFile.objects.select_for_update()
        .filter(property=prop, deal_type=deal_type)
        .exclude(status=PropertyFile.Status.ARCHIVED)
        .first()
    )

    if (
        existing is not None
        and existing.deal_type_id != deal_type.pk
        and PropertyFile.objects.filter(property=prop, deal_type=deal_type)
        .exclude(status=PropertyFile.Status.ARCHIVED)
        .exclude(pk=existing.pk)
        .exists()
    ):
        raise ValidationError({"deal_type": "برای این ملک با این نوع معامله فایل عرضه فعال دیگری ثبت شده است."})

    default_title = f"{prop.title} — {deal_type.display_name}"
    title = str(data.get("title") or (existing.title if existing and existing.deal_type_id == deal_type.pk else default_title)).strip()[:255]
    description = str(data.get("description") if "description" in data else (existing.description if existing else prop.description or "")).strip()
    publish_channel = str(data.get("publish_channel") or (existing.publish_channel if existing else PropertyFile.PublishChannel.WEBSITE)).strip().upper()
    if publish_channel not in PropertyFile.PublishChannel.values:
        publish_channel = PropertyFile.PublishChannel.WEBSITE

    price_changed = (
        existing is None
        or existing.deal_type_id != deal_type.pk
        or existing.sale_price != sale_price
        or existing.deposit != deposit
        or existing.monthly_rent != monthly_rent
        or (existing.terms or {}) != merged_terms
        or (existing.price_details or {}) != price_details
    )

    if existing is None:
        listing = PropertyFile.objects.create(
            property=prop,
            deal_type=deal_type,
            deal_type_version=version,
            title=title,
            description=description,
            publish_channel=publish_channel,
            created_by=user,
            assigned_to=responsible_user,
            status=target_status,
            sale_price=sale_price,
            deposit=deposit,
            monthly_rent=monthly_rent,
            terms=merged_terms,
            price_details=price_details,
        )
    else:
        listing = existing
        listing.deal_type = deal_type
        listing.deal_type_version = version
        listing.title = title
        listing.description = description
        listing.publish_channel = publish_channel
        listing.assigned_to = responsible_user
        listing.status = target_status
        listing.sale_price = sale_price
        listing.deposit = deposit
        listing.monthly_rent = monthly_rent
        listing.terms = merged_terms
        listing.price_details = price_details
        listing.save()

    if price_changed:
        PropertyFilePriceHistory.objects.create(
            property_file=listing,
            changed_by=user,
            sale_price=listing.sale_price,
            deposit=listing.deposit,
            monthly_rent=listing.monthly_rent,
            price_details={**(listing.price_details or {}), "terms": listing.terms or {}},
        )

    return listing


def explore_listings_queryset(params):
    qs = (
        PropertyFile.objects.filter(
            status=PropertyFile.Status.ACTIVE,
            property__review_status=Property.ReviewStatus.APPROVED,
            property__status__in=(Property.Status.AVAILABLE, Property.Status.RESERVED),
            deal_type__is_active=True,
        )
        .filter(
            Q(assigned_to__is_active=True)
            | Q(assigned_to__isnull=True, property__consultant__is_active=True)
        )
        .select_related(
            "deal_type",
            "deal_type_version",
            "property",
            "property__property_type_ref",
            "property__property_usage",
            "property__district",
            "property__district__city",
            "property__district__city__province",
            "assigned_to",
            "property__consultant",
        )
        .prefetch_related("property__images")
    )

    search = str(params.get("q") or params.get("search") or "").strip()
    if search:
        qs = qs.filter(
            Q(title__icontains=search)
            | Q(description__icontains=search)
            | Q(property__title__icontains=search)
            | Q(property__neighborhood__icontains=search)
            | Q(property__district__display_name__icontains=search)
            | Q(property__district__city__display_name__icontains=search)
            | Q(deal_type__display_name__icontains=search)
        )

    deal_type = str(params.get("deal_type") or params.get("dealType") or "").strip()
    if deal_type:
        if deal_type.isdigit():
            qs = qs.filter(deal_type_id=int(deal_type))
        else:
            qs = qs.filter(
                Q(deal_type__name__iexact=deal_type)
                | Q(deal_type__display_name__iexact=deal_type)
                | Q(deal_type__family__iexact=deal_type)
            )

    district = str(params.get("district") or "").strip()
    if district:
        if district.isdigit():
            qs = qs.filter(property__district_id=int(district))
        else:
            qs = qs.filter(
                Q(property__district__display_name__icontains=district)
                | Q(property__district__name__icontains=district)
                | Q(property__neighborhood__icontains=district)
            )

    city = str(params.get("city") or "").strip()
    if city:
        if city.isdigit():
            qs = qs.filter(property__district__city_id=int(city))
        else:
            qs = qs.filter(
                Q(property__district__city__display_name__icontains=city)
                | Q(property__district__city__name__icontains=city)
            )

    prop_type = str(params.get("property_type") or params.get("propertyTypeRef") or "").strip()
    if prop_type:
        if prop_type.isdigit():
            qs = qs.filter(property__property_type_ref_id=int(prop_type))
        else:
            qs = qs.filter(
                Q(property__property_type__iexact=prop_type)
                | Q(property__property_type_ref__name__iexact=prop_type)
                | Q(property__property_type_ref__display_name__icontains=prop_type)
            )

    for raw_key, op in (("area_min", "gte"), ("areaMin", "gte"), ("area_max", "lte"), ("areaMax", "lte")):
        raw = str(params.get(raw_key) or "").strip()
        if raw:
            try:
                val = int(raw)
            except (TypeError, ValueError):
                raise ValidationError({raw_key: "متراژ باید عدد صحیح باشد."})
            if val < 0:
                raise ValidationError({raw_key: "متراژ نمی‌تواند منفی باشد."})
            qs = qs.filter(**{f"property__area__{op}": val})

    for raw_key, field, op in (
        ("price_min", "sale_price", "gte"),
        ("saleMin", "sale_price", "gte"),
        ("price_max", "sale_price", "lte"),
        ("saleMax", "sale_price", "lte"),
        ("deposit_min", "deposit", "gte"),
        ("depositMin", "deposit", "gte"),
        ("deposit_max", "deposit", "lte"),
        ("depositMax", "deposit", "lte"),
        ("rent_min", "monthly_rent", "gte"),
        ("rentMin", "monthly_rent", "gte"),
        ("rent_max", "monthly_rent", "lte"),
        ("rentMax", "monthly_rent", "lte"),
    ):
        raw = str(params.get(raw_key) or "").strip()
        if raw:
            val = _decimal_or_none(raw, raw_key)
            qs = qs.filter(**{f"{field}__{op}": val})

    return qs.order_by("-created_at", "-id")
