import datetime
from decimal import Decimal

import jdatetime

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.analytics.views import _get_monthly_revenue, PERSIAN_MONTHS
from apps.listings.models import Listing
from apps.notifications.models import Notification
from apps.properties.models import Property

User = get_user_model()


class ListingSoldAndRevenueTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.admin = User.objects.create_user(username="admin_user", password="pw", role="ADMIN")
        self.agent = User.objects.create_user(username="agent_user", password="pw", role="AGENT")
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

        self.property = Property.objects.create(
            title="آپارتمان نیاوران",
            internal_code="P-100",
            consultant=self.agent,
            area=120,
            address="تهران نیاوران",
            review_status=Property.ReviewStatus.APPROVED,
        )

        self.listing_sale = Listing.objects.create(
            property=self.property,
            title="فروش آپارتمان نیاوران",
            publish_channel="WEBSITE",
            created_by=self.agent,
            assigned_to=self.agent,
            status=Listing.Status.ACTIVE,
            sale_price=Decimal("5000000000"),
        )

        self.listing_rent = Listing.objects.create(
            property=self.property,
            title="اجاره آپارتمان نیاوران",
            publish_channel="WEBSITE",
            created_by=self.agent,
            assigned_to=self.agent,
            status=Listing.Status.ACTIVE,
            deposit=Decimal("500000000"),
            monthly_rent=Decimal("10000000"),
        )

    def test_mark_listing_as_sold_action(self):
        resp = self.client.post(f"/listings/api/listings/{self.listing_sale.id}/sold/")
        self.assertEqual(resp.status_code, 200)
        self.listing_sale.refresh_from_db()
        self.assertEqual(self.listing_sale.status, Listing.Status.SOLD)
        self.assertEqual(self.listing_sale.property.status, Property.Status.SOLD)

    def test_set_status_to_sold_updates_related_property(self):
        resp = self.client.post(
            f"/listings/api/listings/{self.listing_sale.id}/set_status/",
            {"status": "SOLD"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.listing_sale.refresh_from_db()
        self.assertEqual(self.listing_sale.status, Listing.Status.SOLD)
        self.assertEqual(self.listing_sale.property.status, Property.Status.SOLD)

    def test_set_status_consultant_owner_can_change_status(self):
        client = APIClient()
        client.force_authenticate(user=self.agent)
        resp = client.post(
            f"/listings/api/listings/{self.listing_sale.id}/set_status/",
            {"status": "PAUSED"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.listing_sale.refresh_from_db()
        self.assertEqual(self.listing_sale.status, Listing.Status.PAUSED)

    def test_set_status_invalid_status_rejected(self):
        resp = self.client.post(
            f"/listings/api/listings/{self.listing_sale.id}/set_status/",
            {"status": "NOT_A_STATUS"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.listing_sale.refresh_from_db()
        self.assertEqual(self.listing_sale.status, Listing.Status.ACTIVE)


    def test_show_sold_filtering(self):
        self.listing_sale.status = Listing.Status.SOLD
        self.listing_sale.save()

        res_default = self.client.get("/listings/api/listings/")
        self.assertEqual(res_default.status_code, 200)
        results = res_default.json()["results"]
        ids = [row["id"] for row in results]
        self.assertNotIn(self.listing_sale.id, ids)
        self.assertIn(self.listing_rent.id, ids)

        res_sold = self.client.get("/listings/api/listings/?show_sold=true")
        self.assertEqual(res_sold.status_code, 200)
        sold_results = res_sold.json()["results"]
        sold_ids = [row["id"] for row in sold_results]
        self.assertIn(self.listing_sale.id, sold_ids)
        self.assertNotIn(self.listing_rent.id, sold_ids)

    def test_archived_listing_stays_in_default_list(self):
        self.listing_sale.status = Listing.Status.ARCHIVED
        self.listing_sale.save()

        res = self.client.get("/listings/api/listings/")
        self.assertEqual(res.status_code, 200)
        results = res.json()["results"]
        ids = [row["id"] for row in results]
        self.assertIn(self.listing_sale.id, ids)
        self.assertIn(self.listing_rent.id, ids)
        archived = next(row for row in results if row["id"] == self.listing_sale.id)
        self.assertEqual(archived["status"], "ARCHIVED")

    def test_status_filter_archived_only(self):
        self.listing_sale.status = Listing.Status.ARCHIVED
        self.listing_sale.save()

        res = self.client.get("/listings/api/listings/?status=ARCHIVED")
        self.assertEqual(res.status_code, 200)
        ids = [row["id"] for row in res.json()["results"]]
        self.assertIn(self.listing_sale.id, ids)
        self.assertNotIn(self.listing_rent.id, ids)

    def test_archive_action_then_list_shows_archived(self):
        resp = self.client.post(f"/listings/api/listings/{self.listing_sale.id}/archive/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["status"], "ARCHIVED")

        res = self.client.get("/listings/api/listings/")
        self.assertEqual(res.status_code, 200)
        archived = next(row for row in res.json()["results"] if row["id"] == self.listing_sale.id)
        self.assertEqual(archived["status"], "ARCHIVED")

    def test_delete_removes_listing(self):
        listing_id = self.listing_sale.id
        resp = self.client.delete(f"/listings/api/listings/{listing_id}/")
        self.assertIn(resp.status_code, (200, 204))
        self.assertFalse(Listing.objects.filter(pk=listing_id).exists())

        res = self.client.get("/listings/api/listings/")
        self.assertEqual(res.status_code, 200)
        ids = [row["id"] for row in res.json()["results"]]
        self.assertNotIn(listing_id, ids)

    def test_consultant_sees_own_archived_and_can_delete(self):
        self.listing_sale.status = Listing.Status.ARCHIVED
        self.listing_sale.save()

        agent = APIClient()
        agent.force_authenticate(user=self.agent)
        res = agent.get("/listings/api/listings/")
        self.assertEqual(res.status_code, 200)
        results = res.json()["results"]
        ids = [row["id"] for row in results]
        self.assertIn(self.listing_sale.id, ids)
        archived = next(row for row in results if row["id"] == self.listing_sale.id)
        self.assertEqual(archived["status"], "ARCHIVED")

        listing_id = self.listing_sale.id
        resp = agent.delete(f"/listings/api/listings/{listing_id}/")
        self.assertIn(resp.status_code, (200, 204))
        self.assertFalse(Listing.objects.filter(pk=listing_id).exists())

    def test_consultant_listing_scope_uses_assignee_not_creator(self):
        other_agent = User.objects.create_user(
            username="assigned-agent", password="pw", role="AGENT"
        )
        assigned_to_me = Listing.objects.create(
            property=self.property,
            title="مسئولیت من",
            publish_channel=Listing.PublishChannel.WEBSITE,
            created_by=other_agent,
            assigned_to=self.agent,
        )
        created_by_me = Listing.objects.create(
            property=self.property,
            title="مسئولیت دیگری",
            publish_channel=Listing.PublishChannel.WEBSITE,
            created_by=self.agent,
            assigned_to=other_agent,
        )
        agent = APIClient()
        agent.force_authenticate(user=self.agent)
        response = agent.get("/listings/api/listings/?include_sold=true&page_size=100")
        self.assertEqual(response.status_code, 200)
        ids = {row["id"] for row in response.json()["results"]}
        self.assertIn(assigned_to_me.id, ids)
        self.assertNotIn(created_by_me.id, ids)

    def test_consultant_create_assigns_listing_to_self(self):
        agent = APIClient()
        agent.force_authenticate(user=self.agent)
        response = agent.post(
            "/listings/api/listings/",
            {
                "title": "آگهی مسئول خودم",
                "property": self.property.id,
                "publishChannel": "WEBSITE",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content[:400])
        self.assertEqual(response.json()["assigned_to"], self.agent.id)
        self.assertEqual(response.json()["created_by"], self.agent.id)
        self.assertEqual(response.json()["status"], Listing.Status.ACTIVE)

        listing_id = response.json()["id"]
        direct_update = agent.patch(
            f"/listings/api/listings/{listing_id}/",
            {"status": Listing.Status.ACTIVE},
            format="json",
        )
        self.assertEqual(direct_update.status_code, 200)
        self.assertEqual(direct_update.json()["status"], Listing.Status.ACTIVE)

        self.client.force_authenticate(user=self.admin)
        rejection = self.client.post(
            f"/listings/api/listings/{listing_id}/reject/",
            {"reason": "توضیحات آگهی را کامل کنید."},
            format="json",
        )
        self.assertEqual(rejection.status_code, 410, rejection.content[:400])
        self.assertEqual(Listing.objects.get(pk=listing_id).status, Listing.Status.ACTIVE)

        resubmitted = agent.patch(
            f"/listings/api/listings/{listing_id}/",
            {"description": "توضیحات اصلاح‌شده"},
            format="json",
        )
        self.assertEqual(resubmitted.status_code, 200, resubmitted.content[:400])
        self.assertEqual(resubmitted.json()["status"], Listing.Status.ACTIVE)

        approved = self.client.post(f"/listings/api/listings/{listing_id}/approve/")
        self.assertEqual(approved.status_code, 410, approved.content[:400])

    def test_consultant_cannot_reassign_listing(self):
        other_agent = User.objects.create_user(
            username="reassign-agent", password="pw", role="AGENT"
        )
        agent = APIClient()
        agent.force_authenticate(user=self.agent)
        response = agent.patch(
            f"/listings/api/listings/{self.listing_sale.id}/",
            {"assigned_to": other_agent.id},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content[:400])
        self.listing_sale.refresh_from_db()
        self.assertEqual(self.listing_sale.assigned_to_id, self.agent.id)

    def test_property_filter_returns_all_pages_for_that_property(self):
        other = Property.objects.create(
            title="ملک دیگر",
            internal_code="P-OTHER",
            consultant=self.agent,
            area=80,
            address="تهران",
        )
        extras = []
        for i in range(25):
            extras.append(
                Listing.objects.create(
                    property=other,
                    title=f"آگهی متفرقه {i}",
                    publish_channel="WEBSITE",
                    created_by=self.agent,
                    status=Listing.Status.ACTIVE,
                )
            )

        res = self.client.get(f"/listings/api/listings/?property={self.property.id}")
        self.assertEqual(res.status_code, 200)
        payload = res.json()
        results = payload["results"]
        ids = [row["id"] for row in results]
        self.assertIn(self.listing_sale.id, ids)
        self.assertIn(self.listing_rent.id, ids)
        self.assertEqual(payload["count"], 2)
        for extra in extras:
            self.assertNotIn(extra.id, ids)

    def test_property_filter_include_sold(self):
        self.listing_sale.status = Listing.Status.SOLD
        self.listing_sale.save()

        hidden = self.client.get(f"/listings/api/listings/?property={self.property.id}")
        self.assertEqual(hidden.status_code, 200)
        hidden_ids = [row["id"] for row in hidden.json()["results"]]
        self.assertNotIn(self.listing_sale.id, hidden_ids)
        self.assertIn(self.listing_rent.id, hidden_ids)

        shown = self.client.get(
            f"/listings/api/listings/?property={self.property.id}&include_sold=true&page_size=1000"
        )
        self.assertEqual(shown.status_code, 200)
        shown_payload = shown.json()
        shown_ids = [row["id"] for row in shown_payload["results"]]
        self.assertIn(self.listing_sale.id, shown_ids)
        self.assertIn(self.listing_rent.id, shown_ids)
        self.assertEqual(shown_payload["count"], 2)

    def test_sold_listing_detail_is_reachable(self):
        self.listing_sale.status = Listing.Status.SOLD
        self.listing_sale.save()

        res = self.client.get(f"/listings/api/listings/{self.listing_sale.id}/")
        self.assertEqual(res.status_code, 200, res.content[:300])
        self.assertEqual(res.json()["id"], self.listing_sale.id)
        self.assertEqual(res.json()["status"], "SOLD")

        agent = APIClient()
        agent.force_authenticate(user=self.agent)
        res_agent = agent.get(f"/listings/api/listings/{self.listing_sale.id}/")
        self.assertEqual(res_agent.status_code, 200, res_agent.content[:300])
        self.assertEqual(res_agent.json()["status"], "SOLD")

    def test_monthly_revenue_calculation_includes_sale_and_rent(self):
        self.listing_sale.status = Listing.Status.SOLD
        self.listing_sale.save()

        self.listing_rent.status = Listing.Status.SOLD
        self.listing_rent.save()

        revenue_bundle = _get_monthly_revenue()
        revenue_data = revenue_bundle["months"]
        self.assertTrue(len(revenue_data) > 0)
        total_rev = sum(item["revenue"] for item in revenue_data)
        self.assertGreater(total_rev, 0)

    def test_revenue_chart_reflects_listing_reopened_to_active(self):
        self.listing_sale.status = Listing.Status.SOLD
        self.listing_sale.save()

        before = _get_monthly_revenue()["months"]
        self.assertEqual(sum(m["count"] for m in before), 1)
        self.assertGreater(sum(m["revenue"] for m in before), 0)

        resp = self.client.post(
            f"/listings/api/listings/{self.listing_sale.id}/set_status/",
            {"status": "ACTIVE"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)

        after = _get_monthly_revenue()["months"]
        self.assertEqual(sum(m["count"] for m in after), 0)
        self.assertEqual(sum(m["total"] for m in after), 0)

        self.property.refresh_from_db()
        self.assertNotEqual(self.property.status, Property.Status.SOLD)

    def test_revenue_chart_keeps_sold_property_when_other_listing_still_sold(self):
        other = Listing.objects.create(
            property=self.property,
            title="فروش دیگر",
            publish_channel="WEBSITE",
            created_by=self.agent,
            status=Listing.Status.SOLD,
            sale_price=Decimal("4000000000"),
        )
        self.listing_sale.status = Listing.Status.SOLD
        self.listing_sale.save()

        resp = self.client.post(
            f"/listings/api/listings/{other.id}/set_status/",
            {"status": "ACTIVE"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)

        after = _get_monthly_revenue()["months"]

        self.assertEqual(sum(m["count"] for m in after), 1)


    def test_consultant_cannot_reassign_listing(self):
        other_agent = User.objects.create_user(
            username="reassign-agent", password="pw", role="AGENT"
        )
        agent = APIClient()
        agent.force_authenticate(user=self.agent)
        response = agent.patch(
            f"/listings/api/listings/{self.listing_sale.id}/",
            {"assigned_to": other_agent.id},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content[:400])
        self.listing_sale.refresh_from_db()
        self.assertEqual(self.listing_sale.assigned_to_id, self.agent.id)

    def test_property_filter_returns_all_pages_for_that_property(self):
        other = Property.objects.create(
            title="ملک دیگر",
            internal_code="P-OTHER",
            consultant=self.agent,
            area=80,
            address="تهران",
        )
        extras = []
        for i in range(25):
            extras.append(
                Listing.objects.create(
                    property=other,
                    title=f"آگهی متفرقه {i}",
                    publish_channel="WEBSITE",
                    created_by=self.agent,
                    status=Listing.Status.ACTIVE,
                )
            )

        res = self.client.get(f"/listings/api/listings/?property={self.property.id}")
        self.assertEqual(res.status_code, 200)
        payload = res.json()
        results = payload["results"]
        ids = [row["id"] for row in results]
        self.assertIn(self.listing_sale.id, ids)
        self.assertIn(self.listing_rent.id, ids)
        self.assertEqual(payload["count"], 2)
        for extra in extras:
            self.assertNotIn(extra.id, ids)

    def test_property_filter_include_sold(self):
        self.listing_sale.status = Listing.Status.SOLD
        self.listing_sale.save()

        hidden = self.client.get(f"/listings/api/listings/?property={self.property.id}")
        self.assertEqual(hidden.status_code, 200)
        hidden_ids = [row["id"] for row in hidden.json()["results"]]
        self.assertNotIn(self.listing_sale.id, hidden_ids)
        self.assertIn(self.listing_rent.id, hidden_ids)

        shown = self.client.get(
            f"/listings/api/listings/?property={self.property.id}&include_sold=true&page_size=1000"
        )
        self.assertEqual(shown.status_code, 200)
        shown_payload = shown.json()
        shown_ids = [row["id"] for row in shown_payload["results"]]
        self.assertIn(self.listing_sale.id, shown_ids)
        self.assertIn(self.listing_rent.id, shown_ids)
        self.assertEqual(shown_payload["count"], 2)

    def test_sold_listing_detail_is_reachable(self):
        self.listing_sale.status = Listing.Status.SOLD
        self.listing_sale.save()

        res = self.client.get(f"/listings/api/listings/{self.listing_sale.id}/")
        self.assertEqual(res.status_code, 200, res.content[:300])
        self.assertEqual(res.json()["id"], self.listing_sale.id)
        self.assertEqual(res.json()["status"], "SOLD")

        agent = APIClient()
        agent.force_authenticate(user=self.agent)
        res_agent = agent.get(f"/listings/api/listings/{self.listing_sale.id}/")
        self.assertEqual(res_agent.status_code, 200, res_agent.content[:300])
        self.assertEqual(res_agent.json()["status"], "SOLD")

    def test_monthly_revenue_calculation_includes_sale_and_rent(self):
        self.listing_sale.status = Listing.Status.SOLD
        self.listing_sale.save()

        self.listing_rent.status = Listing.Status.SOLD
        self.listing_rent.save()

        revenue_bundle = _get_monthly_revenue()
        revenue_data = revenue_bundle["months"]
        self.assertTrue(len(revenue_data) > 0)
        total_rev = sum(item["revenue"] for item in revenue_data)
        self.assertGreater(total_rev, 0)

    def test_revenue_chart_reflects_listing_reopened_to_active(self):
        self.listing_sale.status = Listing.Status.SOLD
        self.listing_sale.save()

        before = _get_monthly_revenue()["months"]
        self.assertEqual(sum(m["count"] for m in before), 1)
        self.assertGreater(sum(m["revenue"] for m in before), 0)

        resp = self.client.post(
            f"/listings/api/listings/{self.listing_sale.id}/set_status/",
            {"status": "ACTIVE"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)

        after = _get_monthly_revenue()["months"]
        self.assertEqual(sum(m["count"] for m in after), 0)
        self.assertEqual(sum(m["total"] for m in after), 0)

        self.property.refresh_from_db()
        self.assertNotEqual(self.property.status, Property.Status.SOLD)

    def test_revenue_chart_keeps_sold_property_when_other_listing_still_sold(self):
        other = Listing.objects.create(
            property=self.property,
            title="فروش دیگر",
            publish_channel="WEBSITE",
            created_by=self.agent,
            status=Listing.Status.SOLD,
            sale_price=Decimal("4000000000"),
        )
        self.listing_sale.status = Listing.Status.SOLD
        self.listing_sale.save()

        resp = self.client.post(
            f"/listings/api/listings/{other.id}/set_status/",
            {"status": "ACTIVE"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)

        after = _get_monthly_revenue()["months"]

        self.assertEqual(sum(m["count"] for m in after), 1)


class MonthlyRevenueJalaliTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.agent = User.objects.create_user(
            username="rev-agent", password="pw", role="AGENT"
        )

    @staticmethod
    def _force_updated(obj, jalali_ym):
        y, m = jalali_ym
        g = jdatetime.date(year=y, month=m, day=15).togregorian()
        dt = datetime.datetime.combine(
            g, datetime.time(12, 0, 0), tzinfo=timezone.get_current_timezone()
        )
        type(obj).objects.filter(pk=obj.pk).update(updated_at=dt)

    def _sold_listing(self, code, price):
        prop = Property.objects.create(
            title=f"ملک {code}", internal_code=code, consultant=self.agent,
            area=100, address="تهران", status=Property.Status.SOLD,
        )
        return Listing.objects.create(
            property=prop, title=f"آگهی {code}", publish_channel="WEBSITE",
            created_by=self.agent, status=Listing.Status.SOLD,
            sale_price=Decimal(str(price)),
        )

    def test_returns_exactly_six_months_with_current_jalali_month_last(self):
        jtoday = jdatetime.date.today()
        lst = self._sold_listing("R1", 1000000000)
        self._force_updated(lst, (jtoday.year, jtoday.month))

        data = _get_monthly_revenue()["months"]
        self.assertEqual(len(data), 6, "chart must show exactly 6 months")

        expected = []
        for offset in range(-5, 1):
            m = jtoday.month + offset
            y = jtoday.year
            while m <= 0:
                m += 12
                y -= 1
            expected.append(PERSIAN_MONTHS[m - 1])

        self.assertEqual([d["month"] for d in data], expected)
        self.assertEqual(data[-1]["month"], PERSIAN_MONTHS[jtoday.month - 1])
        self.assertEqual(data[-1]["count"], 1)

    def test_sale_in_previous_jalali_month_lands_in_previous_bucket(self):
        jtoday = jdatetime.date.today()
        prev_m = jtoday.month - 1
        prev_y = jtoday.year
        if prev_m <= 0:
            prev_m += 12
            prev_y -= 1

        lst = self._sold_listing("R2", 2000000000)
        self._force_updated(lst, (prev_y, prev_m))

        data = _get_monthly_revenue()["months"]
        self.assertEqual(data[-2]["month"], PERSIAN_MONTHS[prev_m - 1])
        self.assertEqual(data[-2]["count"], 1)

    def test_oldest_bucket_wraps_year_correctly(self):
        jtoday = jdatetime.date.today()
        m = jtoday.month - 5
        y = jtoday.year
        while m <= 0:
            m += 12
            y -= 1

        lst = self._sold_listing("R3", 5000000000)
        self._force_updated(lst, (y, m))

        data = _get_monthly_revenue()["months"]
        self.assertEqual(data[0]["month"], PERSIAN_MONTHS[m - 1])
        self.assertEqual(data[0]["count"], 1)

    def test_count_and_revenue_include_sale_rent_mortgage(self):
        from apps.basics.models import DealType

        jtoday = jdatetime.date.today()

        deal_sale, _ = DealType.objects.get_or_create(
            name="sale",
            defaults={"display_name": "فروش", "sort_order": 1},
        )
        deal_mortgage_rent, _ = DealType.objects.get_or_create(
            name="mortgage_rent",
            defaults={"display_name": "رهن و اجاره", "sort_order": 2},
        )
        deal_full_mortgage, _ = DealType.objects.get_or_create(
            name="full_mortgage",
            defaults={"display_name": "رهن کامل", "sort_order": 3},
        )

        p1 = Property.objects.create(
            title="ملک فروش", internal_code="C1", consultant=self.agent,
            area=100, address="تهران", status=Property.Status.SOLD,
        )
        l1 = Listing.objects.create(
            property=p1, title="فروش", publish_channel="WEBSITE",
            created_by=self.agent, status=Listing.Status.SOLD,
            sale_price=Decimal("3000000000"), deal_type=deal_sale,
        )
        self._force_updated(l1, (jtoday.year, jtoday.month))

        p2 = Property.objects.create(
            title="ملک اجاره", internal_code="C2", consultant=self.agent,
            area=100, address="تهران", status=Property.Status.SOLD,
        )
        l2 = Listing.objects.create(
            property=p2, title="اجاره", publish_channel="WEBSITE",
            created_by=self.agent, status=Listing.Status.SOLD,
            deposit=Decimal("500000000"), monthly_rent=Decimal("10000000"),
            deal_type=deal_mortgage_rent,
        )
        self._force_updated(l2, (jtoday.year, jtoday.month))

        p3 = Property.objects.create(
            title="ملک رهن", internal_code="C3", consultant=self.agent,
            area=100, address="تهران", status=Property.Status.SOLD,
        )
        l3 = Listing.objects.create(
            property=p3, title="رهن", publish_channel="WEBSITE",
            created_by=self.agent, status=Listing.Status.SOLD,
            deposit=Decimal("2000000000"), deal_type=deal_full_mortgage,
        )
        self._force_updated(l3, (jtoday.year, jtoday.month))

        bundle = _get_monthly_revenue()
        data = bundle["months"]
        cur = data[-1]

        self.assertEqual(cur["count"], 3)
        self.assertEqual(cur["total"], 5800000000)

        deal_names = {dt["name"] for dt in bundle["dealTypes"]}
        self.assertIn("sale", deal_names)
        self.assertIn("mortgage_rent", deal_names)
        self.assertIn("full_mortgage", deal_names)
        volumes = cur["dealVolumes"]
        self.assertAlmostEqual(volumes["sale"], 3.0)
        self.assertAlmostEqual(volumes["mortgage_rent"], 0.8)
        self.assertAlmostEqual(volumes["full_mortgage"], 2.0)


class ListingListSerializerShapeTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.admin = User.objects.create_user(
            username="lls-admin", password="pw", role="ADMIN"
        )
        self.agent = User.objects.create_user(
            username="lls-agent", password="pw", role="AGENT"
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

        self.property = Property.objects.create(
            title="آپارتمان بنچمارک",
            internal_code="ZF_4001",
            consultant=self.agent,
            area=120,
            address="تهران نیاوران",
            description="توضیحات ملک تست",
        )
        self.listing = Listing.objects.create(
            property=self.property,
            title="فروش آپارتمان بنچمارک",
            description="توضیحات آگهی تست",
            publish_channel="WEBSITE",
            created_by=self.agent,
            assigned_to=self.agent,
            status=Listing.Status.ACTIVE,
            sale_price=Decimal("5000000000"),
            start_date=timezone.now(),
        )

    def test_list_response_uses_the_slim_serializer(self):
        res = self.client.get("/listings/api/listings/", {"page_size": 10})
        self.assertEqual(res.status_code, 200)
        row = res.json()["results"][0]

        for field in (
            "description",
            "attributes",
            "attributeDetails",
            "created_by_detail",
            "priceDetails",
            "effectiveExposureDays",
            "delegationIndicator",
            "isBurnedListing",
            "generatedHighProbLeads",
            "contentRichnessScore",
            "engagementHeatScore",
        ):
            self.assertNotIn(field, row)

        for field in (
            "id",
            "title",
            "status",
            "channels",
            "created_at",
            "assigned_to",
            "assigned_to_detail",
            "property",
            "property_detail",
            "score",
            "views",
            "dealTypeDisplay",
            "salePrice",
            "deposit",
            "monthlyRent",
        ):
            self.assertIn(field, row)

    def test_detail_response_keeps_the_full_serializer(self):
        res = self.client.get(f"/listings/api/listings/{self.listing.id}/")
        self.assertEqual(res.status_code, 200)
        row = res.json()
        for field in (
            "description",
            "attributes",
            "attributeDetails",
            "created_by_detail",
            "effectiveExposureDays",
            "delegationIndicator",
            "isBurnedListing",
            "generatedHighProbLeads",
            "contentRichnessScore",
            "engagementHeatScore",
        ):
            self.assertIn(field, row)

    def test_property_detail_price_comes_from_the_batched_map(self):
        Listing.objects.create(
            property=self.property,
            title="فروش با قیمت بالاتر",
            publish_channel="INSTAGRAM",
            created_by=self.agent,
            status=Listing.Status.ACTIVE,
            sale_price=Decimal("7000000000"),
            start_date=timezone.now(),
        )
        res = self.client.get("/listings/api/listings/", {"page_size": 10})
        rows = res.json()["results"]
        prices = {r["property_detail"]["price"] for r in rows}
        self.assertIn("7000000000", prices)

    def test_property_detail_price_is_empty_without_a_sale_supply(self):
        prop = Property.objects.create(
            title="ملک بدون آگهی فروش",
            internal_code="ZF_4002",
            consultant=self.agent,
            area=80,
            address="تهران",
        )
        Listing.objects.create(
            property=prop,
            title="اجاره ملک بدون آگهی فروش",
            publish_channel="WEBSITE",
            created_by=self.agent,
            status=Listing.Status.ACTIVE,
            monthly_rent=Decimal("10000000"),
            start_date=timezone.now(),
        )
        res = self.client.get(
            "/listings/api/listings/",
            {"property": prop.id, "include_sold": "true", "page_size": 10},
        )
        rows = res.json()["results"]
        self.assertIsNone(rows[0]["property_detail"]["price"])

    def test_assigned_to_detail_keeps_name_and_mobile(self):
        res = self.client.get("/listings/api/listings/", {"page_size": 10})
        row = res.json()["results"][0]
        self.assertEqual(row["assigned_to_detail"]["name"], "lls-agent")
        self.assertIn("mobile", row["assigned_to_detail"])


class ListingListQueryCountTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.admin = User.objects.create_user(
            username="lqc-admin", password="pw", role="ADMIN"
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    @staticmethod
    def _seed(n_properties, code_base):
        agent = User.objects.create_user(
            username=f"lqc-agent-{code_base}", password="pw", role="AGENT"
        )
        for i in range(n_properties):
            prop = Property.objects.create(
                title=f"ملک {code_base} عدد {i}",
                internal_code=f"ZF_{code_base}{i:02d}",
                consultant=agent,
                area=90,
                address="تهران",
                description="توضیحات " * 4,
            )
            for j in range(2):
                Listing.objects.create(
                    property=prop,
                    title=f"آگهی {code_base}-{i}-{j}",
                    description="توضیحات آگهی " * 3,
                    publish_channel="WEBSITE",
                    created_by=agent,
                    assigned_to=agent,
                    status=Listing.Status.ACTIVE,
                    sale_price=Decimal(1000000000 * (1 + i % 9)),
                    start_date=timezone.now(),
                )

    def _counted_get(self, page_size):
        with CaptureQueriesContext(connection) as ctx:
            res = self.client.get("/listings/api/listings/", {"page_size": page_size})
        self.assertEqual(res.status_code, 200)
        return len(ctx.captured_queries), res

    def test_list_query_count_stays_flat(self):
        self._seed(10, 50)
        small, res = self._counted_get(200)
        self.assertEqual(len(res.json()["results"]), 20)

        self._seed(40, 60)
        large, res = self._counted_get(200)
        self.assertEqual(len(res.json()["results"]), 100)

        self.assertLess(
            large,
            50,
            "a 100-row listings list must run a small constant number of queries",
        )
        self.assertLessEqual(large, small + 2)

    def test_zero_or_negative_prices_are_rejected(self):
        prop = Property.objects.create(
            title="ملک تست قیمت",
            internal_code="ZF_PRICE_TEST",
            consultant=self.admin,
            area=100,
            address="تهران",
        )
        for field in ("salePrice", "deposit", "monthlyRent"):
            for bad_val in (0, -1, -5000000):
                res = self.client.post(
                    "/listings/api/listings/",
                    {
                        "property": prop.id,
                        "title": "تست قیمت نامعتبر",
                        "publishChannel": "WEBSITE",
                        field: bad_val,
                    },
                    format="json",
                )
                self.assertEqual(res.status_code, 400)
                self.assertIn(field, res.json())

class ListingExploreAndRecommendationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        from apps.basics.models import DealType

        self.admin = User.objects.create_user(
            username="explore-admin", password="pw", role="ADMIN"
        )
        self.agent = User.objects.create_user(
            username="explore-agent", password="pw", role="AGENT"
        )
        self.other_agent = User.objects.create_user(
            username="explore-other-agent", password="pw", role="AGENT"
        )
        self.property = Property.objects.create(
            title="آپارتمان مرکز شهر",
            internal_code="EXP-100",
            consultant=self.agent,
            property_type=Property.PropertyType.APARTMENT,
            deal_type=Property.DealType.SALE,
            area=95,
            address="تهران",
            neighborhood="مرکز شهر",
            review_status=Property.ReviewStatus.APPROVED,
        )
        self.sale = DealType.objects.create(name="sale", display_name="فروش")
        self.rent = DealType.objects.create(name="rent", display_name="اجاره")
        self.sale_listing = self._listing(
            "فروش آپارتمان مرکز شهر",
            Listing.PublishChannel.WEBSITE,
            self.agent,
            self.sale,
        )
        self.rent_website_listing = self._listing(
            "اجاره آپارتمان مرکز شهر در وب‌سایت",
            Listing.PublishChannel.WEBSITE,
            self.agent,
            self.rent,
        )
        self.rent_social_listing = self._listing(
            "اجاره آپارتمان مرکز شهر",
            Listing.PublishChannel.INSTAGRAM,
            self.agent,
            self.rent,
        )
        self.paused_website_listing = self._listing(
            "آگهی متوقف‌شده",
            Listing.PublishChannel.WEBSITE,
            self.agent,
            self.sale,
            status=Listing.Status.PAUSED,
        )
        self.other_agent_listing = self._listing(
            "فروش ملک مشاور دیگر",
            Listing.PublishChannel.TELEGRAM,
            self.other_agent,
            self.sale,
        )
        self.client = APIClient()
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(user=self.admin)
        self.agent_client = APIClient()
        self.agent_client.force_authenticate(user=self.agent)

    def _listing(self, title, channel, consultant, deal_type, status=Listing.Status.ACTIVE):
        from apps.basics.models import DealType

        if Listing.objects.filter(property=self.property, deal_type=deal_type).exists():
            suffix = Listing.objects.count() + DealType.objects.count()
            deal_type = DealType.objects.create(name=f"{deal_type.name}-{suffix}", display_name=deal_type.display_name)
        return Listing.objects.create(
            property=self.property,
            title=title,
            publish_channel=channel,
            status=status,
            deal_type=deal_type,
            created_by=consultant,
            assigned_to=consultant,
        )

    def test_public_explore_page_is_available_without_login(self):
        response = self.client.get("/listings/explore/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "public-property-files-root")

    def test_public_explore_only_returns_active_website_listings(self):
        response = self.client.get("/listings/api/explore/?page_size=100")
        self.assertEqual(response.status_code, 200, response.content[:400])
        payload = response.json()
        rows = payload["results"]
        ids = {row["id"] for row in rows}
        self.assertEqual(ids, {self.sale_listing.id, self.rent_website_listing.id})
        self.assertEqual(payload["count"], 2)
        sale_row = next(row for row in rows if row["id"] == self.sale_listing.id)
        self.assertEqual(sale_row["dealTypeId"], self.sale.id)
        self.assertEqual(sale_row["dealTypeName"], "sale")
        self.assertNotIn("publishChannel", sale_row)
        self.assertNotIn("assigned_to", sale_row)
        self.assertNotIn("property_detail", sale_row)

    def test_public_explore_hides_active_listing_when_property_is_unapproved(self):
        self.property.status = Property.Status.DRAFT
        self.property.save(update_fields=["status", "updated_at"])

        response = self.client.get("/listings/api/explore/?page_size=100")
        self.assertEqual(response.status_code, 200, response.content[:400])
        self.assertEqual(response.json()["count"], 0)

        detail = self.client.get(f"/listings/api/public/{self.sale_listing.id}/")
        self.assertEqual(detail.status_code, 404)

    def test_public_explore_filters_using_listing_deal_type(self):
        response = self.client.get(
            "/listings/api/explore/?dealType=rent&page_size=100"
        )
        self.assertEqual(response.status_code, 200, response.content[:400])
        rows = response.json()["results"]
        self.assertEqual([row["id"] for row in rows], [self.rent_website_listing.id])

    def test_public_price_details_hide_private_invalid_and_nested_values(self):
        self.sale_listing.price_details = {
            "sale_price": 125000,
            "monthly_rent": "2,000",
            "owner_amount": 50000,
            "contact_phone": "09120000000",
            "internal_price": 75000,
            "deposit": -1,
            "fee": True,
            "payment": "NaN",
            "amount": {"private": 1000},
            "price_adjustments": [1000],
            "note": "توضیحات داخلی",
        }
        self.sale_listing.save(update_fields=["price_details"])
        response = self.client.get(f"/listings/api/public/{self.sale_listing.id}/")
        self.assertEqual(response.status_code, 200, response.content[:400])
        self.assertEqual(response.json()["priceDetails"], {
            "sale_price": 125000,
            "monthly_rent": "2,000",
        })

    def test_public_price_details_with_non_dictionary_payload_are_empty(self):
        self.sale_listing.price_details = [125000]
        self.sale_listing.save(update_fields=["price_details"])
        response = self.client.get(f"/listings/api/public/{self.sale_listing.id}/")
        self.assertEqual(response.status_code, 200, response.content[:400])
        self.assertEqual(response.json()["priceDetails"], {})

    def test_public_listing_detail_is_shareable_and_exposes_only_safe_listing_data(self):
        self.sale_listing.price_details = {
            "sale_price": 125000,
            "owner_amount": 50000,
            "contact_phone": "09120000000",
            "internal_code": "PRIVATE-1",
        }
        self.sale_listing.save(update_fields=["price_details"])
        page = self.client.get(f"/listings/{self.sale_listing.id}/")
        self.assertEqual(page.status_code, 200)
        self.assertContains(page, "public-property-file-detail-root")
        self.assertContains(page, self.sale_listing.title)

        response = self.client.get(f"/listings/api/public/{self.sale_listing.id}/")
        self.assertEqual(response.status_code, 200, response.content[:400])
        payload = response.json()
        self.assertEqual(payload["title"], self.sale_listing.title)
        self.assertEqual(payload["area"], self.property.area)
        self.assertEqual(payload["city"], "")
        self.assertEqual(payload["images"], [])
        self.assertEqual(payload["priceDetails"], {"sale_price": 125000})
        for private_field in (
            "internalCode",
            "internal_code",
            "ownerPhone",
            "ownerFirstName",
            "assigned_to",
            "assigned_to_detail",
            "created_by_detail",
            "consultantName",
            "consultantId",
            "fullAddress",
            "latitude",
            "longitude",
        ):
            self.assertNotIn(private_field, payload)

    def test_public_listing_detail_is_limited_to_active_website_listings(self):
        for listing in (self.rent_social_listing, self.paused_website_listing):
            response = self.client.get(f"/listings/api/public/{listing.id}/")
            self.assertEqual(response.status_code, 404)

    def test_public_listing_detail_filters_property_attributes_by_property_type(self):
        from apps.basics.models import (
            Attribute,
            DealTypeAttribute,
            PropertyType,
            PropertyTypeAttribute,
            PropertyUsage,
        )
        from apps.listings.models import ListingAttributeValue
        from apps.properties.models import PropertyAttributeValue

        usage = PropertyUsage.objects.create(name="test-residential", display_name="مسکونی")
        apartment = PropertyType.objects.create(
            name="test-apartment",
            display_name="آپارتمان",
            property_usage=usage,
        )
        self.property.property_type_ref = apartment
        self.property.rooms = 2
        self.property.floor = 4
        self.property.built_year = 2018
        self.property.save()

        rooms = Attribute.objects.create(
            name="rooms",
            display_name="تعداد اتاق",
            data_type=Attribute.DataType.INTEGER,
            entity=Attribute.Entity.PROPERTY,
            is_core=True,
            core_field="rooms",
        )
        floor = Attribute.objects.create(
            name="floor",
            display_name="طبقه",
            data_type=Attribute.DataType.INTEGER,
            entity=Attribute.Entity.PROPERTY,
            is_core=True,
            core_field="floor",
        )
        parking = Attribute.objects.create(
            name="parking",
            display_name="پارکینگ",
            data_type=Attribute.DataType.BOOLEAN,
            entity=Attribute.Entity.PROPERTY,
            is_facility=True,
        )
        direction = Attribute.objects.create(
            name="building_direction",
            display_name="جهت ساختمان",
            data_type=Attribute.DataType.TEXT,
            entity=Attribute.Entity.PROPERTY,
        )
        owner_phone = Attribute.objects.create(
            name="owner_phone",
            display_name="شماره مالک",
            data_type=Attribute.DataType.TEXT,
            entity=Attribute.Entity.PROPERTY,
        )
        listing_condition = Attribute.objects.create(
            name="listing_condition",
            display_name="شرایط آگهی",
            data_type=Attribute.DataType.TEXT,
            entity=Attribute.Entity.LISTING,
        )
        DealTypeAttribute.objects.create(
            deal_type=self.sale, attribute=listing_condition
        )
        for attribute in (rooms, floor, parking, owner_phone):
            PropertyTypeAttribute.objects.create(
                property_type=apartment, attribute=attribute
            )

        parking_value = PropertyAttributeValue(property=self.property, attribute=parking)
        parking_value.set_value(True)
        parking_value.save()
        direction_value = PropertyAttributeValue(property=self.property, attribute=direction)
        direction_value.set_value("شمالی")
        direction_value.save()
        owner_phone_value = PropertyAttributeValue(property=self.property, attribute=owner_phone)
        owner_phone_value.set_value("09120000000")
        owner_phone_value.save()
        listing_condition_value = ListingAttributeValue(
            listing=self.sale_listing, attribute=listing_condition
        )
        listing_condition_value.set_value("واگذاری مستقیم")
        listing_condition_value.save()

        response = self.client.get(f"/listings/api/public/{self.sale_listing.id}/")
        self.assertEqual(response.status_code, 200, response.content[:400])
        payload = response.json()
        self.assertEqual(payload["area"], self.property.area)
        self.assertEqual(
            set(payload["propertyAttributes"]), {"rooms", "floor", "parking"}
        )
        self.assertNotIn("building_direction", payload["propertyAttributes"])
        self.assertNotIn("owner_phone", payload["propertyAttributes"])
        self.assertEqual(
            {item["name"] for item in payload["propertyAttributeDetails"]},
            {"rooms", "floor", "parking"},
        )
        self.assertEqual(payload["listingAttributes"], {"listing_condition": "واگذاری مستقیم"})
        self.assertEqual(
            {item["name"] for item in payload["listingAttributeDetails"]},
            {"listing_condition"},
        )

    def test_customer_recommendations_use_active_listings_across_channels(self):
        response = self.agent_client.get(
            "/listings/api/listings/recommendations/?page_size=100"
        )
        self.assertEqual(response.status_code, 200, response.content[:400])
        rows = response.json()["results"]
        ids = [row["id"] for row in rows]
        self.assertCountEqual(
            ids,
            [
                self.sale_listing.id,
                self.rent_social_listing.id,
                self.rent_website_listing.id,
                self.other_agent_listing.id,
            ],
        )
        self.assertEqual(len(ids), len(set(ids)))
        self.assertNotIn(self.paused_website_listing.id, ids)

    def test_customer_recommendations_can_be_limited_to_the_own_listings(self):
        response = self.agent_client.get(
            "/listings/api/listings/recommendations/?scope=mine&page_size=100"
        )
        self.assertEqual(response.status_code, 200, response.content[:400])
        ids = {row["id"] for row in response.json()["results"]}
        self.assertEqual(
            ids,
            {
                self.sale_listing.id,
                self.rent_social_listing.id,
                self.rent_website_listing.id,
            },
        )
        self.assertNotIn(self.other_agent_listing.id, ids)

    def test_customer_recommendations_filter_by_each_listing_deal_type(self):
        response = self.agent_client.get(
            "/listings/api/listings/recommendations/?dealType=rent&page_size=100"
        )
        self.assertEqual(response.status_code, 200, response.content[:400])
        rows = response.json()["results"]
        self.assertCountEqual(
            [row["id"] for row in rows],
            [self.rent_website_listing.id],
        )
        self.assertTrue(all(row["dealTypeId"] == self.rent.id for row in rows))

    def test_customer_recommendations_require_login_and_admin_can_see_all_channels(self):
        anonymous = self.client.get("/listings/api/listings/recommendations/")
        self.assertIn(anonymous.status_code, (401, 403))

        response = self.admin_client.get(
            "/listings/api/listings/recommendations/?page_size=100"
        )
        self.assertEqual(response.status_code, 200, response.content[:400])
        ids = {row["id"] for row in response.json()["results"]}
        self.assertIn(self.other_agent_listing.id, ids)
        self.assertNotIn(self.paused_website_listing.id, ids)


class ListingDraftReviewWorkflowTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.admin = User.objects.create_user(
            username="listing-admin", password="pw", role="ADMIN"
        )
        self.other_admin = User.objects.create_user(
            username="listing-admin-2", password="pw", role="ADMIN"
        )
        self.agent = User.objects.create_user(
            username="listing-agent",
            password="pw",
            role="AGENT",
            first_name="مینا",
            last_name="کریمی",
        )
        self.property = Property.objects.create(
            title="ملک منتشرشده",
            internal_code="P-REVIEW",
            consultant=self.agent,
            area=95,
            address="تهران",
            property_type="APARTMENT",
            deal_type="SALE",
            status=Property.Status.AVAILABLE,
            review_status=Property.ReviewStatus.APPROVED,
        )
        self.client = APIClient()

    def _create_draft_listing(self):
        self.client.force_authenticate(user=self.agent)
        response = self.client.post(
            "/listings/api/listings/",
            {
                "title": "آگهی پیش‌نویس",
                "property": self.property.id,
                "publishChannel": "WEBSITE",
                "salePrice": 4000000000,
            },
        )
        self.assertEqual(response.status_code, 201, response.content[:400])
        return Listing.objects.get(pk=response.json()["id"])

    def _approve(self, listing):
        listing.refresh_from_db()
        return listing

    def _pending_review_notifications(self):
        return Notification.objects.filter(
            type=Notification.NotificationType.LISTING_PENDING_REVIEW
        )

    def test_consultant_creation_is_active_without_listing_review(self):
        listing = self._create_draft_listing()

        self.assertEqual(listing.status, Listing.Status.ACTIVE)
        self.assertIsNone(listing.review_requested_at)
        self.assertFalse(self._pending_review_notifications().exists())

    def test_sold_action_never_overrides_a_draft_property(self):
        draft_property = Property.objects.create(
            title="ملک در حال بازبینی",
            internal_code="P-REVIEW-DRAFT",
            consultant=self.agent,
            area=80,
            address="تهران",
            property_type="APARTMENT",
            deal_type="SALE",
            status=Property.Status.DRAFT,
        )
        listing = Listing.objects.create(
            property=draft_property,
            title="آگهی ملک در حال بازبینی",
            publish_channel=Listing.PublishChannel.WEBSITE,
            created_by=self.agent,
            assigned_to=self.agent,
            status=Listing.Status.ACTIVE,
            sale_price=Decimal("3000000000"),
        )

        self.client.force_authenticate(user=self.agent)
        response = self.client.post(f"/listings/api/listings/{listing.id}/sold/")
        self.assertEqual(response.status_code, 200, response.content[:400])

        draft_property.refresh_from_db()
        self.assertEqual(draft_property.status, Property.Status.DRAFT)

    def test_listing_review_endpoints_are_removed(self):
        listing = self._create_draft_listing()

        self.client.force_authenticate(user=self.admin)
        response = self.client.post(f"/listings/api/listings/{listing.id}/approve/")
        self.assertEqual(response.status_code, 410, response.content[:400])
        rejected = self.client.post(
            f"/listings/api/listings/{listing.id}/reject/",
            {"reason": "دلیل"},
            format="json",
        )
        self.assertEqual(rejected.status_code, 410, rejected.content[:400])

        listing.refresh_from_db()
        self.assertEqual(listing.status, Listing.Status.ACTIVE)

    def test_consultant_edit_of_a_published_listing_keeps_it_active(self):
        listing = self._approve(self._create_draft_listing())
        self.assertEqual(listing.status, Listing.Status.ACTIVE)
        self.assertIsNone(listing.review_requested_at)
        Notification.objects.all().delete()

        self.client.force_authenticate(user=self.agent)
        response = self.client.patch(
            f"/listings/api/listings/{listing.id}/", {"title": "آگهی بازبینی‌شده"}
        )
        self.assertEqual(response.status_code, 200, response.content[:400])

        listing.refresh_from_db()
        self.assertEqual(listing.status, Listing.Status.ACTIVE)
        self.assertIsNone(listing.review_requested_at)
        self.assertFalse(self._pending_review_notifications().exists())

    def test_saving_a_published_listing_unchanged_keeps_it_published(self):
        listing = self._approve(self._create_draft_listing())
        Notification.objects.all().delete()

        self.client.force_authenticate(user=self.agent)
        response = self.client.patch(
            f"/listings/api/listings/{listing.id}/",
            {"title": listing.title, "publishChannel": listing.publish_channel},
        )
        self.assertEqual(response.status_code, 200, response.content[:400])

        listing.refresh_from_db()
        self.assertEqual(listing.status, Listing.Status.ACTIVE)
        self.assertFalse(self._pending_review_notifications().exists())

    def test_editing_a_listing_does_not_create_a_review_request(self):
        listing = self._create_draft_listing()
        Notification.objects.all().delete()

        self.client.force_authenticate(user=self.agent)
        response = self.client.patch(
            f"/listings/api/listings/{listing.id}/", {"description": "توضیحات تکمیل شد."}
        )
        self.assertEqual(response.status_code, 200, response.content[:400])

        listing.refresh_from_db()
        self.assertEqual(listing.status, Listing.Status.ACTIVE)
        self.assertIsNone(listing.review_requested_at)
        self.assertFalse(self._pending_review_notifications().exists())

    def test_admin_listing_decision_endpoints_are_gone(self):
        listing = self._create_draft_listing()
        Notification.objects.all().delete()

        self.client.force_authenticate(user=self.admin)
        response = self.client.post(f"/listings/api/listings/{listing.id}/approve/")
        self.assertEqual(response.status_code, 410, response.content[:400])
        self.assertFalse(self._pending_review_notifications().exists())

    def test_consultant_listing_scope_uses_assignee_not_creator(self):
        other_agent = User.objects.create_user(
            username="assigned-agent", password="pw", role="AGENT"
        )
        assigned_to_me = Listing.objects.create(
            property=self.property,
            title="مسئولیت من",
            publish_channel=Listing.PublishChannel.WEBSITE,
            created_by=other_agent,
            assigned_to=self.agent,
        )
        created_by_me = Listing.objects.create(
            property=self.property,
            title="مسئولیت دیگری",
            publish_channel=Listing.PublishChannel.WEBSITE,
            created_by=self.agent,
            assigned_to=other_agent,
        )
        agent = APIClient()
        agent.force_authenticate(user=self.agent)
        response = agent.get("/listings/api/listings/?include_sold=true&page_size=100")
        self.assertEqual(response.status_code, 200)
        ids = {row["id"] for row in response.json()["results"]}
        self.assertIn(assigned_to_me.id, ids)
        self.assertNotIn(created_by_me.id, ids)

    def test_consultant_create_assigns_listing_to_self(self):
        agent = APIClient()
        agent.force_authenticate(user=self.agent)
        response = agent.post(
            "/listings/api/listings/",
            {
                "title": "آگهی مسئول خودم",
                "property": self.property.id,
                "publishChannel": "WEBSITE",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content[:400])
        self.assertEqual(response.json()["assigned_to"], self.agent.id)
        self.assertEqual(response.json()["created_by"], self.agent.id)
        self.assertEqual(response.json()["status"], Listing.Status.ACTIVE)

        listing_id = response.json()["id"]
        direct_update = agent.patch(
            f"/listings/api/listings/{listing_id}/",
            {"status": Listing.Status.ACTIVE},
            format="json",
        )
        self.assertEqual(direct_update.status_code, 200)
        self.assertEqual(direct_update.json()["status"], Listing.Status.ACTIVE)

        self.client.force_authenticate(user=self.admin)
        rejection = self.client.post(
            f"/listings/api/listings/{listing_id}/reject/",
            {"reason": "توضیحات آگهی را کامل کنید."},
            format="json",
        )
        self.assertEqual(rejection.status_code, 410, rejection.content[:400])
        self.assertEqual(Listing.objects.get(pk=listing_id).status, Listing.Status.ACTIVE)

        resubmitted = agent.patch(
            f"/listings/api/listings/{listing_id}/",
            {"description": "توضیحات اصلاح‌شده"},
            format="json",
        )
        self.assertEqual(resubmitted.status_code, 200, resubmitted.content[:400])
        self.assertEqual(resubmitted.json()["status"], Listing.Status.ACTIVE)

        approved = self.client.post(f"/listings/api/listings/{listing_id}/approve/")
        self.assertEqual(approved.status_code, 410, approved.content[:400])
