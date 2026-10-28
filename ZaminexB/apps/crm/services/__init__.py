import hashlib
import json
from datetime import timedelta
from decimal import Decimal

from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.accounts.models import SalesRange, ScopeTransferHistory
from apps.accounts.permissions import has_permission, user_is_general_manager
from apps.accounts.scoping import team_user_ids
from apps.notifications.services import notify_users
from apps.tasks.models import Task

from .. import models
from .supply_workflow import (
    CASE_CONFLICT_DETAIL,
    CaseVersionConflict,
    case_has_locked_contract,
    change_assignee,
    change_case_status,
    create_property_case,
    ensure_case_version,
    explore_listings_queryset,
    mark_duplicate,
    notify_workflow_event,
    parse_dt,
    property_case_stage,
    range_manager_recipients,
    reject_assignment,
    reopen_appraisal,
    review_property,
    save_listing,
    save_workspace,
    set_property_title,
    submit_property_for_review,
)


def workflow_settings():
    return models.WorkflowSettings.load()


def active_sales_range_for_user(user):
    if user_is_general_manager(user):
        return None
    from apps.accounts.scope_memberships import active_memberships

    identifiers = active_memberships().filter(user=user).values_list("sales_range_id", flat=True)
    return SalesRange.objects.filter(pk__in=identifiers).order_by("name", "pk").first()


def active_scope_for_user(user):
    return active_sales_range_for_user(user)


def managed_sales_range_ids(user):
    if user_is_general_manager(user):
        return None
    from apps.accounts.scope_memberships import active_memberships

    return set(active_memberships().filter(user=user, membership_role="MANAGER").values_list("sales_range_id", flat=True))


def user_sales_range_ids(user):
    if user_is_general_manager(user):
        return None
    from apps.accounts.scope_memberships import active_memberships

    return set(active_memberships().filter(user=user).values_list("sales_range_id", flat=True))


def assignable_staff_users(sales_range_id):
    """Active users the server accepts as the responsible consultant of a case in this range.

    ``assign_case`` validates against the sales range itself (its active managers and members) and
    always accepts a general manager, so the picker must offer exactly this set. Reading it from
    scope memberships instead used a different scoping rule and could come back empty for users who
    are still allowed to assign the case.
    """
    from apps.accounts.models import GROUP_GENERAL_MANAGER, User

    ordering = ("first_name", "last_name", "username")
    users = User.objects.filter(is_active=True)
    if sales_range_id:
        sales_range = SalesRange.objects.filter(pk=sales_range_id, is_active=True).first()
        member_ids = set()
        if sales_range is not None:
            member_ids = set(sales_range.managers.values_list("pk", flat=True)) | set(
                sales_range.members.values_list("pk", flat=True)
            )
        members = users.filter(pk__in=member_ids)
        if members.exists():
            return members.distinct().order_by(*ordering)
    # A range without active members (or a case without a range) can only be assigned to a general
    # manager, so that is the fallback instead of an empty picker.
    return users.filter(Q(groups__name=GROUP_GENERAL_MANAGER)).distinct().order_by(*ordering)


def can_manage_sales_range(user, scope_id):
    if user_is_general_manager(user):
        return True
    if scope_id is None:
        return False
    return scope_id in (managed_sales_range_ids(user) or set())


def scope_team_ids(user):
    return team_user_ids(user)


def check_version(instance, payload):
    ensure_case_version(instance, payload)


def record_transition(subject_type, subject_id, from_stage, to_stage, user, reason="", operation_id=""):
    return models.StageTransitionHistory.objects.create(
        subject_type=subject_type,
        subject_id=subject_id,
        from_stage=from_stage or "",
        to_stage=to_stage or "",
        reason=reason or "",
        changed_by=user,
        operation_id=operation_id or "",
    )


def history(subject, action, actor, from_user=None, to_user=None, reason="", old_due_at=None, new_due_at=None):
    values = {
        "action": action,
        "actor": actor,
        "from_user": from_user,
        "to_user": to_user,
        "reason": reason or "",
        "old_due_at": old_due_at,
        "new_due_at": new_due_at,
    }
    if isinstance(subject, models.PropertyRegistrationRequest):
        values["subject_type"] = models.AssignmentHistory.SubjectType.PROPERTY_CASE
        values["property_case"] = subject
    else:
        values["subject_type"] = models.AssignmentHistory.SubjectType.INQUIRY
        values["inquiry"] = subject
    return models.AssignmentHistory.objects.create(**values)


