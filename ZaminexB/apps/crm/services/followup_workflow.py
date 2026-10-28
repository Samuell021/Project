from __future__ import annotations

from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounts.permissions import require_permission, user_is_general_manager
from apps.crm.models import Inquiry, PropertyRegistrationRequest
from apps.crm.services import can_view_case, make_task
from apps.followups.models import FollowUp, FollowUpStatus, FollowUpType
from apps.tasks.models import Task

from .supply_workflow import ensure_case_version, parse_dt


SUBJECT_FIELDS = {"inquiry": Inquiry, "property_case": PropertyRegistrationRequest}


def _subject(data, instance=None):
    inquiry = data.get("inquiry", getattr(instance, "inquiry", None))
    property_case = data.get("property_case", getattr(instance, "property_case", None))
    if inquiry and property_case:
        raise ValidationError({"inquiry": "پیگیری فقط به یک پرونده یا درخواست متصل می‌شود."})
    if inquiry:
        return "inquiry", inquiry
    if property_case:
        return "property_case", property_case
    return None, None


def _contact_name(subject):
    contact = getattr(subject, "contact", None)
    return contact.full_name if contact else ""


def _check_subject(user, subject):
    if subject is not None and not can_view_case(user, subject):
        raise PermissionDenied("شما به پرونده مرتبط با این پیگیری دسترسی ندارید.")


def _notify(user, title, message, followup):
    from apps.notifications.services import notify_users

    notify_users(
        [user],
        notification_type="followup_created",
        title=title,
        message=message,
        metadata={"subject_type": "FOLLOWUP", "subject_id": followup.pk},
        event_key_prefix=f"followup:{followup.pk}:{title}",
    )


def create_follow_up(user, data):
    require_permission(user, "followup.manage", "شما اجازه ثبت پیگیری را ندارید.")
    title = str(data.get("title") or "").strip()
    if not title:
        raise ValidationError({"title": "موضوع پیگیری الزامی است."})
    scheduled_at = parse_dt(data.get("scheduled_at") or data.get("date"), "scheduled_at", required=True)
    follow_up_type = str(data.get("follow_up_type") or data.get("type") or FollowUpType.CALL)
    if follow_up_type not in FollowUpType.values:
        raise ValidationError({"type": "نوع پیگیری معتبر نیست."})
    kind, subject = _subject(data)
    _check_subject(user, subject)
    consultant = data.get("consultant") or user
    if not getattr(consultant, "is_active", True):
        raise ValidationError({"consultant": "کارشناس انتخاب‌شده فعال نیست."})
    followup = FollowUp.objects.create(
        title=title[:255],
        follow_up_type=follow_up_type,
        contact_name=str(data.get("contact_name") or _contact_name(subject))[:255],
        scheduled_at=scheduled_at,
        consultant=consultant,
        property=data.get("property"),
        property_case=subject if kind == "property_case" else None,
        inquiry=subject if kind == "inquiry" else None,
        notes=str(data.get("notes") or "")[:5000],
        probability=data.get("probability"),
    )
    make_task(
        f"پیگیری: {followup.title}",
        consultant,
        user,
        scheduled_at,
        property_obj=followup.property,
        task_type=Task.TaskType.FOLLOW_UP,
        inquiry=followup.inquiry,
        property_case=followup.property_case,
    )
    _notify(consultant, "پیگیری جدید", f"پیگیری «{followup.title}» ثبت شد.", followup)
    return followup, True


