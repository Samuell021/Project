from __future__ import annotations

import datetime
from decimal import Decimal
from typing import Any

from django.db.models import Count, Q
from django.utils import timezone

from apps.followups.models import FollowUp, FollowUpStatus
from apps.listings.models import PropertyFile
from apps.properties.models import Property, PropertyImage
from apps.tasks.models import Task

IRAN_LAT_MIN = Decimal("25")
IRAN_LAT_MAX = Decimal("40")
IRAN_LON_MIN = Decimal("44")
IRAN_LON_MAX = Decimal("64")

HIGH_PROBABILITY_THRESHOLD = 70
ENGAGEMENT_WINDOW_DAYS = 30
CLOSED_DEALS_WINDOW_DAYS = 90
COMPLETED_WORK_WINDOW_DAYS = 30

TASK_TYPE_WEIGHTS = {
    Task.TaskType.VIEWING: 3,
    Task.TaskType.SITE_VISIT: 3,
    Task.TaskType.NEGOTIATION: 2,
    Task.TaskType.CONTRACT: 2,
}


def _today() -> datetime.date:
    return timezone.now().date()


def _days_between(start: datetime.date | datetime.datetime, end: datetime.date | None = None) -> int:
    if isinstance(start, datetime.datetime):
        start = start.date()
    end = end or _today()
    if isinstance(end, datetime.datetime):
        end = end.date()
    return max(0, (end - start).days)


def price_per_sqm(price: Decimal | int | float | None, area: int | None) -> float | None:
    if not area or not price:
        return None
    return round(float(price) / float(area), 2)


SALE_LIKE_DEAL_TYPES = {"sale", "presale", "exchange", "partnership"}


def _property_file_sale_price(property_file: PropertyFile) -> Decimal | None:
    """The comparable sale figure of one property_file, if it has one."""
    if property_file.sale_price is None:
        return None
    deal = getattr(property_file, "deal_type", None)
    if deal is not None and deal.name not in SALE_LIKE_DEAL_TYPES:
        return None
    return property_file.sale_price


def effective_sale_price(property_obj: Property) -> Decimal | None:
    listings = property_obj.property_files.all()

    prices = [p for p in (_property_file_sale_price(x) for x in listings) if p is not None]
    if prices:
        return max(prices)

    return None


def annotate_effective_prices(properties) -> dict[int, Decimal]:
    from django.db.models import Max, Q

    ids = [p.id if hasattr(p, "id") else p for p in properties]
    if not ids:
        return {}

    rows = (
        PropertyFile.objects.filter(property_id__in=ids, sale_price__isnull=False)
        .filter(Q(deal_type__isnull=True) | Q(deal_type__name__in=SALE_LIKE_DEAL_TYPES))
        .values("property_id")
        .annotate(best=Max("sale_price"))
    )
    return {row["property_id"]: row["best"] for row in rows}


def spatial_density_ratio(rooms: int | None, area: int | None) -> float | None:
    if not area:
        return None
    return round(float(rooms or 0) / float(area), 4)


def geo_precision_flag(latitude, longitude) -> bool:
    if latitude is None or longitude is None:
        return False
    try:
        lat = Decimal(str(latitude))
        lon = Decimal(str(longitude))
    except Exception:
        return False
    if lat == 0 and lon == 0:
        return False
    return IRAN_LAT_MIN <= lat <= IRAN_LAT_MAX and IRAN_LON_MIN <= lon <= IRAN_LON_MAX