def make_task(title, assigned_to, created_by, due_at, property_obj=None, task_type=Task.TaskType.FOLLOW_UP, description="", property_case=None, inquiry=None):
    if assigned_to is None:
        return None
    due_date = due_at.date() if due_at else timezone.localdate()
    return Task.objects.create(
        title=title,
        description=description or "",
        assigned_to=assigned_to if getattr(assigned_to, "is_active", True) else None,
        created_by=created_by,
        property=property_obj,
        property_case=property_case,
        inquiry=inquiry,
        due_date=due_date,
        task_type=task_type,
    )


def notify(user, title, message, subject_type, subject_id, event_key_prefix=None):
    if user is None:
        return
    notify_users(
        [user],
        notification_type="task_assigned",
        title=title,
        message=message,
        metadata={"subject_type": subject_type, "subject_id": subject_id},
        event_key_prefix=event_key_prefix,
    )


def repair_user_sales_ranges(user):
    """Rebuild the history rows a range's own member lists already imply for this user.

    Reads that ask "which ranges does this user work in" trust ``ScopeMembership``, so a row lost to
    a restored dump or a raw import makes an assigned user look unassigned on every screen. The
    repair is driven by the assignment itself (``SalesRange.managers``/``members``), adds nobody and
    does nothing when the history is already correct.
    """
    from apps.accounts.scope_memberships import reconcile_user_memberships

    return reconcile_user_memberships(user)


def missing_sales_range_message(user):
    """Why a user without an active range cannot own a case, and what fixes it.

    The panel shows this text verbatim, so it names the cause and the exact screen an admin has to
    use. A user who never had a range needs an assignment; a user whose range was deactivated (or
    whose membership ended) needs the existing assignment repaired — the two cases are not the same
    mistake and a single generic sentence hid that from the operator.
    """
    from apps.accounts.models import ScopeMembership

    if ScopeMembership.objects.filter(user=user).exists():
        return (
            "عضویت شما در رنج‌ها فعال نیست (رنج غیرفعال شده یا عضویت شما پایان یافته است)؛ "
            "برای ثبت پرونده با مدیر هماهنگ کنید."
        )
    return (
        "حساب شما به هیچ رنجی متصل نیست؛ برای ثبت پرونده مدیر باید شما را از مسیر "
        "«تنظیمات ← رنج‌ها» به یک رنج فعال اضافه کند."
    )


def resolve_sales_range(user, requested_scope_id):
    if requested_scope_id:
        sales_range = SalesRange.objects.filter(pk=requested_scope_id, is_active=True).first()
        if sales_range is None:
            raise ValidationError({"sales_range": "رنج انتخاب‌شده فعال نیست."})
        if not user_is_general_manager(user) and sales_range.pk not in (user_sales_range_ids(user) or set()):
            raise PermissionDenied("رنج انتخاب‌شده خارج از حوزه شما است.")
        return sales_range
    sales_range = active_sales_range_for_user(user)
    if sales_range is None and not user_is_general_manager(user):
        # A range that already lists this user is an assignment; only its history row is missing
        # (restored dump, raw import). Repair it instead of reporting the user as unassigned.
        sales_range = repair_user_sales_ranges(user)
    if sales_range is None and not user_is_general_manager(user):
        raise ValidationError({"sales_range": missing_sales_range_message(user)})
    return sales_range


def subject_kind(subject):
    return "PROPERTY_CASE" if isinstance(subject, models.PropertyRegistrationRequest) else "INQUIRY"


def accept_lead(subject, user, payload=None):
    ensure_case_version(subject, payload)
    if not (user_is_general_manager(user) or can_manage_sales_range(user, subject.sales_range_id)):
        raise PermissionDenied("شما اجازه پذیرش این سرنخ را ندارید.")
    if subject.lead_status == models.LeadStatus.ACCEPTED:
        return subject
    old = subject.lead_status
    subject.lead_status = models.LeadStatus.ACCEPTED
    subject.lead_accepted_by = user
    subject.lead_accepted_at = timezone.now()
    subject.version += 1
    subject.save(update_fields=["lead_status", "lead_accepted_by", "lead_accepted_at", "version", "updated_at"])
    record_transition(subject_kind(subject), subject.pk, old, subject.lead_status, user)
    Task.objects.filter(assigned_to=user, title__contains=subject.code, status=Task.Status.PENDING).update(
        status=Task.Status.COMPLETED, completed_at=timezone.now()
    )
    return subject


