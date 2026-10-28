import datetime

from django.core.cache import cache
from django.test import Client, TestCase
from django.utils import timezone

from apps.accounts.models import User, UserRole
from apps.notifications.models import Notification


class NotificationFilterTests(TestCase):
    """The notifications list is the data source of the `/app/activity/` filter bar.

    Its 10-second poll cache is keyed by user only, so it must never hold a filtered
    response: otherwise every later filtered request (type, unread, from/to) silently
    receives the unfiltered payload until the TTL expires.
    """

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username="activity-user", password="pw", role=UserRole.ADMIN
        )
        self.client = Client(SERVER_NAME="localhost")
        self.client.force_login(self.user)

        self.task_note = Notification.objects.create(
            user=self.user,
            type=Notification.NotificationType.TASK_ASSIGNED,
            title="وظیفه جدید",
            message="یک وظیفه تازه به شما اختصاص یافت.",
        )
        self.ticket_note = Notification.objects.create(
            user=self.user,
            type=Notification.NotificationType.TICKET_CREATED,
            title="تیکت جدید",
            message="تیکت تازه‌ای ثبت شد.",
        )

    def _ids(self, response):
        return sorted(item["id"] for item in response.json()["notifications"])

    def test_type_filter_is_never_served_from_the_poll_cache(self):
        unfiltered = self.client.get("/common/api/notifications/")
        self.assertEqual(unfiltered.status_code, 200)
        self.assertEqual(self._ids(unfiltered), sorted([self.task_note.id, self.ticket_note.id]))

        filtered = self.client.get("/common/api/notifications/?type=ticket_created")
        self.assertEqual(filtered.status_code, 200)
        self.assertEqual(self._ids(filtered), [self.ticket_note.id])

    def test_date_filter_is_never_served_from_the_poll_cache(self):
        self.client.get("/common/api/notifications/")

        future = self.client.get("/common/api/notifications/?from=2099-01-01")
        self.assertEqual(future.status_code, 200)
        self.assertEqual(future.json()["notifications"], [])

        today = timezone.localdate().isoformat()
        bounded = self.client.get(f"/common/api/notifications/?from=2000-01-01&to={today}")
        self.assertEqual(
            self._ids(bounded), sorted([self.task_note.id, self.ticket_note.id])
        )

    def test_unread_and_page_size_filters_are_never_served_from_the_poll_cache(self):
        self.client.get("/common/api/notifications/")
        self.ticket_note.is_read = True
        self.ticket_note.save(update_fields=["is_read"])

        unread = self.client.get("/common/api/notifications/?unread=1")
        self.assertEqual(self._ids(unread), [self.task_note.id])

        limited = self.client.get("/common/api/notifications/?page_size=1")
        self.assertEqual(len(limited.json()["notifications"]), 1)

    def test_unfiltered_poll_stays_cached_between_requests(self):
        first = self.client.get("/common/api/notifications/")
        self.assertEqual(len(first.json()["notifications"]), 2)

        Notification.objects.create(
            user=self.user,
            type=Notification.NotificationType.TASK_ASSIGNED,
            title="وظیفه دوم",
            message="یک وظیفه دیگر.",
        )

        second = self.client.get("/common/api/notifications/")
        self.assertEqual(len(second.json()["notifications"]), 2)

    def test_marking_all_read_still_invalidates_the_poll_cache(self):
        self.client.get("/common/api/notifications/")

        marked = self.client.post("/common/api/notifications/read-all/")
        self.assertEqual(marked.status_code, 200)

        refreshed = self.client.get("/common/api/notifications/")
        self.assertTrue(all(item["isRead"] for item in refreshed.json()["notifications"]))

    def test_days_filter_is_applied_on_a_fresh_read(self):
        self.client.get("/common/api/notifications/")
        Notification.objects.filter(pk=self.ticket_note.pk).update(
            created_at=timezone.now() - datetime.timedelta(days=12)
        )

        recent = self.client.get("/common/api/notifications/?days=5")
        self.assertEqual(self._ids(recent), [self.task_note.id])