def build_neighborhood_price_per_sqm_map(
    properties: list[Property] | None = None,
    exclude_id: int | None = None,
) -> dict[str, float]:
    qs = Property.active_objects.exclude(area=0)
    if properties is not None:
        neighborhoods = {p.neighborhood for p in properties if p.neighborhood}
        if neighborhoods:
            qs = qs.filter(neighborhood__in=neighborhoods)
    if exclude_id is not None:
        qs = qs.exclude(pk=exclude_id)

    rows = list(qs.values("id", "neighborhood", "price", "area"))
    listing_prices = annotate_effective_prices([row["id"] for row in rows])

    stats: dict[str, list[float]] = {}
    for row in rows:
        n = row["neighborhood"]
        area = row["area"]
        if not n or not area:
            continue
        price = listing_prices.get(row["id"], row["price"])
        if price is None:
            continue
        stats.setdefault(n, []).append(float(price) / float(area))
    return {n: sum(vals) / len(vals) for n, vals in stats.items() if vals}


def build_neighborhood_price_stats_map(
    properties: list[Property] | None = None,
) -> dict[str, dict[str, Any]]:
    qs = Property.active_objects.exclude(area=0)
    if properties is not None:
        neighborhoods = {p.neighborhood for p in properties if p.neighborhood}
        if neighborhoods:
            qs = qs.filter(neighborhood__in=neighborhoods)

    rows = list(qs.values("id", "neighborhood", "price", "area"))
    listing_prices = annotate_effective_prices([row["id"] for row in rows])

    stats: dict[str, dict[str, Any]] = {}
    for row in rows:
        n = row["neighborhood"]
        area = row["area"]
        if not n or not area:
            continue
        price = listing_prices.get(row["id"], row["price"])
        if price is None:
            continue
        entry = stats.setdefault(n, {"sum": 0.0, "count": 0})
        entry["sum"] += float(price) / float(area)
        entry["count"] += 1
    return stats


def cached_neighborhood_price_stats_map(ttl: int = 60) -> dict[str, dict[str, Any]]:
    from apps.common import cache_utils

    key = cache_utils.make_key("stats", "neighborhoods")
    return cache_utils.cache_or_compute(key, build_neighborhood_price_stats_map, ttl)


def price_deviation_index(
    property_obj: Property,
    neighborhood_stats: dict[str, dict[str, Any]] | None = None,
) -> float | None:
    pps = price_per_sqm(effective_sale_price(property_obj), property_obj.area)
    if pps is None or not property_obj.neighborhood:
        return None

    if neighborhood_stats is None:
        stats = build_neighborhood_price_stats_map([property_obj])
        entry = stats.get(property_obj.neighborhood)
        if not entry:
            return None
        total = entry["sum"]
        count = entry["count"]
    else:
        entry = neighborhood_stats.get(property_obj.neighborhood)
        if not entry:
            return None
        total = entry["sum"]
        count = entry["count"]

    self_counted = (
        property_obj.status != Property.Status.INACTIVE
        and property_obj.area
        and effective_sale_price(property_obj) is not None
    )

    if self_counted:
        count = count - 1
        total = total - pps

    if count < 1:
        return None
    avg = total / count
    if not avg:
        return None
    return round((pps - avg) / avg, 4)


def images_count_for_property(property_obj: Property) -> int:
    if hasattr(property_obj, "_prefetched_objects_cache") and "images" in property_obj._prefetched_objects_cache:
        return len(property_obj.images.all())
    return property_obj.images.count()


def engagement_heat_score(
    property_obj: Property,
    *,
    window_days: int = ENGAGEMENT_WINDOW_DAYS,
    followup_count: int | None = None,
    task_rows: list[Task] | None = None,
) -> int:
    since = timezone.now() - datetime.timedelta(days=window_days)
    score = 0

    cache = getattr(property_obj, "_prefetched_objects_cache", None) or {}

    if followup_count is None and "followups" in cache:
        followup_count = sum(
            1
            for f in cache["followups"]
            if not f.is_archived and f.created_at and f.created_at >= since
        )
    if followup_count is None:
        followup_count = property_obj.followups.filter(
            created_at__gte=since,
            is_archived=False,
        ).count()
    score += followup_count

    if task_rows is None and "tasks" in cache:
        task_rows = list(cache["tasks"])

    if task_rows is None:
        tasks = property_obj.tasks.filter(created_at__gte=since).exclude(
            status=Task.Status.CANCELLED
        )
        for t in tasks:
            score += TASK_TYPE_WEIGHTS.get(t.task_type, 1)
    else:
        for t in task_rows:
            if t.created_at and t.created_at < since:
                continue
            if t.status == Task.Status.CANCELLED:
                continue
            score += TASK_TYPE_WEIGHTS.get(t.task_type, 1)
    return score