def assign_case(subject, user, assignee, due_at, reason="", payload=None, require_explicit_due=False):
    ensure_case_version(subject, payload)
    if subject.lead_status != models.LeadStatus.ACCEPTED:
        raise ValidationError({"lead_status": "ابتدا پذیرش مدیر باید انجام شود."})
    if subject.status != models.CaseStatus.ACTIVE:
        raise ValidationError({"status": "پرونده فعال نیست."})
    if not (user_is_general_manager(user) or can_manage_sales_range(user, subject.sales_range_id)):
        raise PermissionDenied("شما اجازه ارجاع این پرونده را ندارید.")
    if assignee is None or not assignee.is_active:
        raise ValidationError({"assigned_to": "مسئول انتخاب‌شده فعال نیست."})
    member = bool(
        subject.sales_range_id
        and SalesRange.objects.filter(pk=subject.sales_range_id, is_active=True)
        .filter(Q(members=assignee) | Q(managers=assignee))
        .exists()
    )
    if not member and not user_is_general_manager(assignee):
        raise ValidationError({"assigned_to": "مسئول انتخاب‌شده عضو فعال این رنج نیست."})
    if due_at is None:
        if require_explicit_due:
            raise ValidationError({"due_at": "انتخاب موعد انجام برای ارجاع الزامی است."})
        due_at = timezone.now() + timedelta(days=workflow_settings().default_assignment_due_days)
    else:
        due_at = parse_dt(due_at, "due_at", required=True)
    if due_at <= timezone.now():
        raise ValidationError({"due_at": "موعد انجام باید در آینده باشد."})
    if subject.acceptance_status == models.AcceptanceStatus.WITHDRAWAL_PENDING:
        raise ValidationError({"acceptance_status": "درخواست انصراف در انتظار تصمیم است."})
    if subject.acceptance_status == models.AcceptanceStatus.PENDING and subject.assigned_at:
        waiting_hours = workflow_settings().assignment_waiting_hours
        if timezone.now() < subject.assigned_at + timedelta(hours=waiting_hours) and subject.assigned_to_id != assignee.pk:
            raise ValidationError({"assigned_to": f"ارجاع بدون پاسخ تا {waiting_hours} ساعت قابل تغییر نیست."})
    if subject.acceptance_status == models.AcceptanceStatus.ACCEPTED and subject.assigned_to_id != assignee.pk:
        raise ValidationError({"assigned_to": "برای تغییر مسئول پذیرفته‌شده ابتدا انصراف باید تأیید شود یا از تغییر مسئول استفاده شود."})
    previous = subject.assigned_to
    subject.assigned_to = assignee
    subject.assigned_at = timezone.now()
    subject.accepted_at = None
    subject.due_at = due_at
    subject.acceptance_status = models.AcceptanceStatus.PENDING
    subject.version += 1
    subject.save(
        update_fields=["assigned_to", "assigned_at", "accepted_at", "due_at", "acceptance_status", "version", "updated_at"]
    )
    subject.reschedule_requests.filter(status=models.AssignmentRescheduleRequest.Status.PENDING).update(
        status=models.AssignmentRescheduleRequest.Status.CANCELLED
    )
    subject.withdrawal_requests.filter(status=models.ConsultantWithdrawalRequest.Status.PENDING).update(
        status=models.ConsultantWithdrawalRequest.Status.CANCELLED
    )
    history(subject, models.AssignmentHistory.Action.ASSIGNED, user, from_user=previous, to_user=assignee, reason=reason, new_due_at=due_at)
    make_task(
        f"پذیرش ارجاع {subject.code}",
        assignee,
        user,
        due_at,
        getattr(subject, "resulting_property", None),
        property_case=subject if isinstance(subject, models.PropertyRegistrationRequest) else None,
    )
    notify(
        assignee,
        "ارجاع جدید",
        f"پرونده {subject.code} به شما ارجاع شد.",
        subject_kind(subject),
        subject.pk,
        event_key_prefix=f"case-assign:{subject_kind(subject)}:{subject.pk}:v{subject.version}",
    )
    return subject


