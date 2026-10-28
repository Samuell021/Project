from decimal import Decimal, InvalidOperation

from django.core.exceptions import PermissionDenied, ValidationError
from django.db.models import Q, Sum

from apps.accounts.permissions import has_permission, user_is_general_manager
from apps.notifications.models import Notification
from apps.notifications.services import admin_recipients, notify_users, permission_recipients

from .. import models
from . import commission_amount, refresh_commission_status, refresh_share_status

SETTLED_PAYMENT_STATUSES = (
    models.Payment.Status.CONFIRMED,
    models.Payment.Status.REVERSED,
)


def _fa_amount(value):
    try:
        return f"{int(Decimal(value)):,}".replace(",", "٬")
    except (InvalidOperation, TypeError, ValueError):
        return "۰"


def _notify_finance(recipients, *, notification_type, title, message, event_key, metadata):
    notify_users(
        recipients,
        notification_type=notification_type,
        title=title,
        message=message,
        metadata=metadata,
        event_key_prefix=event_key,
    )


def settled_allocations():
    return models.PaymentAllocation.objects.filter(
        payment__status__in=SETTLED_PAYMENT_STATUSES
    )


def commission_received(commission):
    total = settled_allocations().filter(
        commission=commission,
        payment__direction=models.Payment.Direction.IN,
    ).aggregate(total=Sum("amount"))["total"]
    return total or Decimal("0")


def commission_share_total(commission):
    total = commission.shares.aggregate(total=Sum("amount"))["total"]
    return total or Decimal("0")


def commission_balance(commission):
    received = commission_received(commission)
    return {
        "final_amount": commission.final_amount,
        "received_amount": received,
        "remaining_amount": commission.final_amount - received,
        "shares_total": commission_share_total(commission),
    }


def share_paid(share):
    total = settled_allocations().filter(
        commission_share=share,
        payment__direction=models.Payment.Direction.OUT,
    ).aggregate(total=Sum("amount"))["total"]
    return total or Decimal("0")


def share_balance(share):
    paid = share_paid(share)
    return {
        "amount": share.amount,
        "paid_amount": paid,
        "remaining_amount": share.amount - paid,
    }


def payment_allocated(payment):
    total = payment.allocations.aggregate(total=Sum("amount"))["total"]
    return total or Decimal("0")


def contract_base_amount(contract):
    terms = contract.terms_snapshot or {}
    for key in ("sale_price", "deposit", "monthly_rent"):
        value = getattr(contract, key, None)
        if value:
            return Decimal(value)
    for key in ("deposit", "advance_amount", "total_value", "difference_amount", "cash_amount"):
        value = terms.get(key)
        if value not in (None, ""):
            try:
                parsed = Decimal(str(value))
            except (InvalidOperation, TypeError, ValueError):
                continue
            if parsed > 0:
                return parsed
    return None


def policy_snapshot(policy, base_amount):
    return {
        "policy_version_id": policy.pk,
        "policy_name": policy.name,
        "version_number": policy.version_number,
        "calculation_method": policy.calculation_method,
        "parameters": policy.parameters,
        "rounding_rule": policy.rounding_rule,
        "base_amount": str(base_amount),
    }


def calculate_commission(policy, base_amount):
    base = Decimal(base_amount or 0)
    if base <= 0:
        raise ValidationError({"base_amount": "مبلغ مبنا باید مثبت باشد."})
    if policy.status != models.CommissionPolicyVersion.Status.PUBLISHED:
        raise ValidationError({"policy_version": "سیاست کمیسیون باید منتشرشده باشد."})
    try:
        amount = commission_amount(policy, base)
    except (InvalidOperation, TypeError, ValueError):
        raise ValidationError({"policy_version": "پارامتر سیاست منتشرشده معتبر نیست."})
    amount = Decimal(amount)
    params = policy.parameters or {}
    minimum = params.get("min_amount")
    maximum = params.get("max_amount")
    if minimum not in (None, ""):
        amount = max(amount, Decimal(str(minimum)))
    if maximum not in (None, ""):
        amount = min(amount, Decimal(str(maximum)))
    if amount <= 0:
        raise ValidationError({"final_amount": "مبلغ محاسبه‌شده سیاست باید مثبت باشد."})
    return amount.quantize(Decimal("1"))


