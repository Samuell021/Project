from datetime import datetime, time, timedelta
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db.models import Count, Q, Sum
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from apps.accounts.permissions import has_permission, user_is_general_manager
from apps.followups.models import FollowUp
from apps.listings.models import PropertyFile
from apps.properties.models import Property
from apps.tasks.models import Task

from .. import models
from . import timeline as history_service
from .stages import pipeline_stage
from .access import (
    scoped_case_queryset,
    scoped_commission_queryset,
    scoped_contract_queryset,
    scoped_deal_queryset,
    scoped_payment_queryset,
    scoped_property_file_queryset,
    scoped_task_queryset,
    user_has_company_finance,
)

FINANCE_RECIPIENT_ROLE = "FINANCE"

STAGE_LABELS = {
    "NEW": "سرنخ جدید",
    "ACCEPTED": "پذیرفته‌شده",
    "ASSIGNED": "ارجاع‌شده",
    "IN_PROGRESS": "در جریان",
    "NEEDS": "تکمیل نیاز",
    "INTRODUCTION": "معرفی",
    "VIEWING": "بازدید",
    "NEGOTIATION": "مذاکره",
    "AGREED": "توافق‌شده",
    "CONTRACT": "قرارداد",
    "FINALIZED": "قطعی",
    "LOST": "ناموفق",
    "COMPLETED": "تکمیل‌شده",
    "CLOSED": "بسته",
    "CANCELLED": "لغوشده",
    "DUPLICATE": "تکراری",
    "DRAFT": "پیش‌نویس",
    "ACTIVE": "فعال",
    "PAUSED": "متوقف",
    "SOLD": "فروخته‌شده",
    "EXPIRED": "منقضی",
    "ARCHIVED": "بایگانی",
    "SIGNING": "در حال امضا",
    "PENDING": "در انتظار انجام",
    "DEAL_LINKED": "متصل به مذاکره",
    "LEAD": "سرنخ",
    "ASSIGNMENT": "در صف ارجاع",
    "ACCEPTANCE": "انتظار پذیرش مسئول",
}

PIPELINE_LABELS = {
    "leads": "سرنخ و ارجاع",
    "listings": "فایل عرضه",
    "inquiries": "درخواست متقاضی",
    "deals": "مذاکره",
    "contracts": "قرارداد",
    "tasks": "وظایف",
}

CASE_TERMINAL = (
    models.CaseStatus.COMPLETED,
    models.CaseStatus.CLOSED,
    models.CaseStatus.CANCELLED,
    models.CaseStatus.DUPLICATE,
)


def _range_bounds(start, end):
    start_dt = timezone.make_aware(datetime.combine(start, time.min))
    end_dt = timezone.make_aware(datetime.combine(end, time.max))
    return start_dt, end_dt


def parse_range(params, *, required=True, default_days=30):
    raw_from = (params.get("from") or params.get("date_from") or "").strip()
    raw_to = (params.get("to") or params.get("date_to") or "").strip()
    if not raw_from and not raw_to and not required:
        today = timezone.localdate()
        raw_from = raw_to = today.isoformat()
    if not raw_from or not raw_to:
        raise ValidationError({"range": "بازه زمانی با تاریخ شروع و پایان الزامی است."})
    start = parse_date(raw_from) or (parse_datetime(raw_from).date() if parse_datetime(raw_from) else None)
    end = parse_date(raw_to) or (parse_datetime(raw_to).date() if parse_datetime(raw_to) else None)
    if start is None or end is None:
        raise ValidationError({"range": "تاریخ شروع یا پایان معتبر نیست."})
    if start > end:
        raise ValidationError({"range": "تاریخ شروع نمی‌تواند بعد از تاریخ پایان باشد."})
    if (end - start).days > 366:
        raise ValidationError({"range": "بازه گزارش حداکثر یک سال است."})
    return start, end


def _metric(key, label, value, *, hint="", severity="normal", page=None):
    return {
        "key": key,
        "label": label,
        "value": value,
        "hint": hint,
        "severity": severity,
        "page": page,
    }


def _managed_ranges(user):
    from . import managed_sales_range_ids

    return managed_sales_range_ids(user) or set()


def _team_user_ids(user):
    from . import scope_team_ids

    return scope_team_ids(user)


def _user_ids_for_ranges(range_ids):
    from apps.accounts.models import User

    if not range_ids:
        return []
    from apps.accounts.scope_memberships import active_memberships

    return list(
        active_memberships()
        .filter(sales_range_id__in=range_ids)
        .values_list("user_id", flat=True)
        .distinct()
    )