def accept_assignment(subject, user, payload=None):
    ensure_case_version(subject, payload)
    if subject.assigned_to_id != user.pk:
        raise PermissionDenied("فقط مسئول فعلی می‌تواند ارجاع را بپذیرد.")
    if subject.acceptance_status != models.AcceptanceStatus.PENDING:
        raise ValidationError({"acceptance_status": "این ارجاع در انتظار پذیرش نیست."})
    subject.acceptance_status = models.AcceptanceStatus.ACCEPTED
    subject.accepted_at = timezone.now()
    subject.version += 1
    subject.save(update_fields=["acceptance_status", "accepted_at", "version", "updated_at"])
    Task.objects.filter(assigned_to=user, title__contains=subject.code, status=Task.Status.PENDING).update(
        status=Task.Status.COMPLETED, completed_at=timezone.now()
    )
    history(subject, models.AssignmentHistory.Action.ACCEPTED, user, to_user=user)
    if isinstance(subject, models.PropertyRegistrationRequest):
        models.PropertyAppraisal.objects.get_or_create(registration_request=subject)
    return subject


def request_withdrawal(subject, user, reason, payload=None):
    ensure_case_version(subject, payload)
    if subject.assigned_to_id != user.pk:
        raise PermissionDenied("فقط مسئول فعلی می‌تواند درخواست انصراف بدهد.")
    if subject.acceptance_status not in (models.AcceptanceStatus.PENDING, models.AcceptanceStatus.ACCEPTED):
        raise ValidationError({"acceptance_status": "برای این پرونده ارجاع فعالی وجود ندارد."})
    if subject.withdrawal_requests.filter(status=models.ConsultantWithdrawalRequest.Status.PENDING).exists():
        raise ValidationError({"reason": "درخواست انصراف در انتظار تصمیم وجود دارد."})
    req = models.ConsultantWithdrawalRequest.objects.create(
        property_case=subject if isinstance(subject, models.PropertyRegistrationRequest) else None,
        inquiry=subject if isinstance(subject, models.Inquiry) else None,
        requested_by=user,
        reason=reason or "",
    )
    old = subject.acceptance_status
    subject.acceptance_status = models.AcceptanceStatus.WITHDRAWAL_PENDING
    subject.version += 1
    subject.save(update_fields=["acceptance_status", "version", "updated_at"])
    history(subject, models.AssignmentHistory.Action.WITHDRAWAL_REQUESTED, user, to_user=user, reason=reason)
    record_transition(subject_kind(subject), subject.pk, old, subject.acceptance_status, user, reason)
    managers = range_manager_recipients(subject.sales_range)
    notify_workflow_event(
        managers,
        title="درخواست انصراف",
        message=f"برای پرونده {subject.code} درخواست انصراف ثبت شد.",
        metadata={"subject_type": subject_kind(subject), "subject_id": subject.pk, "request_id": req.pk},
        event_key_prefix=f"case-withdrawal-req:{req.pk}",
    )
    return req


def sales_range_managers(sales_range):
    if sales_range is None:
        return []
    return list(sales_range.managers.filter(is_active=True))