def _decimal(value, field, *, allow_zero=True):
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValidationError({field: "مقدار عددی معتبر وارد کنید."})
    if parsed < 0 or (not allow_zero and parsed == 0):
        raise ValidationError({field: "مبلغ باید مثبت باشد."})
    return parsed


def _signed_decimal(value, field):
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValidationError({field: "مقدار عددی معتبر وارد کنید."})


def _normalize_shares(payload, amount, user):
    shares = payload.get("shares") or []
    if not isinstance(shares, list) or len(shares) > 100:
        raise ValidationError({"shares": "فهرست سهم‌ها باید آرایه‌ای با حداکثر ۱۰۰ مورد باشد."})
    from apps.accounts.models import UserRole

    team_ids = None
    if not user_is_general_manager(user) and getattr(user, "role", "") != UserRole.FINANCE:
        team_ids = _team_ids(user)
    normalized = []
    for share in shares:
        if not isinstance(share, dict):
            raise ValidationError({"shares": "ساختار سهم نامعتبر است."})
        beneficiary_type = share.get("beneficiary_type") or models.CommissionShare.BeneficiaryType.USER
        if beneficiary_type not in models.CommissionShare.BeneficiaryType.values:
            raise ValidationError({"shares": "نوع ذی‌نفع سهم معتبر نیست."})
        raw_percent = share.get("share_percent")
        percent = None
        if raw_percent not in (None, ""):
            percent = _decimal(raw_percent, "shares", allow_zero=False)
            if percent > 100:
                raise ValidationError({"shares": "درصد سهم باید بیشتر از صفر و حداکثر ۱۰۰ باشد."})
        raw_amount = share.get("amount")
        share_amount = _decimal(raw_amount, "shares") if raw_amount not in (None, "") else Decimal("0")
        if percent is not None:
            calculated = (amount * percent / Decimal("100")).quantize(Decimal("1"))
            if share_amount and share_amount != calculated:
                raise ValidationError({"shares": "مبلغ سهم با درصد ثبت‌شده هم‌خوانی ندارد."})
            share_amount = calculated
        if share_amount <= 0:
            raise ValidationError({"shares": "مبلغ هر سهم باید مثبت باشد."})
        beneficiary = None
        if beneficiary_type == models.CommissionShare.BeneficiaryType.USER:
            from apps.accounts.models import User

            beneficiary = User.objects.filter(is_active=True, pk=share.get("beneficiary_user")).first()
            if beneficiary is None:
                raise ValidationError({"shares": "ذی‌نفع سهم در فهرست کاربران فعال نیست."})
            if team_ids is not None and beneficiary.pk not in team_ids:
                raise PermissionDenied("ذی‌نفع سهم باید در حوزه مجاز شما باشد.")
        normalized.append(
            {
                "beneficiary_type": beneficiary_type,
                "beneficiary_user": beneficiary,
                "share_percent": percent,
                "amount": share_amount,
            }
        )
    if sum((item["amount"] for item in normalized), Decimal("0")) > amount:
        raise ValidationError({"shares": "جمع سهم‌ها از مبلغ مطالبه بیشتر است."})
    return normalized


def _team_ids(user):
    from . import scope_team_ids

    return scope_team_ids(user)