def reschedule_follow_up(followup_id, user, data):
    require_permission(user, "followup.manage", "شما اجازه تغییر پیگیری را ندارید.")
    followup = FollowUp.objects.select_for_update(of=("self",)).select_related("inquiry", "property_case").get(pk=followup_id)
    if not user_is_general_manager(user) and followup.consultant_id != user.pk:
        raise PermissionDenied("فقط مسئول پیگیری یا مدیر کل می‌تواند موعد را تغییر دهد.")
    ensure_case_version(followup, data)
    scheduled_at = parse_dt(data.get("scheduled_at") or data.get("date"), "scheduled_at", required=True)
    reason = str(data.get("reason") or "").strip()
    if not reason:
        raise ValidationError({"reason": "دلیل تعویق الزامی است."})
    if followup.status == FollowUpStatus.COMPLETED:
        raise ValidationError({"status": "پیگیری تکمیل‌شده قابل تعویق نیست."})
    history = list(followup.reschedule_history or [])
    history.append(
        {
            "from": followup.scheduled_at.isoformat(),
            "to": scheduled_at.isoformat(),
            "reason": reason[:2000],
            "by": user.pk,
            "at": timezone.now().isoformat(),
        }
    )
    followup.reschedule_history = history
    followup.scheduled_at = scheduled_at
    followup.version += 1
    followup.save(update_fields=["reschedule_history", "scheduled_at", "version", "updated_at"])
    Task.objects.filter(
        inquiry=followup.inquiry,
        property_case=followup.property_case,
        task_type=Task.TaskType.FOLLOW_UP,
        status=Task.Status.PENDING,
        title=f"پیگیری: {followup.title}",
    ).update(due_date=scheduled_at.date())
    return followup, True


def complete_follow_up(followup_id, user, data):
    require_permission(user, "followup.manage", "شما اجازه تکمیل پیگیری را ندارید.")
    followup = FollowUp.objects.select_for_update(of=("self",)).select_related("inquiry", "property_case").get(pk=followup_id)
    if not user_is_general_manager(user) and followup.consultant_id != user.pk:
        participants = {followup.inquiry.assigned_to_id if followup.inquiry else None} - {None}
        if user.pk not in participants:
            raise PermissionDenied("فقط مسئول پیگیری یا مدیر کل می‌تواند نتیجه را ثبت کند.")
    ensure_case_version(followup, data)
    if followup.status == FollowUpStatus.COMPLETED:
        return followup, False, None
    outcome = str(data.get("outcome") or "").strip()
    if not outcome:
        raise ValidationError({"outcome": "ثبت نتیجه پیگیری الزامی است."})
    next_action = str(data.get("next_action") or "").strip()
    next_action_at = parse_dt(data.get("next_action_at"), "next_action_at", required=False)
    if bool(next_action) != bool(next_action_at):
        raise ValidationError({"next_action": "اقدام بعدی و موعد آن باید با هم ثبت شوند."})
    followup.outcome = outcome[:5000]
    followup.next_action = next_action[:255]
    followup.next_action_at = next_action_at
    followup.status = FollowUpStatus.COMPLETED
    followup.completed_at = timezone.now()
    followup.version += 1
    followup.save(update_fields=["outcome", "next_action", "next_action_at", "status", "completed_at", "version", "updated_at"])
    Task.objects.filter(
        inquiry=followup.inquiry,
        property_case=followup.property_case,
        task_type=Task.TaskType.FOLLOW_UP,
        status=Task.Status.PENDING,
        title=f"پیگیری: {followup.title}",
    ).update(status=Task.Status.COMPLETED, completed_at=timezone.now())
    created = None
    if next_action:
        created = FollowUp.objects.create(
            title=next_action[:255],
            follow_up_type=followup.follow_up_type,
            contact_name=followup.contact_name,
            scheduled_at=next_action_at,
            consultant=followup.consultant,
            property=followup.property,
            property_case=followup.property_case,
            inquiry=followup.inquiry,
            notes=str(data.get("next_action_notes") or "")[:5000],
        )
        make_task(
            f"پیگیری: {created.title}",
            followup.consultant,
            user,
            next_action_at,
            property_obj=followup.property,
            task_type=Task.TaskType.FOLLOW_UP,
            inquiry=followup.inquiry,
            property_case=followup.property_case,
        )
        _notify(followup.consultant, "اقدام بعدی پیگیری", f"پیگیری «{created.title}» برنامه‌ریزی شد.", created)
    return followup, True, created
