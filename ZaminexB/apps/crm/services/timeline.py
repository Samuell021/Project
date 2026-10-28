from datetime import datetime, time

from django.db.models import Max
from django.utils import timezone

from apps.activity.models import ActivityLog

from .. import models


def latest_stage_at(subject_type, subject_id):
    return (
        models.StageTransitionHistory.objects.filter(
            subject_type=subject_type, subject_id=subject_id
        )
        .order_by("-changed_at")
        .values_list("changed_at", flat=True)
        .first()
    )


def latest_stage_map(subject_type, subject_ids):
    if not subject_ids:
        return {}
    rows = (
        models.StageTransitionHistory.objects.filter(
            subject_type=subject_type, subject_id__in=subject_ids
        )
        .values("subject_id")
        .annotate(last=Max("changed_at"))
    )
    return {row["subject_id"]: row["last"] for row in rows}


def activity_count(user, day):
    start = timezone.make_aware(datetime.combine(day, time.min))
    end = timezone.make_aware(datetime.combine(day, time.max))
    return ActivityLog.objects.filter(user=user, created_at__range=(start, end)).count()


def activity_timeline(queryset, limit=100):
    return list(
        queryset.select_related("user")
        .order_by("-created_at")[:limit]
        .values(
            "id",
            "action",
            "target_type",
            "target_id",
            "description",
            "created_at",
            "user__first_name",
            "user__last_name",
            "user__username",
        )
    )