def create_commission(contract, debtor_contact, user, payload):
    if not (has_permission(user, "finance.manage") or user_is_general_manager(user)):
        raise PermissionDenied("شما اجازه ساخت مطالبه کمیسیون را ندارید.")
    if contract.status != models.Contract.Status.FINALIZED:
        raise ValidationError({"contract": "مطالبه فقط از قرارداد قطعی ساخته می‌شود."})
    existing = models.Commission.objects.filter(contract=contract, debtor_contact=debtor_contact).first()
    if existing:
        return existing
    base_raw = payload.get("base_amount")
    base = _decimal(base_raw, "base_amount", allow_zero=False) if base_raw not in (None, "") else contract_base_amount(contract)
    if base is None:
        raise ValidationError({"base_amount": "مبلغ مبنای قرارداد مشخص نیست؛ مبلغ مبنا را وارد کنید."})
    policy = None
    policy_id = payload.get("policy_version")
    if policy_id:
        policy = models.CommissionPolicyVersion.objects.filter(
            pk=policy_id,
            status=models.CommissionPolicyVersion.Status.PUBLISHED,
            deal_type_id=contract.deal.property_file.deal_type_id,
        ).first()
        if policy is None:
            raise ValidationError({"policy_version": "سیاست منتشرشده برای این نوع معامله یافت نشد."})
        amount = calculate_commission(policy, base)
        snapshot = policy_snapshot(policy, base)
    else:
        amount = _decimal(payload.get("final_amount") or 0, "final_amount", allow_zero=False)
        snapshot = {"base_amount": str(base), "manual": True}
    due_at = payload.get("due_at")
    commission = models.Commission.objects.create(
        contract=contract,
        debtor_contact=debtor_contact,
        policy_version=policy,
        calculation_snapshot=snapshot,
        calculated_amount=amount,
        final_amount=amount,
        due_at=due_at,
    )
    for share in _normalize_shares(payload, amount, user):
        models.CommissionShare.objects.create(commission=commission, **share)
    _notify_finance(
        [*permission_recipients("finance.manage", user), *admin_recipients(user)],
        notification_type=Notification.NotificationType.COMMISSION_PENDING,
        title="مطالبه کمیسیون در انتظار تأیید",
        message=f"برای قرارداد {contract.contract_number} مطالبه‌ای به مبلغ {_fa_amount(amount)} تومان ثبت شد.",
        event_key=f"commission-created:{commission.pk}",
        metadata={"subject_type": "COMMISSION", "subject_id": commission.pk, "contract_id": contract.pk},
    )
    return commission


def approve_commission(commission, user, payload):
    if not (has_permission(user, "finance.manage") or user_is_general_manager(user)):
        raise PermissionDenied("شما اجازه تأیید مطالبه را ندارید.")
    if commission.status != models.Commission.Status.PENDING:
        raise ValidationError({"status": "مطالبه‌ای که از حالت انتظار خارج شده قابل تأیید مجدد نیست."})
    adjustment = _signed_decimal(payload.get("adjustment_amount") or 0, "adjustment_amount")
    reason = str(payload.get("adjustment_reason") or "").strip()
    if adjustment and not reason:
        raise ValidationError({"adjustment_reason": "برای تعدیل مبلغ، ثبت دلیل الزامی است."})
    final_amount = commission.calculated_amount + adjustment
    if final_amount <= 0:
        raise ValidationError({"adjustment_amount": "مبلغ نهایی باید مثبت باشد."})
    if commission_share_total(commission) > final_amount:
        raise ValidationError({"adjustment_amount": "مبلغ نهایی نمی‌تواند از مجموع سهم‌های ثبت‌شده کمتر باشد."})
    if final_amount < commission_received(commission):
        raise ValidationError({"adjustment_amount": "مبلغ نهایی از وجه وصول‌شده کمتر نمی‌تواند باشد."})
    commission.adjustment_amount = adjustment
    commission.adjustment_reason = reason
    commission.final_amount = final_amount
    commission.status = models.Commission.Status.APPROVED
    commission.save()
    commission.shares.filter(status=models.CommissionShare.Status.PENDING).update(
        status=models.CommissionShare.Status.APPROVED
    )
    _notify_finance(
        [*permission_recipients("finance.view", user), *admin_recipients(user)],
        notification_type=Notification.NotificationType.COMMISSION_APPROVED,
        title="تأیید مطالبه کمیسیون",
        message=f"مطالبه قرارداد {commission.contract.contract_number} به مبلغ {_fa_amount(commission.final_amount)} تومان تأیید شد.",
        event_key=f"commission-approved:{commission.pk}",
        metadata={"subject_type": "COMMISSION", "subject_id": commission.pk, "contract_id": commission.contract_id},
    )
    return commission