def dashboard_summary(user, params):
    start, end = parse_range(params)
    start_dt, end_dt = _range_bounds(start, end)
    now = timezone.now()
    cases = scoped_case_queryset(user, models.PropertyRegistrationRequest.objects.all())
    inquiries = scoped_case_queryset(user, models.Inquiry.objects.all())
    listings = scoped_property_file_queryset(user)
    deals = scoped_deal_queryset(user)
    contracts = scoped_contract_queryset(user)
    tasks = scoped_task_queryset(user)
    finance_visible = user_has_company_finance(user) or has_permission(user, "finance.view")
    is_manager = user_is_general_manager(user) or bool(_managed_ranges(user))
    is_consultant = not user_is_general_manager(user) and not _managed_ranges(user) and getattr(user, "role", "") not in (
        "FINANCE",
        "RANGE_MANAGER",
    )
    role = (
        "admin"
        if user_is_general_manager(user)
        else "range_manager"
        if _managed_ranges(user)
        else "finance"
        if getattr(user, "role", "") == "FINANCE"
        else "consultant"
    )
    pending_reviews = Property.objects.filter(review_status=Property.ReviewStatus.PENDING)
    if not (user_is_general_manager(user) or has_permission(user, "property.review_decide")):
        pending_reviews = pending_reviews.none()
    elif not user_is_general_manager(user):
        ranges = _managed_ranges(user)
        pending_reviews = pending_reviews.filter(
            Q(registration_case__sales_range_id__in=ranges) | Q(registration_case__isnull=True)
        )
    overdue_tasks = tasks.filter(
        status__in=(Task.Status.PENDING, Task.Status.IN_PROGRESS),
        due_date__lt=now.date(),
    )
    metrics = []
    metrics.append(_metric("active_listings", "فایل‌های فعال", listings.filter(status=PropertyFile.Status.ACTIVE, property__review_status=Property.ReviewStatus.APPROVED).count(), page="property-files"))
    metrics.append(_metric("new_leads", "سرنخ‌های جدید بازه", cases.filter(created_at__range=(start_dt, end_dt), lead_status=models.LeadStatus.PENDING).count() + inquiries.filter(created_at__range=(start_dt, end_dt), lead_status=models.LeadStatus.PENDING).count(), page="crm-inbox"))
    metrics.append(_metric("open_inquiries", "درخواست‌های باز", inquiries.filter(status=models.CaseStatus.ACTIVE).count(), page="crm-inquiries"))
    metrics.append(_metric("today_activity", "فعالیت روز", history_service.activity_count(user, now.date()), page="activity"))
    metrics.append(_metric("overdue_followups", "پیگیری‌های عقب‌افتاده", overdue_tasks.count(), severity="warning" if overdue_tasks.exists() else "normal", page="my-tasks"))
    metrics.append(_metric("pending_reviews", "فایل‌های منتظر تأیید", pending_reviews.count(), severity="warning" if pending_reviews.exists() else "normal", page="crm-reviews"))
    metrics.append(_metric("open_deals", "مذاکرات فعال", deals.filter(stage__in=(models.Deal.Stage.NEGOTIATION, models.Deal.Stage.AGREED)).count(), page="crm-deals"))
    metrics.append(_metric("new_contracts", "قراردادهای جدید بازه", contracts.filter(created_at__range=(start_dt, end_dt)).count(), page="crm-contracts"))
    metrics.append(_metric("unassigned_leads", "سرنخ‌های بدون مسئول", cases.filter(acceptance_status=models.AcceptanceStatus.UNASSIGNED).count() + inquiries.filter(acceptance_status=models.AcceptanceStatus.UNASSIGNED).count(), severity="warning", page="crm-pipelines"))
    response = {
        "role": role,
        "range": {"from": start.isoformat(), "to": end.isoformat()},
        "metrics": metrics,
        "finance": {},
        "team": [],
    }
    if is_manager:
        response["team"] = _team_status(user, start_dt, end_dt)
    if finance_visible:
        commissions = scoped_commission_queryset(user)
        payments = scoped_payment_queryset(user)
        claimed = commissions.exclude(status=models.Commission.Status.PENDING).aggregate(total=Sum("final_amount"))["total"] or Decimal("0")
        received = models.PaymentAllocation.objects.filter(
            payment__in=payments,
            payment__status__in=(
                models.Payment.Status.CONFIRMED,
                models.Payment.Status.REVERSED,
            ),
            payment__direction=models.Payment.Direction.IN,
        ).aggregate(total=Sum("amount"))["total"] or Decimal("0")
        shares_paid = models.PaymentAllocation.objects.filter(
            payment__in=payments,
            payment__status__in=(
                models.Payment.Status.CONFIRMED,
                models.Payment.Status.REVERSED,
            ),
            payment__direction=models.Payment.Direction.OUT,
        ).aggregate(total=Sum("amount"))["total"] or Decimal("0")
        response["finance"] = {
            "claimed": str(claimed),
            "received": str(received),
            "shares_paid": str(shares_paid),
            "outstanding": str(Decimal(claimed) - Decimal(received)),
        }
        if role in ("finance", "admin", "range_manager"):
            response["contract_queue"] = _contract_queue(user)
    response["counters"] = {
        "property_cases": cases.filter(is_legacy=False).count(),
        "pending_leads": cases.filter(lead_status=models.LeadStatus.PENDING).count() + inquiries.filter(lead_status=models.LeadStatus.PENDING).count(),
        "pending_assignments": cases.filter(acceptance_status=models.AcceptanceStatus.PENDING, assigned_to=user).count() + inquiries.filter(acceptance_status=models.AcceptanceStatus.PENDING, assigned_to=user).count(),
        "pending_reviews": pending_reviews.count(),
        "active_listings": metrics[0]["value"],
        "open_deals": metrics[6]["value"],
        "my_tasks": tasks.filter(assigned_to=user, status=Task.Status.PENDING).count(),
    }
    if is_consultant:
        response["metrics"] = _consultant_priority_metrics(user, tasks, cases, inquiries, deals, now)
    response["role_flags"] = {
        "manager": is_manager,
        "consultant": is_consultant,
        "finance": finance_visible,
        "general_manager": user_is_general_manager(user),
    }
    return response


