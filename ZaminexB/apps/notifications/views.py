from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

POLL_TTL = 10


def _query_date(value):
    if not value:
        return None
    from django.utils.dateparse import parse_date

    return parse_date(value)


def _notifications_poll_key(user) -> str:
    from apps.common import cache_utils

    return cache_utils.make_key("poll", "notifications", user.pk)


FILTER_PARAMS = ("type", "unread", "from", "to", "days", "page_size")


def _is_default_poll(request) -> bool:
    """True only for the unfiltered poll the shell makes (badge count).

    The poll cache is keyed by user alone, so caching a filtered response under the
    same key would serve it to every later request — filtered ones included — for the
    whole TTL. Filtered reads therefore bypass the cache entirely.
    """
    return not any((request.query_params.get(name) or "").strip() for name in FILTER_PARAMS)


class NotificationListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from apps.common import cache_utils
        from .models import Notification

        cacheable = _is_default_poll(request)
        key = _notifications_poll_key(request.user)
        if cacheable:
            cached = cache_utils.cache_get(key)
            if isinstance(cached, dict):
                return Response(cached)

        queryset = Notification.objects.filter(user=request.user)
        notification_type = request.query_params.get("type")
        if notification_type and notification_type != "all":
            queryset = queryset.filter(type=notification_type)
        if request.query_params.get("unread") == "1":
            queryset = queryset.filter(is_read=False)
        date_from = _query_date(request.query_params.get("from"))
        date_to = _query_date(request.query_params.get("to"))
        if date_from:
            queryset = queryset.filter(created_at__date__gte=date_from)
        if date_to:
            queryset = queryset.filter(created_at__date__lte=date_to)
        days = request.query_params.get("days")
        if days and days.isdigit():
            from datetime import timedelta

            from django.utils import timezone

            queryset = queryset.filter(created_at__gte=timezone.now() - timedelta(days=int(days)))
        try:
            limit = min(max(int(request.query_params.get("page_size", 100)), 1), 200)
        except (TypeError, ValueError):
            limit = 100
        notifications = queryset[:limit]

        data = []
        for notif in notifications:
            data.append({
                "id": notif.id,
                "type": notif.type,
                "typeLabel": notif.get_type_display(),
                "title": notif.title,
                "message": notif.message,
                "isRead": notif.is_read,
                "createdAt": notif.created_at.isoformat(),
                "metadata": notif.metadata,
            })

        unread_count = Notification.objects.filter(user=request.user, is_read=False).count()

        payload = {
            "notifications": data,
            "unreadCount": unread_count,
        }
        if cacheable:
            cache_utils.cache_set(key, payload, POLL_TTL)
        return Response(payload)


class NotificationMarkAllReadView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        from apps.common import cache_utils
        from .models import Notification

        updated = Notification.objects.filter(user=request.user, is_read=False).update(is_read=True)
        cache_utils.cache_delete(_notifications_poll_key(request.user))
        return Response({"success": True, "updated": updated})


class NotificationMarkReadView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk=None):
        from apps.common import cache_utils
        from .models import Notification

        try:
            notif = Notification.objects.get(pk=pk, user=request.user)
            notif.is_read = True
            notif.save()
            cache_utils.cache_delete(_notifications_poll_key(request.user))
            return Response({"success": True})
        except Notification.DoesNotExist:
            return Response({"error": "اعلان یافت نشد"}, status=404)