def record_payment(user, validated_data):
    if not (has_permission(user, "finance.manage") or user_is_general_manager(user)):
        raise PermissionDenied("شما اجازه ثبت وجه را ندارید.")
    data = dict(validated_data)
    allocation_items = data.pop("allocations", None) or []
    amount = Decimal(str(data.get("amount") or 0))
    if amount <= 0:
        raise ValidationError({"amount": "مبلغ وجه باید مثبت باشد."})
    if payment_allocated_amount(allocation_items) > amount:
        raise ValidationError({"allocations": "جمع تخصیص‌ها از مبلغ وجه بیشتر است."})
    direction = data.get("direction")
    contact = data.get("contact")
    payment_user = data.get("user")
    commissions = set()
    shares = set()
    seen = set()
    for item in allocation_items:
        item_amount = Decimal(str(item.get("amount") or 0))
        commission = item.get("commission")
        share = item.get("commission_share")
        target = (
            ("commission", commission.pk)
            if commission is not None
            else ("share", share.pk)
            if share is not None
            else None
        )
        if target is None:
            raise ValidationError({"allocations": "هر تخصیص باید یک مطالبه یا سهم داشته باشد."})
        if target in seen:
            raise ValidationError({"allocations": "هر مطالبه یا سهم را فقط یک‌بار در هر وجه تخصیص دهید."})
        seen.add(target)
        if item_amount <= 0:
            raise ValidationError({"allocations": "هر تخصیص وجه باید مبلغ مثبت داشته باشد."})
        if direction == models.Payment.Direction.IN:
            if commission is None or share is not None:
                raise ValidationError({"allocations": "وجه دریافتی باید فقط به یک مطالبه کمیسیون تخصیص یابد."})
            locked = models.Commission.objects.select_for_update().get(pk=commission.pk)
            if locked.status not in (
                models.Commission.Status.APPROVED,
                models.Commission.Status.PARTIALLY_PAID,
            ):
                raise ValidationError({"allocations": "وصول فقط برای مطالبه تأییدشده ثبت می‌شود."})
            if contact is None or contact.pk != locked.debtor_contact_id:
                raise ValidationError({"contact": "شخص پرداخت‌کننده باید با بدهکار مطالبه یکسان باشد."})
            if commission_received(locked) + item_amount > locked.final_amount:
                raise ValidationError({"allocations": "تخصیص از مانده مطالبه بیشتر است."})
            commissions.add(locked.pk)
        elif direction == models.Payment.Direction.OUT:
            if contact is not None:
                raise ValidationError({"contact": "وجه پرداختی به ذی‌نفع سهم تخصیص می‌یابد، نه شخص بدهکار."})
            if share is None or commission is not None:
                raise ValidationError({"allocations": "وجه پرداختی باید فقط به یک سهم کمیسیون تخصیص یابد."})
            locked_share = models.CommissionShare.objects.select_for_update().get(pk=share.pk)
            if locked_share.status not in (
                models.CommissionShare.Status.APPROVED,
                models.CommissionShare.Status.PARTIALLY_PAID,
            ):
                raise ValidationError({"allocations": "پرداخت فقط برای سهم تأییدشده ثبت می‌شود."})
            if locked_share.beneficiary_type == models.CommissionShare.BeneficiaryType.USER:
                if payment_user is None or payment_user.pk != locked_share.beneficiary_user_id:
                    raise ValidationError({"user": "دریافت‌کننده وجه باید با ذی‌نفع سهم یکسان باشد."})
            elif payment_user is not None:
                raise ValidationError({"user": "برای سهم مجموعه، کاربر دریافت‌کننده انتخاب نمی‌شود."})
            if share_paid(locked_share) + item_amount > locked_share.amount:
                raise ValidationError({"allocations": "پرداخت از مبلغ سهم بیشتر است."})
            shares.add(locked_share.pk)
        else:
            raise ValidationError({"direction": "جهت وجه باید دریافت یا پرداخت باشد."})
    payment = models.Payment.objects.create(recorded_by=user, **data)
    for item in allocation_items:
        models.PaymentAllocation.objects.create(payment=payment, **item)
    for commission_id in commissions:
        refresh_commission_status(models.Commission.objects.get(pk=commission_id))
    for share_id in shares:
        refresh_share_status(models.CommissionShare.objects.get(pk=share_id))
    direction_label = "دریافت" if payment.direction == models.Payment.Direction.IN else "پرداخت"
    _notify_finance(
        [*permission_recipients("finance.view", user), *admin_recipients(user)],
        notification_type=Notification.NotificationType.PAYMENT_RECORDED,
        title=f"ثبت وجه {direction_label}",
        message=f"وجه {direction_label} به مبلغ {_fa_amount(payment.amount)} تومان ثبت و تخصیص داده شد.",
        event_key=f"payment-recorded:{payment.pk}",
        metadata={"subject_type": "PAYMENT", "subject_id": payment.pk},
    )
    return payment


def payment_allocated_amount(allocations):
    total = Decimal("0")
    for item in allocations:
        if hasattr(item, "get"):
            total += Decimal(str(item.get("amount") or 0))
        else:
            total += Decimal(str(getattr(item, "amount", 0) or 0))
    return total