def review_withdrawal(req, user, approve, reason=""):
    subject = req.property_case or req.inquiry
    if subject is None:
        raise ValidationError({"detail": "موضوع درخواست مشخص نیست."})
    if req.status != models.ConsultantWithdrawalRequest.Status.PENDING:
        raise ValidationError({"status": "این درخواست قبلاً تعیین تکلیف شده است."})
    if not (user_is_general_manager(user) or can_manage_sales_range(user, subject.sales_range_id)):
        raise PermissionDenied("شما اجازه تصمیم درباره این انصراف را ندارید.")
    if subject.assigned_to_id != req.requested_by_id:
        raise ValidationError({"requested_by": "مسئول پرونده از زمان درخواست تغییر کرده است."})
    if workflow_settings().withdrawal_decision_note_required and not (reason or "").strip():
        raise ValidationError({"reason": "ثبت دلیل تصمیم انصراف الزامی است."})
    req.status = (
        models.ConsultantWithdrawalRequest.Status.APPROVED
        if approve
        else models.ConsultantWithdrawalRequest.Status.REJECTED
    )
    req.decided_by = user
    req.decided_at = timezone.now()
    req.decision_reason = reason or ""
    req.save(update_fields=["status", "decided_by", "decided_at", "decision_reason"])
    if approve:
        previous = subject.assigned_to
        subject.assigned_to = None
        subject.assigned_at = None
        subject.accepted_at = None
        subject.due_at = None
        subject.acceptance_status = models.AcceptanceStatus.UNASSIGNED
        subject.reschedule_requests.filter(status=models.AssignmentRescheduleRequest.Status.PENDING).update(
            status=models.AssignmentRescheduleRequest.Status.CANCELLED
        )
        history(subject, models.AssignmentHistory.Action.WITHDRAWAL_APPROVED, user, from_user=previous, reason=reason)
    else:
        subject.acceptance_status = (
            models.AcceptanceStatus.ACCEPTED if subject.accepted_at else models.AcceptanceStatus.PENDING
        )
        history(subject, models.AssignmentHistory.Action.WITHDRAWAL_REJECTED, user, from_user=subject.assigned_to, reason=reason)
    subject.version += 1
    subject.save(update_fields=["assigned_to", "assigned_at", "accepted_at", "due_at", "acceptance_status", "version", "updated_at"])
    if req.requested_by:
        notify_workflow_event(
            [req.requested_by],
            title="نتیجه درخواست انصراف",
            message=f"درخواست انصراف پرونده {subject.code} {'تأیید' if approve else 'رد'} شد.",
            metadata={"subject_type": subject_kind(subject), "subject_id": subject.pk, "request_id": req.pk, "status": req.status},
            event_key_prefix=f"case-withdrawal-decision:{req.pk}:{req.status}",
        )
    return req


decide_withdrawal = review_withdrawal


def request_extension(subject, user, requested_due_at, reason, payload=None):
    ensure_case_version(subject, payload)
    if subject.assigned_to_id != user.pk:
        raise PermissionDenied("فقط مسئول فعلی می‌تواند درخواست تمدید بدهد.")
    if subject.acceptance_status != models.AcceptanceStatus.ACCEPTED:
        raise ValidationError({"acceptance_status": "تمدید فقط پس از پذیرش مسئول ممکن است."})
    if not subject.due_at or timezone.now() <= subject.due_at:
        raise ValidationError({"due_at": "تمدید فقط پس از پایان موعد فعلی ممکن است."})
    parsed_due = parse_dt(requested_due_at, "requested_due_at", required=True)
    if parsed_due <= timezone.now():
        raise ValidationError({"requested_due_at": "موعد پیشنهادی باید در آینده باشد."})
    if subject.reschedule_requests.filter(status=models.AssignmentRescheduleRequest.Status.PENDING).exists():
        raise ValidationError({"requested_due_at": "درخواست تمدید در انتظار تصمیم وجود دارد."})
    req = models.AssignmentRescheduleRequest.objects.create(
        property_case=subject if isinstance(subject, models.PropertyRegistrationRequest) else None,
        inquiry=subject if isinstance(subject, models.Inquiry) else None,
        requested_by=user,
        requested_due_at=parsed_due,
        reason=reason or "",
    )
    subject.version += 1
    subject.save(update_fields=["version", "updated_at"])
    history(subject, models.AssignmentHistory.Action.EXTENSION_REQUESTED, user, to_user=user, reason=reason, old_due_at=subject.due_at, new_due_at=parsed_due)
    managers = range_manager_recipients(subject.sales_range)
    notify_workflow_event(
        managers,
        title="درخواست تمدید",
        message=f"برای پرونده {subject.code} درخواست تمدید ثبت شد.",
        metadata={"subject_type": subject_kind(subject), "subject_id": subject.pk, "request_id": req.pk},
        event_key_prefix=f"case-extension-req:{req.pk}",
    )
    return req