def _consultant_priority_metrics(user, tasks, cases, inquiries, deals, now):
    today_start = timezone.make_aware(datetime.combine(now.date(), time.min))
    my_viewings = models.Viewing.objects.filter(
        assigned_to=user,
        scheduled_at__gte=now,
        scheduled_at__lt=now + timedelta(days=7),
    ).count()
    return [
        _metric("today_tasks", "وظایف امروز", tasks.filter(status=Task.Status.PENDING, due_date__lte=now.date()).count(), page="my-tasks"),
        _metric("overdue_tasks", "پیگیری‌های عقب‌افتاده", tasks.filter(status__in=(Task.Status.PENDING, Task.Status.IN_PROGRESS), due_date__lt=now.date()).count(), severity="warning", page="my-tasks"),
        _metric("assigned_leads", "سرنخ‌های واگذارشده", cases.filter(assigned_to=user).count() + inquiries.filter(assigned_to=user).count(), page="crm-inbox"),
        _metric("returned_files", "فایل‌های برگشتی", scoped_property_file_queryset(user).filter(rejection_reason__gt="").count(), severity="warning", page="crm-property-cases"),
        _metric("upcoming_viewings", "بازدیدهای نزدیک", my_viewings, page="crm-viewings"),
        _metric("inquiry_followups", "درخواست‌های نیازمند پیگیری", inquiries.filter(assigned_to=user, status=models.CaseStatus.ACTIVE).exclude(needs_confirmed_at__isnull=False).count(), page="crm-inquiries"),
        _metric("my_open_deals", "مذاکرات فعال من", deals.filter(assigned_to=user, stage__in=(models.Deal.Stage.NEGOTIATION, models.Deal.Stage.AGREED)).count(), page="crm-deals"),
    ]


def _contract_queue(user):
    contracts = scoped_contract_queryset(user)
    pending = contracts.filter(status__in=(models.Contract.Status.DRAFT, models.Contract.Status.SIGNING))
    rows = []
    for contract in pending.select_related("deal__property_file")[:50]:
        missing_signatures = contract.parties.filter(signature__isnull=True).count() if hasattr(contract, "parties") else 0
        rows.append(
            {
                "id": contract.pk,
                "contract_number": contract.contract_number,
                "status": contract.status,
                "status_label": STAGE_LABELS.get(contract.status, contract.status),
                "missing_signatures": missing_signatures,
                "title": contract.deal.property_file.title,
                "commissions": contract.commissions.count(),
            }
        )
    return {"count": pending.count(), "rows": rows}


def _team_status(user, start_dt, end_dt):
    ranges = _managed_ranges(user)
    if user_is_general_manager(user):
        range_ids = None
    else:
        range_ids = ranges
    from apps.accounts.models import User

    users = User.objects.filter(is_active=True)
    if range_ids is not None:
        users = users.filter(pk__in=_user_ids_for_ranges(range_ids))
    rows = []
    for member in users.select_related("consultant_profile").order_by("first_name", "last_name", "username")[:100]:
        cases = models.PropertyRegistrationRequest.objects.filter(created_by=member)
        inquiries = models.Inquiry.objects.filter(created_by=member)
        tasks = Task.objects.filter(assigned_to=member)
        columns = member.commission_shares.values("commission").distinct().count()
        rows.append(
            {
                "user_id": member.pk,
                "name": member.get_full_name().strip() or member.username,
                "active_listings": PropertyFile.objects.filter(
                    assigned_to=member,
                    status=PropertyFile.Status.ACTIVE,
                    property__review_status=Property.ReviewStatus.APPROVED,
                ).count(),
                "new_leads": cases.filter(created_at__range=(start_dt, end_dt)).count() + inquiries.filter(created_at__range=(start_dt, end_dt)).count(),
                "overdue_followups": tasks.filter(
                    status__in=(Task.Status.PENDING, Task.Status.IN_PROGRESS),
                    due_date__lt=timezone.now().date(),
                ).count(),
                "calls": FollowUp.objects.filter(
                    consultant=member,
                    follow_up_type="Call",
                    scheduled_at__range=(start_dt, end_dt),
                ).count(),
                "viewings": models.Viewing.objects.filter(
                    assigned_to=member, scheduled_at__range=(start_dt, end_dt)
                ).count(),
                "open_deals": models.Deal.objects.filter(
                    assigned_to=member,
                    stage__in=(models.Deal.Stage.NEGOTIATION, models.Deal.Stage.AGREED),
                ).count(),
                "won_deals": models.Deal.objects.filter(
                    assigned_to=member, stage=models.Deal.Stage.FINALIZED
                ).count(),
                "commission_participations": columns,
            }
        )
    return rows