def reverse_payment(payment, user):
    if not (has_permission(user, "finance.manage") or user_is_general_manager(user)):
        raise PermissionDenied("شما اجازه برگشت وجه را ندارید.")
    if payment.reversal_of_id is not None:
        raise ValidationError({"reversal_of": "سند برگشت را نمی‌توان دوباره برگشت زد."})
    if payment.status == models.Payment.Status.REVERSED:
        existing = models.Payment.objects.filter(reversal_of=payment).first()
        if existing is not None:
            return existing
        raise ValidationError({"status": "این وجه قبلاً برگشت خورده است."})
    from django.utils import timezone

    reversal = models.Payment.objects.create(
        direction=payment.direction,
        contact=payment.contact,
        user=payment.user,
        amount=payment.amount,
        paid_at=timezone.now(),
        method=payment.method,
        reference_number=f"REV-{payment.pk}",
        recorded_by=user,
        reversal_of=payment,
    )
    for allocation in payment.allocations.all():
        models.PaymentAllocation.objects.create(
            payment=reversal,
            commission=allocation.commission,
            commission_share=allocation.commission_share,
            amount=-allocation.amount,
        )
    payment.status = models.Payment.Status.REVERSED
    payment.save(update_fields=["status"])
    for commission_id in set(payment.allocations.values_list("commission_id", flat=True)) - {None}:
        refresh_commission_status(models.Commission.objects.get(pk=commission_id))
    for share_id in set(payment.allocations.values_list("commission_share_id", flat=True)) - {None}:
        refresh_share_status(models.CommissionShare.objects.get(pk=share_id))
    _notify_finance(
        [*permission_recipients("finance.view", user), *admin_recipients(user)],
        notification_type=Notification.NotificationType.PAYMENT_REVERSED,
        title="برگشت وجه",
        message=f"وجه شماره {payment.pk} به مبلغ {_fa_amount(payment.amount)} تومان با سند برگشت شماره {reversal.pk} برگشت خورد.",
        event_key=f"payment-reversed:{reversal.pk}",
        metadata={"subject_type": "PAYMENT", "subject_id": reversal.pk, "reversal_of": payment.pk},
    )
    return reversal


def _claim_row(commission):
    balance = commission_balance(commission)
    return {
        "id": commission.pk,
        "status": commission.status,
        "status_label": commission.get_status_display(),
        "calculated_amount": str(commission.calculated_amount),
        "adjustment_amount": str(commission.adjustment_amount),
        "final_amount": str(balance["final_amount"]),
        "received_amount": str(balance["received_amount"]),
        "remaining_amount": str(balance["remaining_amount"]),
        "shares_total": str(balance["shares_total"]),
        "due_at": commission.due_at.isoformat() if commission.due_at else None,
        "policy_version": commission.policy_version_id,
        "calculation_snapshot": commission.calculation_snapshot,
        "debtor_contact": commission.debtor_contact_id,
    }


def _share_row(share):
    balance = share_balance(share)
    return {
        "id": share.pk,
        "beneficiary_type": share.beneficiary_type,
        "beneficiary_user": share.beneficiary_user_id,
        "beneficiary_name": (
            share.beneficiary_user.get_full_name().strip() or share.beneficiary_user.username
            if share.beneficiary_user_id
            else "مجموعه"
        ),
        "share_percent": str(share.share_percent) if share.share_percent is not None else None,
        "amount": str(balance["amount"]),
        "paid_amount": str(balance["paid_amount"]),
        "remaining_amount": str(balance["remaining_amount"]),
        "status": share.status,
        "status_label": share.get_status_display(),
    }


def _payment_row(payment):
    return {
        "id": payment.pk,
        "direction": payment.direction,
        "amount": str(payment.amount),
        "paid_at": payment.paid_at.isoformat() if payment.paid_at else None,
        "method": payment.method,
        "reference_number": payment.reference_number,
        "status": payment.status,
        "status_label": payment.get_status_display(),
        "reversal_of": payment.reversal_of_id,
        "allocations": [
            {
                "id": allocation.pk,
                "commission": allocation.commission_id,
                "commission_share": allocation.commission_share_id,
                "amount": str(allocation.amount),
            }
            for allocation in payment.allocations.all()
        ],
    }