def property_days_on_market(property_obj: Property) -> int | None:
    listings = list(property_obj.property_files.all())

    starts = [l.start_date for l in listings if l.start_date]
    start = min(starts) if starts else None
    if start is None:
        start = property_obj.created_at.date() if property_obj.created_at else None
    if start is None:
        return None

    still_active = any(
        l.status in (
            getattr(PropertyFile.Status, "ACTIVE", "ACTIVE"),
            getattr(PropertyFile.Status, "DRAFT", "DRAFT"),
            getattr(PropertyFile.Status, "PAUSED", "PAUSED"),
        )
        for l in listings
    )
    ends = [l.end_date for l in listings if l.end_date]
    if still_active or not ends:
        end = _today()
    else:
        end = max(ends)
    return _days_between(start, end)


def property_market_metrics(
    property_obj: Property,
    neighborhood_stats: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    pps = price_per_sqm(effective_sale_price(property_obj), property_obj.area)
    img_count = images_count_for_property(property_obj)
    dom = property_days_on_market(property_obj)
    return {
        "propertyId": property_obj.id,
        "pricePerSqm": pps,
        "imagesCount": img_count,
        "daysOnMarket": dom,
        "spatialDensityRatio": spatial_density_ratio(property_obj.rooms, property_obj.area),
        "priceDeviationIndex": price_deviation_index(property_obj, neighborhood_stats),
        "geoPrecisionFlag": geo_precision_flag(property_obj.latitude, property_obj.longitude),
        "engagementHeatScore": engagement_heat_score(property_obj),
    }


def consultant_tenure_days(profile) -> int:
    hired = profile.hired_at
    if not hired:
        return 0
    return _days_between(hired)


def consultant_tasks_overdue_count(user) -> int:
    today = _today()
    return (
        Task.objects.filter(assigned_to=user)
        .exclude(status__in=[Task.Status.COMPLETED, Task.Status.CANCELLED])
        .filter(due_date__lt=today)
        .count()
    )


def consultant_followups_overdue_count(user) -> int:
    return (
        FollowUp.objects.filter(
            consultant=user,
            is_archived=False,
            status="scheduled",
            scheduled_at__lt=timezone.now(),
        ).count()
    )


def consultant_closed_deals_count(user, *, since=None) -> int:
    if since is None:
        since = timezone.now() - datetime.timedelta(days=CLOSED_DEALS_WINDOW_DAYS)
    return (
        PropertyFile.objects.filter(
            assigned_to=user,
            status=PropertyFile.Status.SOLD,
            updated_at__gte=since,
        )
        .distinct()
        .count()
    )


def consultant_completed_work_count(user, *, since=None) -> int:
    if since is None:
        since = timezone.now() - datetime.timedelta(days=COMPLETED_WORK_WINDOW_DAYS)
    followups = FollowUp.objects.filter(
        consultant=user,
        is_archived=False,
        status=FollowUpStatus.COMPLETED,
        updated_at__gte=since,
    ).count()
    tasks = (
        Task.objects.filter(assigned_to=user, status=Task.Status.COMPLETED)
        .filter(Q(completed_at__gte=since) | Q(completed_at__isnull=True, updated_at__gte=since))
        .count()
    )
    return followups + tasks


def consultant_overdue_work_count(user) -> int:
    return consultant_tasks_overdue_count(user) + consultant_followups_overdue_count(user)


def consultant_followup_completion_rate(user) -> float | None:
    qs = FollowUp.objects.filter(consultant=user, is_archived=False)
    total = qs.count()
    if not total:
        return None
    done = qs.filter(status=FollowUpStatus.COMPLETED).count()
    return round(done / total * 100, 1)


def consultant_work_completion_rate(user) -> float | None:
    followups = FollowUp.objects.filter(consultant=user, is_archived=False)
    tasks = Task.objects.filter(assigned_to=user).exclude(status=Task.Status.CANCELLED)
    total = followups.count() + tasks.count()
    if not total:
        return None
    done = (
        followups.filter(status=FollowUpStatus.COMPLETED).count()
        + tasks.filter(status=Task.Status.COMPLETED).count()
    )
    return round(done / total * 100, 1)


def consultant_ranking_metrics(user) -> dict[str, Any]:
    closed = consultant_closed_deals_count(user)
    completed = consultant_completed_work_count(user)
    overdue = consultant_overdue_work_count(user)
    if closed > 0:
        headline_value = closed
        headline_label = "معاملات بسته‌شده"
    else:
        headline_value = completed
        headline_label = "کارهای تکمیل‌شده"
    return {
        "closedDealsCount": closed,
        "completedWorkCount": completed,
        "overdueWorkCount": overdue,
        "headlineValue": headline_value,
        "headlineLabel": headline_label,
        "workCompletionRate": consultant_work_completion_rate(user),
        "followupCompletionRate": consultant_followup_completion_rate(user),
    }


def consultant_performance_metrics(profile) -> dict[str, Any]:
    user = profile.user
    rank = consultant_ranking_metrics(user)
    return {
        "agentId": profile.id,
        "userId": user.id,
        "tenureDays": consultant_tenure_days(profile),
        "tasksOverdueCount": consultant_tasks_overdue_count(user),
        "followupsOverdueCount": consultant_followups_overdue_count(user),
        **rank,
    }


def delegation_indicator(property_file: PropertyFile) -> str:
    if not property_file.assigned_to_id:
        return "UNASSIGNED"
    if property_file.created_by_id and property_file.assigned_to_id != property_file.created_by_id:
        return "DELEGATED"
    return "SELF_MANAGED"


def effective_exposure_days(property_file: PropertyFile) -> int | None:
    if not property_file.start_date:
        return None
    start = property_file.start_date
    if property_file.end_date:
        end = property_file.end_date
        if end < start:
            return None
        return _days_between(start, end.date() if hasattr(end, "date") else end)
    return _days_between(start)


def property_file_lifespan_days(property_file: PropertyFile) -> int | None:
    return effective_exposure_days(property_file)


def is_burned_property_file(property_file: PropertyFile) -> bool:
    if property_file.status == PropertyFile.Status.EXPIRED:
        return True
    if property_file.status == PropertyFile.Status.ARCHIVED:
        prop = property_file.property
        if prop and prop.status == Property.Status.SOLD:
            return False
        return True
    return False


def high_prob_leads_by_property(property_ids) -> dict[int, int]:
    ids = [pid for pid in dict.fromkeys(property_ids) if pid]
    if not ids:
        return {}
    rows = (
        FollowUp.objects.filter(
            property_id__in=ids,
            is_archived=False,
            probability__gte=HIGH_PROBABILITY_THRESHOLD,
        )
        .values("property_id")
        .annotate(total=Count("id"))
    )
    return {row["property_id"]: row["total"] for row in rows}


def images_count_by_property(property_ids) -> dict[int, int]:
    ids = [pid for pid in dict.fromkeys(property_ids) if pid]
    if not ids:
        return {}
    rows = (
        PropertyImage.objects.filter(property_id__in=ids)
        .values("property_id")
        .annotate(total=Count("id"))
    )
    return {row["property_id"]: row["total"] for row in rows}


def generated_high_prob_leads_for_property_file(
    property_file: PropertyFile, high_prob_leads: dict[int, int] | None = None
) -> int:
    if not property_file.property_id:
        return 0
    if high_prob_leads is not None:
        return high_prob_leads.get(property_file.property_id, 0)
    return (
        FollowUp.objects.filter(
            property_id=property_file.property_id,
            is_archived=False,
            probability__gte=HIGH_PROBABILITY_THRESHOLD,
        ).count()
    )


def content_richness_score(property_file: PropertyFile, images_count: int | None = None) -> int:
    score = 0
    desc = (property_file.description or "").strip()
    prop = property_file.property

    if len(desc) >= 150:
        score += 1
    if len(desc) >= 500:
        score += 1

    if images_count is None and prop:
        images_count = images_count_for_property(prop)
    images_count = images_count or 0
    if images_count >= 3:
        score += 1
    if images_count >= 6:
        score += 1

    has_price = any(
        [property_file.sale_price, property_file.deposit, property_file.monthly_rent]
    )

    if prop and property_file.title and has_price and prop.area and prop.neighborhood and desc:
        score += 1
    return min(score, 5)


def property_file_marketing_metrics(
    property_file: PropertyFile, high_prob_leads: dict[int, int] | None = None
) -> dict[str, Any]:
    prop = property_file.property
    img_count = images_count_for_property(prop) if prop else 0
    richness = content_richness_score(property_file, img_count)
    heat = engagement_heat_score(prop) if prop else 0
    return {
        "propertyFileId": property_file.id,
        "listingId": property_file.id,
        "publishChannel": property_file.publish_channel,
        "effectiveExposureDays": effective_exposure_days(property_file),
        "delegationIndicator": delegation_indicator(property_file),
        "isBurnedPropertyFile": is_burned_property_file(property_file),
        "generatedHighProbLeads": generated_high_prob_leads_for_property_file(
            property_file, high_prob_leads
        ),
        "contentRichnessScore": richness,
        "engagementHeatScore": heat,
    }


def channel_marketing_summary(
    listings: list[PropertyFile],
    high_prob_leads: dict[int, int] | None = None,
    images_counts: dict[int, int] | None = None,
) -> list[dict[str, Any]]:
    by_channel: dict[str, list[PropertyFile]] = {}
    for lst in listings:
        by_channel.setdefault(lst.publish_channel or "OTHER", []).append(lst)

    def _richness(lst: PropertyFile) -> int:
        if images_counts is None:
            return content_richness_score(lst)
        return content_richness_score(
            lst, images_counts.get(lst.property_id, 0) if lst.property_id else 0
        )

    rows = []
    for channel, items in sorted(by_channel.items()):
        lifespans = [d for d in (property_file_lifespan_days(x) for x in items) if d is not None]
        avg_lifespan = round(sum(lifespans) / len(lifespans), 1) if lifespans else None
        burned = sum(1 for x in items if is_burned_property_file(x))
        total = len(items)
        burn_rate = round(burned / total, 4) if total else None
        high_prob = sum(
            generated_high_prob_leads_for_property_file(x, high_prob_leads) for x in items
        )
        rows.append(
            {
                "publishChannel": channel,
                "propertyFileCount": total,
                "listingCount": total,
                "avgLifespanDays": avg_lifespan,
                "propertyFileBurnRate": burn_rate,
                "listingBurnRate": burn_rate,
                "generatedHighProbLeads": high_prob,
                "avgContentRichness": round(
                    sum(_richness(x) for x in items) / total, 2
                )
                if total
                else None,
            }
        )
    return rows


_listing_sale_price = _property_file_sale_price
listing_lifespan_days = property_file_lifespan_days
is_burned_listing = is_burned_property_file
generated_high_prob_leads_for_listing = generated_high_prob_leads_for_property_file
listing_marketing_metrics = property_file_marketing_metrics