def reports_bundle(user, params):
    start, end = parse_range(params)
    start_dt, end_dt = _range_bounds(start, end)
    allowed = (
        user_is_general_manager(user)
        or has_permission(user, "analytics.view")
        or has_permission(user, "finance.view")
        or bool(_managed_ranges(user))
    )
    if not allowed:
        from django.core.exceptions import PermissionDenied

        raise PermissionDenied("شما به گزارش‌ها دسترسی ندارید.")
    cases = scoped_case_queryset(user, models.PropertyRegistrationRequest.objects.all())
    inquiries = scoped_case_queryset(user, models.Inquiry.objects.all())
    deals = scoped_deal_queryset(user).filter(started_at__range=(start_dt, end_dt))
    contracts = scoped_contract_queryset(user).filter(created_at__range=(start_dt, end_dt))
    commissions = scoped_commission_queryset(user)
    payments = scoped_payment_queryset(user)
    deal_type_rows = []
    for row in (
        deals.values("property_file__deal_type_id", "property_file__deal_type__display_name")
        .annotate(count=Count("id"))
        .order_by("-count")
    ):
        values = (
            contracts.filter(deal__property_file__deal_type_id=row["property_file__deal_type_id"])
            .aggregate(
                sale=Sum("sale_price"),
                deposit=Sum("deposit"),
                rent=Sum("monthly_rent"),
            )
        )
        deal_type_rows.append(
            {
                "deal_type_id": row["property_file__deal_type_id"],
                "deal_type": row["property_file__deal_type__display_name"] or "نامشخص",
                "deals": row["count"],
                "contracts": contracts.filter(deal__property_file__deal_type_id=row["property_file__deal_type_id"]).count(),
                "sale_value": str(values["sale"] or Decimal("0")),
                "deposit_value": str(values["deposit"] or Decimal("0")),
                "monthly_rent_value": str(values["rent"] or Decimal("0")),
            }
        )
    claimed = commissions.exclude(status=models.Commission.Status.PENDING).aggregate(total=Sum("final_amount"))["total"] or Decimal("0")
    received = models.PaymentAllocation.objects.filter(
        payment__in=payments,
        payment__status__in=(models.Payment.Status.CONFIRMED, models.Payment.Status.REVERSED),
        payment__direction=models.Payment.Direction.IN,
    ).aggregate(total=Sum("amount"))["total"] or Decimal("0")
    shares_paid = models.PaymentAllocation.objects.filter(
        payment__in=payments,
        payment__status__in=(models.Payment.Status.CONFIRMED, models.Payment.Status.REVERSED),
        payment__direction=models.Payment.Direction.OUT,
    ).aggregate(total=Sum("amount"))["total"] or Decimal("0")
    stalled = []
    threshold = models.WorkflowSettings.load().stall_threshold_days
    for property_file in scoped_property_file_queryset(user).filter(status=PropertyFile.Status.ACTIVE).select_related("property", "deal_type")[:200]:
        entered = history_service.latest_stage_at("listing", property_file.pk) or property_file.created_at
        days = (timezone.now() - entered).days
        if days >= threshold:
            stalled.append(
                {
                    "id": property_file.pk,
                    "title": property_file.title,
                    "deal_type": property_file.deal_type.display_name if property_file.deal_type else "نامشخص",
                    "days_in_stage": days,
                }
            )
    return {
        "range": {"from": start.isoformat(), "to": end.isoformat()},
        "deals": {
            "count": deals.count(),
            "finalized": deals.filter(stage=models.Deal.Stage.FINALIZED).count(),
            "lost": deals.filter(stage=models.Deal.Stage.LOST).count(),
            "by_deal_type": deal_type_rows,
            "value_mixed": len(deal_type_rows) > 1,
            "by_stage": list(deals.values("stage").annotate(count=Count("id")).order_by("stage")),
        },
        "funnel": {
            "cases": cases.filter(created_at__range=(start_dt, end_dt)).count(),
            "inquiries": inquiries.filter(created_at__range=(start_dt, end_dt)).count(),
            "introductions": models.Introduction.objects.filter(
                inquiry__in=inquiries, created_at__range=(start_dt, end_dt)
            ).count(),
            "viewings": models.Viewing.objects.filter(
                introduction__inquiry__in=inquiries, scheduled_at__range=(start_dt, end_dt)
            ).count(),
            "deals": deals.count(),
            "contracts": contracts.count(),
            "finalized": contracts.filter(status=models.Contract.Status.FINALIZED).count(),
        },
        "finance": {
            "claimed": str(claimed),
            "received": str(received),
            "shares_paid": str(shares_paid),
            "outstanding": str(Decimal(claimed) - Decimal(received)),
        },
        "advisors": _team_status(user, start_dt, end_dt),
        "stalled_listings": stalled,
        "contracts": {
            "by_status": list(contracts.values("status").annotate(count=Count("id")).order_by("status")),
        },
        "cases_by_stage": list(cases.filter(is_legacy=False).values("status").annotate(count=Count("id"))),
        "inquiries_by_stage": list(inquiries.values("status").annotate(count=Count("id"))),
        "deals_by_stage": list(deals.values("stage").annotate(count=Count("id"))),
        "commissions": {"final": claimed},
    }