def review_extension(req, user, approve, reason="", new_due_at=None):
    subject = req.property_case or req.inquiry
    if subject is None:
        raise ValidationError({"detail": "موضوع درخواست مشخص نیست."})
    if req.status != models.AssignmentRescheduleRequest.Status.PENDING:
        raise ValidationError({"status": "این درخواست قبلاً تعیین تکلیف شده است."})
    if not (user_is_general_manager(user) or can_manage_sales_range(user, subject.sales_range_id)):
        raise PermissionDenied("شما اجازه تصمیم درباره این تمدید را ندارید.")
    if workflow_settings().extension_decision_note_required and not (reason or "").strip():
        raise ValidationError({"reason": "ثبت دلیل تصمیم تمدید الزامی است."})
    final_due = parse_dt(new_due_at, "new_due_at", required=False) if new_due_at not in (None, "") else req.requested_due_at
    if approve and final_due <= timezone.now():
        raise ValidationError({"new_due_at": "موعد جدید باید در آینده باشد."})
    req.status = (
        models.AssignmentRescheduleRequest.Status.APPROVED
        if approve
        else models.AssignmentRescheduleRequest.Status.REJECTED
    )
    req.decided_by = user
    req.decided_at = timezone.now()
    req.decision_reason = reason or ""
    req.save(update_fields=["status", "decided_by", "decided_at", "decision_reason"])
    if approve:
        old_due = subject.due_at
        subject.due_at = final_due
        subject.version += 1
        subject.save(update_fields=["due_at", "version", "updated_at"])
        history(subject, models.AssignmentHistory.Action.EXTENSION_APPROVED, user, reason=reason, old_due_at=old_due, new_due_at=final_due)
    else:
        subject.version += 1
        subject.save(update_fields=["version", "updated_at"])
        history(subject, models.AssignmentHistory.Action.EXTENSION_REJECTED, user, reason=reason, old_due_at=subject.due_at, new_due_at=req.requested_due_at)
    if req.requested_by:
        notify_workflow_event(
            [req.requested_by],
            title="نتیجه درخواست تمدید",
            message=f"درخواست تمدید پرونده {subject.code} {'تأیید' if approve else 'رد'} شد.",
            metadata={"subject_type": subject_kind(subject), "subject_id": subject.pk, "request_id": req.pk, "status": req.status},
            event_key_prefix=f"case-extension-decision:{req.pk}:{req.status}",
        )
    return req


decide_extension = review_extension


def transfer_sales_range(subject, user, new_sales_range, reason="", payload=None):
    ensure_case_version(subject, payload)
    if not (user_is_general_manager(user) or can_manage_sales_range(user, subject.sales_range_id)):
        raise PermissionDenied("شما اجازه انتقال این پرونده را ندارید.")
    if new_sales_range is None or not new_sales_range.is_active:
        raise ValidationError({"sales_range": "رنج مقصد فعال نیست."})
    if new_sales_range.pk == subject.sales_range_id:
        raise ValidationError({"sales_range": "پرونده از قبل در این رنج قرار دارد."})
    if not user_is_general_manager(user) and not can_manage_sales_range(user, new_sales_range.pk):
        raise PermissionDenied("رنج مقصد خارج از حوزه مدیریتی شما است.")
    old_sales_range = subject.sales_range
    subject.sales_range = new_sales_range
    subject.assigned_to = None
    subject.assigned_at = None
    subject.accepted_at = None
    subject.due_at = None
    subject.acceptance_status = models.AcceptanceStatus.UNASSIGNED
    subject.version += 1
    subject.save(update_fields=["sales_range", "assigned_to", "assigned_at", "accepted_at", "due_at", "acceptance_status", "version", "updated_at"])
    subject.reschedule_requests.filter(status=models.AssignmentRescheduleRequest.Status.PENDING).update(
        status=models.AssignmentRescheduleRequest.Status.CANCELLED
    )
    subject.withdrawal_requests.filter(status=models.ConsultantWithdrawalRequest.Status.PENDING).update(
        status=models.ConsultantWithdrawalRequest.Status.CANCELLED
    )
    ScopeTransferHistory.objects.create(
        subject_type=ScopeTransferHistory.SubjectType.PROPERTY_CASE if isinstance(subject, models.PropertyRegistrationRequest) else ScopeTransferHistory.SubjectType.INQUIRY,
        subject_id=subject.pk,
        from_sales_range=old_sales_range,
        to_sales_range=new_sales_range,
        actor=user,
        reason=reason or "",
    )
    history(subject, models.AssignmentHistory.Action.SCOPE_TRANSFERRED, user, reason=reason)
    if isinstance(subject, models.PropertyRegistrationRequest) and subject.resulting_property_id:
        prop = subject.resulting_property
        record_transition("PROPERTY", prop.pk, "", "", user, reason)
    return subject


transfer_scope = transfer_sales_range