def finance_overview(user):
    from .access import (
        scoped_commission_queryset,
        scoped_contract_queryset,
        scoped_payment_queryset,
    )

    contracts = (
        scoped_contract_queryset(user)
        .filter(status=models.Contract.Status.FINALIZED)
        .select_related("deal__property_file", "deal__property_file__deal_type")
        .prefetch_related("commissions__shares", "commissions__allocations__payment")
        .order_by("-finalized_at", "-created_at")
    )
    rows = []
    totals = {"claimed": Decimal("0"), "received": Decimal("0"), "shares_paid": Decimal("0")}
    for contract in contracts[:200]:
        claims = list(contract.commissions.all())
        claimed = sum((claim.final_amount for claim in claims), Decimal("0"))
        received = sum((commission_received(claim) for claim in claims), Decimal("0"))
        shares = [share for claim in claims for share in claim.shares.all()]
        shares_paid = sum((share_paid(share) for share in shares), Decimal("0"))
        totals["claimed"] += claimed
        totals["received"] += received
        totals["shares_paid"] += shares_paid
        file_obj = contract.deal.property_file
        rows.append(
            {
                "id": contract.pk,
                "contract_number": contract.contract_number,
                "status": contract.status,
                "finalized_at": contract.finalized_at.isoformat() if contract.finalized_at else None,
                "deal_type": file_obj.deal_type.display_name if file_obj.deal_type_id else "نامشخص",
                "title": file_obj.title,
                "deal_value": str(contract_base_amount(contract) or 0),
                "claims_count": len(claims),
                "claimed": str(claimed),
                "received": str(received),
                "remaining": str(claimed - received),
                "shares_total": str(sum((share.amount for share in shares), Decimal("0"))),
                "shares_paid": str(shares_paid),
            }
        )
    totals["outstanding"] = totals["claimed"] - totals["received"]
    return {
        "contracts": rows,
        "totals": {key: str(value) for key, value in totals.items()},
        "claim_count": scoped_commission_queryset(user).count(),
        "payment_count": scoped_payment_queryset(user).count(),
    }


def finance_contract_detail(contract, user):
    from django.db.models import Sum

    from .access import scoped_commission_queryset

    claims = list(
        scoped_commission_queryset(user)
        .filter(contract=contract)
        .select_related("policy_version")
        .prefetch_related("shares__beneficiary_user", "allocations__payment")
    )
    claim_ids = [claim.pk for claim in claims]
    payments = (
        models.Payment.objects.filter(
            Q(allocations__commission_id__in=claim_ids)
            | Q(allocations__commission_share__commission_id__in=claim_ids)
        )
        .distinct()
        .prefetch_related("allocations")
        .order_by("-paid_at")
    )
    file_obj = contract.deal.property_file
    policies = models.CommissionPolicyVersion.objects.filter(
        deal_type_id=file_obj.deal_type_id
    ).order_by("version_number")
    debtor_options = [
        {"contact": party.contact_id, "role": party.party_role, "label": f"طرف قرارداد #{index + 1} · {party.party_role}"}
        for index, party in enumerate(contract.parties.all())
    ]
    return {
        "debtor_options": debtor_options,
        "contract": {
            "id": contract.pk,
            "contract_number": contract.contract_number,
            "status": contract.status,
            "deal_value": str(contract_base_amount(contract) or 0),
            "deal_type": file_obj.deal_type.display_name if file_obj.deal_type_id else "نامشخص",
            "title": file_obj.title,
            "terms_snapshot": contract.terms_snapshot,
        },
        "claims": [
            {
                **_claim_row(claim),
                "shares": [_share_row(share) for share in claim.shares.all()],
                "payments": [
                    _payment_row(allocation.payment)
                    for allocation in claim.allocations.all()
                ],
            }
            for claim in claims
        ],
        "payments": [_payment_row(payment) for payment in payments[:200]],
        "policies": [
            {
                "id": policy.pk,
                "name": policy.name,
                "version_number": policy.version_number,
                "status": policy.status,
                "calculation_method": policy.calculation_method,
                "parameters": policy.parameters,
            }
            for policy in policies
        ],
        "totals": {
            "claimed": str(sum((claim.final_amount for claim in claims), Decimal("0"))),
            "received": str(sum((commission_received(claim) for claim in claims), Decimal("0"))),
        },
        "can_manage": has_permission(user, "finance.manage") or user_is_general_manager(user),
        "can_policy": has_permission(user, "finance.policy") or user_is_general_manager(user),
    }