def pipeline_definitions(user):
    return [
        {"kind": kind, "label": label}
        for kind, label in PIPELINE_LABELS.items()
        if _pipeline_allowed(user, kind)
    ]


def _pipeline_allowed(user, kind):
    if kind in ("leads", "inquiries"):
        return has_permission(user, "case.view") or user_is_general_manager(user)
    if kind == "listings":
        return (
            user_is_general_manager(user)
            or has_permission(user, "pipeline.view")
            or has_permission(user, "property_file.view")
            or has_permission(user, "property_file.create")
            or has_permission(user, "listing.view")
        )
    if kind == "deals":
        return (
            user_is_general_manager(user)
            or has_permission(user, "pipeline.view")
            or has_permission(user, "deal.view")
            or has_permission(user, "deal.manage")
        )
    if kind == "contracts":
        return (
            user_is_general_manager(user)
            or user_has_company_finance(user)
            or has_permission(user, "contract.view")
            or has_permission(user, "contract.manage")
        )
    return True


def _filtered_queryset(kind, user, filters):
    assignee = filters.get("assignee") or ""
    scope_id = filters.get("scope") or ""
    deal_type = filters.get("deal_type") or ""
    priority = filters.get("priority") or ""
    search = (filters.get("search") or "").strip()
    mine = filters.get("mine") == "1"
    unassigned = filters.get("unassigned") == "1"
    overdue = filters.get("overdue") == "1"
    if kind in ("leads", "inquiries"):
        model = models.PropertyRegistrationRequest if kind == "leads" else models.Inquiry
        qs = scoped_case_queryset(user, model.objects.all()).select_related("contact", "assigned_to", "sales_range")
        if kind == "leads":
            qs = qs.filter(is_legacy=False)
        if assignee:
            qs = qs.filter(assigned_to_id=assignee)
        if mine:
            qs = qs.filter(assigned_to=user)
        if unassigned:
            qs = qs.filter(assigned_to__isnull=True)
        if scope_id:
            qs = qs.filter(sales_range_id=scope_id)
        if overdue:
            qs = qs.filter(due_at__lt=timezone.now())
        if kind == "inquiries" and deal_type:
            qs = qs.filter(preferences__deal_type_id=deal_type)
        if search:
            qs = qs.filter(
                Q(code__icontains=search)
                | Q(contact__full_name__icontains=search)
                | Q(description__icontains=search)
            )
        return qs
    if kind == "listings":
        qs = scoped_property_file_queryset(user).select_related("property", "deal_type", "assigned_to")
        if assignee:
            qs = qs.filter(assigned_to_id=assignee)
        if mine:
            qs = qs.filter(assigned_to=user)
        if unassigned:
            qs = qs.filter(assigned_to__isnull=True)
        if deal_type:
            qs = qs.filter(deal_type_id=deal_type)
        if priority:
            qs = qs.filter(priority=priority)
        if search:
            qs = qs.filter(Q(title__icontains=search) | Q(property__internal_code__icontains=search))
        return qs
    if kind == "deals":
        qs = scoped_deal_queryset(user).select_related(
            "property_file", "inquiry", "assigned_to", "introduction"
        )
        if assignee:
            qs = qs.filter(assigned_to_id=assignee)
        if mine:
            qs = qs.filter(assigned_to=user)
        if unassigned:
            qs = qs.filter(assigned_to__isnull=True)
        if deal_type:
            qs = qs.filter(property_file__deal_type_id=deal_type)
        if search:
            qs = qs.filter(
                Q(property_file__title__icontains=search)
                | Q(inquiry__code__icontains=search)
                | Q(inquiry__contact__full_name__icontains=search)
            )
        return qs
    if kind == "contracts":
        qs = scoped_contract_queryset(user).select_related("deal__property_file", "deal__inquiry")
        if deal_type:
            qs = qs.filter(deal__property_file__deal_type_id=deal_type)
        if search:
            qs = qs.filter(
                Q(contract_number__icontains=search)
                | Q(deal__property_file__title__icontains=search)
            )
        return qs
    qs = scoped_task_queryset(user).select_related("assigned_to", "property", "property_case", "inquiry")
    if mine:
        qs = qs.filter(assigned_to=user)
    if assignee:
        qs = qs.filter(assigned_to_id=assignee)
    if unassigned:
        qs = qs.filter(assigned_to__isnull=True)
    if priority:
        qs = qs.filter(priority=priority)
    if overdue:
        qs = qs.filter(due_date__lt=timezone.now().date()).exclude(status=Task.Status.COMPLETED)
    if search:
        qs = qs.filter(Q(title__icontains=search) | Q(description__icontains=search))
    return qs