def case_visibility_filter(user, relation):
    if user_is_general_manager(user):
        return Q(**{f"{relation}__isnull": True}) | Q(**{f"{relation}__isnull": False})
    if not has_permission(user, "case.view"):
        return Q(**{f"{relation}__isnull": True})

    ids = scope_team_ids(user)
    if ids is None:
        return Q()
    visible = Q(**{f"{relation}__created_by_id__in": ids}) | Q(
        **{f"{relation}__assigned_to_id__in": ids}
    )
    managed_ids = managed_sales_range_ids(user)
    if managed_ids:
        visible |= Q(**{f"{relation}__sales_range_id__in": managed_ids})
    return visible


def can_view_case(user, subject):
    if user_is_general_manager(user):
        return True
    if not has_permission(user, "case.view"):
        return False
    if subject.created_by_id == user.pk or subject.assigned_to_id == user.pk:
        return True
    managed_ids = managed_sales_range_ids(user)
    if subject.sales_range_id and managed_ids and subject.sales_range_id in managed_ids:
        return True
    ids = scope_team_ids(user)
    if ids is None:
        return True
    return subject.created_by_id in ids or subject.assigned_to_id in ids


def can_view_inquiry(user, inquiry):
    return can_view_case(user, inquiry)


def request_hash(payload):
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def idempotent_result(user, action, key, payload):
    if not key:
        return None
    receipt = models.CommandReceipt.objects.filter(actor=user, action=action, idempotency_key=key).first()
    if receipt is None:
        return None
    if receipt.request_hash != request_hash(payload):
        raise ValidationError({"idempotency_key": "این کلید قبلاً با درخواست دیگری استفاده شده است."})
    return receipt.result


def save_receipt(user, action, key, payload, result):
    if not key:
        return
    models.CommandReceipt.objects.update_or_create(
        actor=user,
        action=action,
        idempotency_key=key,
        defaults={"request_hash": request_hash(payload), "result": result},
    )


def property_file_snapshot(property_file):
    return {
        "property_file_id": property_file.pk,
        "listing_id": property_file.pk,
        "deal_type_id": property_file.deal_type_id,
        "deal_type_version_id": property_file.deal_type_version_id,
        "sale_price": str(property_file.sale_price) if property_file.sale_price is not None else None,
        "deposit": str(property_file.deposit) if property_file.deposit is not None else None,
        "monthly_rent": str(property_file.monthly_rent) if property_file.monthly_rent is not None else None,
        "price_details": property_file.price_details or {},
        "status": property_file.status,
    }


def match_inquiry(inquiry, user=None):
    from apps.listings.models import PropertyFile
    from apps.properties.models import Property

    results = []
    prefs = list(inquiry.preferences.all().prefetch_related("districts", "property_types"))
    listings = PropertyFile.objects.filter(
        status=PropertyFile.Status.ACTIVE,
        property__review_status=Property.ReviewStatus.APPROVED,
    )
    if user is not None and not user_is_general_manager(user):
        ids = scope_team_ids(user) or set()
        scope_ids = user_sales_range_ids(user) or set()
        scope = Q(assigned_to_id__in=ids) | Q(property__consultant_id__in=ids)
        if scope_ids:
            scope |= Q(property__registration_case__sales_range_id__in=scope_ids)
        listings = listings.filter(scope).distinct()
    listings = listings.select_related("property", "deal_type").order_by("-created_at")
    for property_file in listings:
        pref = next((p for p in prefs if p.deal_type_id == property_file.deal_type_id), None)
        reasons = []
        blockers = []
        if pref is None:
            blockers.append("نوع معامله در نیاز متقاضی نیست")
        else:
            if pref.districts.exists() and property_file.property.district_id not in set(pref.districts.values_list("id", flat=True)):
                blockers.append("منطقه با مناطق مطلوب منطبق نیست")
            elif pref.districts.exists():
                reasons.append("منطقه منطبق است")
            if pref.property_types.exists() and property_file.property.property_type_ref_id not in set(pref.property_types.values_list("id", flat=True)):
                blockers.append("نوع ملک با انواع مطلوب منطبق نیست")
            elif pref.property_types.exists():
                reasons.append("نوع ملک منطبق است")
            if pref.min_area and property_file.property.area < pref.min_area:
                blockers.append("متراژ کمتر از حداقل نیاز است")
            if pref.max_area and property_file.property.area > pref.max_area:
                blockers.append("متراژ بیشتر از حداکثر نیاز است")
            if pref.min_area or pref.max_area:
                if not any("متراژ" in b for b in blockers):
                    reasons.append("متراژ در بازه نیاز است")
            criteria = pref.criteria or {}
            for key in criteria.get("required", []) if isinstance(criteria, dict) else []:
                blockers.append(f"شرط ضروری بررسی‌نشده: {key}")
            if property_file.sale_price is not None and pref.max_amount is not None and property_file.sale_price > pref.max_amount:
                blockers.append("قیمت فروش بیشتر از بودجه است")
            if property_file.deposit is not None and pref.max_deposit is not None and property_file.deposit > pref.max_deposit:
                blockers.append("ودیعه بیشتر از بودجه است")
            if property_file.monthly_rent is not None and pref.max_monthly_rent is not None and property_file.monthly_rent > pref.max_monthly_rent:
                blockers.append("اجاره ماهانه بیشتر از بودجه است")
            if not blockers:
                reasons.append("بودجه و شرایط اصلی منطبق است")
        results.append(
            {
                "property_file_id": property_file.pk,
                "listing_id": property_file.pk,
                "property_id": property_file.property_id,
                "title": property_file.title,
                "matched": not blockers,
                "reasons": reasons,
                "blockers": blockers,
                "snapshot": property_file_snapshot(property_file),
            }
        )
    results.sort(key=lambda item: (not item["matched"], item["property_file_id"]))
    return results