def _stage_of(kind, obj):
    if kind == "leads":
        if obj.status in CASE_TERMINAL:
            return obj.status
        if obj.lead_status != models.LeadStatus.ACCEPTED:
            return "NEW"
        if obj.acceptance_status == models.AcceptanceStatus.UNASSIGNED:
            return "ACCEPTED"
        if obj.acceptance_status in (
            models.AcceptanceStatus.PENDING,
            models.AcceptanceStatus.WITHDRAWAL_PENDING,
        ):
            return "ASSIGNED"
        return "IN_PROGRESS"
    if kind == "inquiries":
        return pipeline_stage(obj)
    if kind == "listings":
        if obj.property.review_status != Property.ReviewStatus.APPROVED:
            return "DRAFT"
        return obj.status
    if kind == "deals":
        return obj.stage
    if kind == "contracts":
        return obj.status
    return obj.status


def pipeline_stages(kind):
    return {
        "leads": ["NEW", "ACCEPTED", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CLOSED"],
        "inquiries": [
            "LEAD",
            "ASSIGNMENT",
            "ACCEPTANCE",
            "NEEDS",
            "INTRODUCTION",
            "VIEWING",
            "NEGOTIATION",
            "COMPLETED",
            "CLOSED",
        ],
        "listings": ["DRAFT", "ACTIVE", "PAUSED", "SOLD", "EXPIRED"],
        "deals": ["NEGOTIATION", "AGREED", "CONTRACT", "FINALIZED", "LOST"],
        "contracts": ["DRAFT", "SIGNING", "FINALIZED"],
        "tasks": ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
    }[kind]


def _card(kind, obj, threshold):
    if kind in ("leads", "inquiries"):
        stage = _stage_of(kind, obj)
        subject_type = "registration_request" if kind == "leads" else "inquiry"
        entered = history_service.latest_stage_at(subject_type, obj.pk) or obj.created_at
        return {
            "id": obj.pk,
            "code": obj.code,
            "title": obj.contact.full_name if obj.contact_id else "",
            "subtitle": obj.property_title if kind == "leads" else "، ".join(
                pref.deal_type.display_name for pref in obj.preferences.all()[:3] if pref.deal_type_id
            ),
            "stage": stage,
            "stage_label": STAGE_LABELS.get(stage, stage),
            "owner": obj.assigned_to.get_full_name().strip() or obj.assigned_to.username if obj.assigned_to_id else "",
            "due_at": obj.due_at.isoformat() if obj.due_at else None,
            "stage_entered_at": entered.isoformat() if entered else None,
            "days_in_stage": (timezone.now() - entered).days if entered else 0,
            "stalled": (timezone.now() - entered).days >= threshold,
            "record_page": "crm-property-cases" if kind == "leads" else "crm-inquiries",
            "warnings": _case_warnings(obj),
        }
    if kind == "listings":
        stage = _stage_of(kind, obj)
        entered = history_service.latest_stage_at("listing", obj.pk) or obj.created_at
        from . import property_file_snapshot

        snapshot = property_file_snapshot(obj)
        return {
            "id": obj.pk,
            "code": f"F-{obj.pk}",
            "title": obj.title,
            "subtitle": obj.deal_type.display_name if obj.deal_type_id else "نوع معامله نامشخص",
            "stage": stage,
            "stage_label": STAGE_LABELS.get(stage, stage),
            "owner": obj.assigned_to.get_full_name().strip() or obj.assigned_to.username if obj.assigned_to_id else "",
            "due_at": None,
            "stage_entered_at": entered.isoformat() if entered else None,
            "days_in_stage": (timezone.now() - entered).days if entered else 0,
            "stalled": (timezone.now() - entered).days >= threshold,
            "record_page": "property-files",
            "financials": snapshot,
            "warnings": []
            if obj.deal_type_id
            else ["نوع معامله تعیین نشده"],
        }
    if kind == "deals":
        entered = history_service.latest_stage_at("deal", obj.pk) or obj.started_at
        return {
            "id": obj.pk,
            "code": f"D-{obj.pk}",
            "title": obj.property_file.title,
            "subtitle": obj.inquiry.code if obj.inquiry_id else "",
            "stage": obj.stage,
            "stage_label": STAGE_LABELS.get(obj.stage, obj.stage),
            "owner": obj.assigned_to.get_full_name().strip() or obj.assigned_to.username if obj.assigned_to_id else "",
            "due_at": None,
            "stage_entered_at": entered.isoformat() if entered else None,
            "days_in_stage": (timezone.now() - entered).days if entered else 0,
            "stalled": (timezone.now() - entered).days >= threshold and obj.stage not in ("FINALIZED", "LOST"),
            "record_page": "crm-deals",
            "warnings": [] if obj.assigned_to_id else ["مسئول مذاکره تعیین نشده"],
        }
    if kind == "contracts":
        entered = obj.created_at
        return {
            "id": obj.pk,
            "code": obj.contract_number,
            "title": obj.deal.property_file.title,
            "subtitle": obj.deal.inquiry.code if obj.deal.inquiry_id else "",
            "stage": obj.status,
            "stage_label": STAGE_LABELS.get(obj.status, obj.status),
            "owner": "",
            "due_at": None,
            "stage_entered_at": entered.isoformat() if entered else None,
            "days_in_stage": (timezone.now() - entered).days if entered else 0,
            "stalled": (timezone.now() - entered).days >= threshold and obj.status != models.Contract.Status.FINALIZED,
            "record_page": "crm-contracts",
            "warnings": [] if obj.status == models.Contract.Status.FINALIZED else ["امضاها تکمیل نشده"],
        }
    entered = history_service.latest_stage_at("task", obj.pk) or obj.created_at
    return {
        "id": obj.pk,
        "code": f"T-{obj.pk}",
        "title": obj.title,
        "subtitle": obj.get_task_type_display(),
        "stage": obj.status,
        "stage_label": STAGE_LABELS.get(obj.status, obj.status),
        "owner": obj.assigned_to.get_full_name().strip() or obj.assigned_to.username if obj.assigned_to_id else "",
        "due_at": obj.due_date.isoformat() if obj.due_date else None,
        "stage_entered_at": entered.isoformat() if entered else None,
        "days_in_stage": (timezone.now() - entered).days if entered else 0,
        "stalled": obj.due_date is not None and obj.due_date < timezone.now().date() and obj.status == Task.Status.PENDING,
        "record_page": "my-tasks",
        "warnings": [] if obj.due_date else ["موعد انجام تعیین نشده"],
    }


def _case_warnings(obj):
    warnings = []
    if not obj.assigned_to_id:
        warnings.append("در صف ارجاع؛ مسئول تعیین نشده")
    if not obj.due_at:
        warnings.append("موعد اقدام تعیین نشده")
    return warnings


def transitions_for(kind, card, user):
    if kind == "leads":
        if card["stage"] == "NEW":
            return [
                {
                    "to": "ACCEPTED",
                    "label": "پذیرش سرنخ",
                    "action": "accept-lead",
                    "endpoint": f"/crm/api/property-cases/{card['id']}/accept_lead/",
                    "method": "POST",
                    "reason_required": False,
                }
            ]
        if card["stage"] == "ACCEPTED":
            return [
                {
                    "to": "ASSIGNED",
                    "label": "ارجاع به مسئول",
                    "action": "assign",
                    "endpoint": f"/crm/api/property-cases/{card['id']}/assign/",
                    "method": "POST",
                    "requires": ["assigned_to", "due_at"],
                    "reason_required": False,
                }
            ]
        if card["stage"] == "ASSIGNED":
            return [
                {
                    "to": "IN_PROGRESS",
                    "label": "پذیرش مسئول",
                    "action": "accept-assignment",
                    "endpoint": f"/crm/api/property-cases/{card['id']}/accept_assignment/",
                    "method": "POST",
                    "reason_required": False,
                }
            ]
        if card["stage"] == "IN_PROGRESS":
            return [
                {
                    "to": "COMPLETED",
                    "label": "تکمیل پرونده",
                    "action": "change-status",
                    "endpoint": f"/crm/api/property-cases/{card['id']}/change_status/",
                    "method": "POST",
                    "payload": {"status": "COMPLETED"},
                    "reason_required": False,
                },
                {
                    "to": "CLOSED",
                    "label": "بستن پرونده",
                    "action": "change-status",
                    "endpoint": f"/crm/api/property-cases/{card['id']}/change_status/",
                    "method": "POST",
                    "payload": {"status": "CLOSED"},
                    "reason_required": True,
                },
            ]
        return []
    if kind == "inquiries":
        if card["stage"] == "NEEDS":
            return [
                {
                    "to": "COMPLETED",
                    "label": "بستن درخواست",
                    "action": "change-status",
                    "endpoint": f"/crm/api/inquiries/{card['id']}/change_status/",
                    "method": "POST",
                    "payload": {"status": "CLOSED"},
                    "reason_required": True,
                }
            ]
        return []
    if kind == "listings":
        transitions = []
        if card["stage"] == "DRAFT":
            transitions.append(
                {
                    "to": "ACTIVE",
                    "label": "فعال‌سازی فایل",
                    "action": "update-listing",
                    "endpoint": f"/crm/api/listings/{card['id']}/",
                    "method": "PATCH",
                    "payload": {"status": "ACTIVE"},
                    "reason_required": False,
                }
            )
        if card["stage"] == "ACTIVE":
            transitions.append(
                {
                    "to": "PAUSED",
                    "label": "توقف فایل",
                    "action": "update-listing",
                    "endpoint": f"/crm/api/listings/{card['id']}/",
                    "method": "PATCH",
                    "payload": {"status": "PAUSED"},
                    "reason_required": False,
                }
            )
        if card["stage"] == "PAUSED":
            transitions.append(
                {
                    "to": "ACTIVE",
                    "label": "بازفعال‌سازی",
                    "action": "update-listing",
                    "endpoint": f"/crm/api/listings/{card['id']}/",
                    "method": "PATCH",
                    "payload": {"status": "ACTIVE"},
                    "reason_required": False,
                }
            )
        return transitions
    if kind == "deals":
        transitions = []
        if card["stage"] == "NEGOTIATION":
            transitions.append(
                {
                    "to": "AGREED",
                    "label": "ثبت توافق",
                    "action": "succeed-deal",
                    "endpoint": f"/crm/api/deals/{card['id']}/succeed/",
                    "method": "POST",
                    "reason_required": False,
                }
            )
        if card["stage"] in ("NEGOTIATION", "AGREED"):
            transitions.append(
                {
                    "to": "LOST",
                    "label": "ثبت عدم توافق",
                    "action": "close-deal",
                    "endpoint": f"/crm/api/deals/{card['id']}/close/",
                    "method": "POST",
                    "reason_required": True,
                }
            )
        return transitions
    if kind == "contracts":
        return []
    transitions = []
    if card["stage"] == "PENDING":
        transitions.append(
            {
                "to": "IN_PROGRESS",
                "label": "شروع انجام",
                "action": "update-task",
                "endpoint": f"/tasks/api/tasks/{card['id']}/",
                "method": "PATCH",
                "payload": {"status": "IN_PROGRESS"},
                "reason_required": False,
            }
        )
    if card["stage"] in ("PENDING", "IN_PROGRESS"):
        transitions.append(
            {
                "to": "COMPLETED",
                "label": "تکمیل وظیفه",
                "action": "update-task",
                "endpoint": f"/tasks/api/tasks/{card['id']}/",
                "method": "PATCH",
                "payload": {"status": "COMPLETED"},
                "reason_required": False,
            }
        )
    return transitions


def pipeline_board(user, kind, filters):
    if kind not in PIPELINE_LABELS:
        raise ValidationError({"kind": "نوع کاریز معتبر نیست."})
    requested_kind = kind
    if not _pipeline_allowed(user, kind):
        fallback = next((code for code in PIPELINE_LABELS if _pipeline_allowed(user, code)), None)
        if fallback is None:
            from django.core.exceptions import PermissionDenied

            raise PermissionDenied("شما به این کاریز دسترسی ندارید.")
        kind = fallback
    threshold = models.WorkflowSettings.load().stall_threshold_days
    stage_codes = pipeline_stages(kind)
    queryset = _filtered_queryset(kind, user, filters)
    if kind == "inquiries":
        queryset = queryset.prefetch_related("preferences__deal_type")
    cards = []
    counts = {code: 0 for code in stage_codes}
    for obj in queryset[:500]:
        card = _card(kind, obj, threshold)
        stage = card["stage"]
        counts[stage] = counts.get(stage, 0) + 1
        if stage in counts and len(cards) < 500:
            card["transitions"] = transitions_for(kind, card, user)
            cards.append(card)
    columns = [
        {
            "code": code,
            "label": STAGE_LABELS.get(code, code),
            "count": counts.get(code, 0),
            "cards": [card for card in cards if card["stage"] == code],
        }
        for code in stage_codes
    ]
    return {
        "kind": kind,
        "requested_kind": requested_kind,
        "label": PIPELINE_LABELS[kind],
        "stages": columns,
        "total": len(cards),
        "stalled": len([card for card in cards if card["stalled"]]),
        "stall_threshold_days": threshold,
        "available": pipeline_definitions(user),
        "filters": filters,
    }