def commission_amount(policy, base_amount):
    params = policy.parameters or {}
    if policy.calculation_method == models.CommissionPolicyVersion.CalculationMethod.PERCENT:
        percent = Decimal(str(params.get("percent", "0")))
        return (Decimal(base_amount or 0) * percent / Decimal("100")).quantize(Decimal("1"))
    return Decimal(str(params.get("flat_amount", "0"))).quantize(Decimal("1"))


def refresh_commission_status(commission):
    from django.db.models import Sum

    received = commission.allocations.filter(
        payment__status__in=(models.Payment.Status.CONFIRMED, models.Payment.Status.REVERSED),
        payment__direction=models.Payment.Direction.IN,
    ).aggregate(total=Sum("amount"))["total"] or Decimal("0")
    if received <= 0:
        status_value = commission.status if commission.status == models.Commission.Status.APPROVED else models.Commission.Status.PENDING
        if commission.status in (models.Commission.Status.PARTIALLY_PAID, models.Commission.Status.PAID):
            status_value = models.Commission.Status.APPROVED
    elif received < commission.final_amount:
        status_value = models.Commission.Status.PARTIALLY_PAID
    else:
        status_value = models.Commission.Status.PAID
    if commission.status != status_value:
        commission.status = status_value
        commission.save(update_fields=["status", "updated_at"])
    return commission


def refresh_share_status(share):
    from django.db.models import Sum

    paid = share.allocations.filter(
        payment__status__in=(models.Payment.Status.CONFIRMED, models.Payment.Status.REVERSED)
    ).aggregate(total=Sum("amount"))["total"] or Decimal("0")
    if paid <= 0:
        status_value = share.status if share.status == models.CommissionShare.Status.APPROVED else models.CommissionShare.Status.PENDING
        if share.status in (models.CommissionShare.Status.PARTIALLY_PAID, models.CommissionShare.Status.PAID):
            status_value = models.CommissionShare.Status.APPROVED
    elif paid < share.amount:
        status_value = share.status
        if share.status != models.CommissionShare.Status.PARTIALLY_PAID:
            status_value = models.CommissionShare.Status.PARTIALLY_PAID
    else:
        status_value = models.CommissionShare.Status.PAID
    if share.status != status_value:
        share.status = status_value
        share.save(update_fields=["status"])
    return share


def allocated_total(allocations):
    total = Decimal("0")
    for item in allocations:
        total += Decimal(str(item.get("amount") or 0))
    return total


managed_scope_ids = managed_sales_range_ids
user_scope_ids = user_sales_range_ids
can_manage_scope = can_manage_sales_range
resolve_scope = resolve_sales_range
scope_managers = sales_range_managers
transfer_scope = transfer_sales_range
listing_snapshot = property_file_snapshot


from . import finance_workflow

from . import pipeline_board
