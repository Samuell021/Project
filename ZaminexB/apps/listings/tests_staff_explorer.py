import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import AdminProfile, ConsultantProfile
from apps.basics.models import DealType
from apps.listings.models import Listing
from apps.properties.models import Property

User = get_user_model()


class StaffListingExploreTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.admin = User.objects.create_user(
            username="staff-explore-admin", password="pw", role="ADMIN"
        )
        self.agent = User.objects.create_user(
            username="staff-explore-agent",
            password="pw",
            role="AGENT",
            first_name="مینا",
            last_name="کریمی",
        )
        self.other_agent = User.objects.create_user(
            username="staff-explore-other",
            password="pw",
            role="AGENT",
            first_name="رضا",
            last_name="مرادی",
        )
        self.other_profile = ConsultantProfile.objects.create(
            user=self.other_agent,
            mobile="09120000000",
            profile_image=SimpleUploadedFile(
                "owner.png", b"avatar-bytes", content_type="image/png"
            ),
        )
        self.sale = DealType.objects.create(name="sale", display_name="فروش")
        self.rent = DealType.objects.create(name="rent", display_name="اجاره")
        self.available_property = Property.objects.create(
            title="آپارتمان مرکز شهر",
            internal_code="STAFF-EXPLORE-1",
            consultant=self.agent,
            property_type=Property.PropertyType.APARTMENT,
            deal_type=Property.DealType.SALE,
            area=95,
            address="تهران",
            neighborhood="مرکز شهر",
            status=Property.Status.AVAILABLE,
            review_status=Property.ReviewStatus.APPROVED,
        )
        self.own_listing = self._listing(
            "آگهی خودم", self.agent, self.sale, Listing.PublishChannel.WEBSITE
        )
        self.other_listing = self._listing(
            "آگهی مشاور دیگر",
            self.other_agent,
            self.rent,
            Listing.PublishChannel.INSTAGRAM,
        )
        self.paused_listing = self._listing(
            "آگهی متوقف‌شده",
            self.other_agent,
            self.sale,
            Listing.PublishChannel.TELEGRAM,
            status=Listing.Status.PAUSED,
        )
        self.draft_listing = self._listing(
            "آگهی پیش‌نویس",
            self.other_agent,
            self.sale,
            Listing.PublishChannel.WEBSITE,
            status=Listing.Status.DRAFT,
        )
        self.agent_client = APIClient()
        self.agent_client.force_authenticate(user=self.agent)
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(user=self.admin)
        self.anonymous_client = APIClient()

    def _listing(self, title, consultant, deal_type, channel, status=Listing.Status.ACTIVE):
        if Listing.objects.filter(property=self.available_property, deal_type=deal_type).exists():
            suffix = Listing.objects.count() + DealType.objects.count()
            deal_type = DealType.objects.create(name=f"{deal_type.name}-{suffix}", display_name=deal_type.display_name)
        return Listing.objects.create(
            property=self.available_property,
            title=title,
            publish_channel=channel,
            status=status,
            deal_type=deal_type,
            created_by=consultant,
            assigned_to=consultant,
        )

    def _explore(self, client=None, query=""):
        return (client or self.agent_client).get(
            f"/listings/api/listings/explore/?page_size=100{query}"
        )

    def test_explore_lists_every_active_listing_for_every_consultant(self):
        response = self._explore()
        self.assertEqual(response.status_code, 200, response.content[:400])
        payload = response.json()
        ids = {row["id"] for row in payload["results"]}
        self.assertEqual(ids, {self.own_listing.id, self.other_listing.id})
        self.assertEqual(len(payload["results"]), 2)

    def test_explore_requires_authentication(self):
        response = self._explore(self.anonymous_client)
        self.assertIn(response.status_code, (401, 403))

    def test_explore_hides_drafts_paused_and_unavailable_properties(self):
        self.available_property.status = Property.Status.DRAFT
        self.available_property.save(update_fields=["status", "updated_at"])

        response = self._explore()
        self.assertEqual(response.status_code, 200, response.content[:400])
        self.assertEqual(response.json()["results"], [])

        self.available_property.status = Property.Status.AVAILABLE
        self.available_property.save(update_fields=["status", "updated_at"])
        ids = {row["id"] for row in self._explore().json()["results"]}
        self.assertNotIn(self.paused_listing.id, ids)
        self.assertNotIn(self.draft_listing.id, ids)

    def test_explore_flags_the_responsible_consultant_of_every_listing(self):
        rows = {row["id"]: row for row in self._explore().json()["results"]}
        own = rows[self.own_listing.id]
        other = rows[self.other_listing.id]

        self.assertTrue(own["isMine"])
        self.assertEqual(own["consultantId"], self.agent.id)
        self.assertEqual(own["consultantName"], "مینا کریمی")
        self.assertIsNone(own["consultantAvatar"])

        self.assertFalse(other["isMine"])
        self.assertEqual(other["consultantId"], self.other_agent.id)
        self.assertEqual(other["consultantName"], "رضا مرادی")
        self.assertEqual(other["channel"], "INSTAGRAM")
        self.assertEqual(other["channelDisplay"], "اینستاگرام")

    @override_settings(MEDIA_ROOT=tempfile.mkdtemp(prefix="zaminex-staff-explore-"))
    def test_explore_returns_the_avatar_of_the_responsible_consultant(self):
        self.other_profile.refresh_from_db()
        response = self._explore()
        self.assertEqual(response.status_code, 200, response.content[:400])
        row = next(
            item for item in response.json()["results"] if item["id"] == self.other_listing.id
        )
        self.assertTrue(row["consultantAvatar"].endswith(self.other_profile.profile_image.name))

    def test_explore_filters_by_channel_deal_type_and_search(self):
        channel = self._explore(query="&channel=INSTAGRAM").json()
        self.assertEqual([row["id"] for row in channel["results"]], [self.other_listing.id])

        deal_type = self._explore(query=f"&dealType={self.sale.id}").json()
        self.assertEqual([row["id"] for row in deal_type["results"]], [self.own_listing.id])

        search = self._explore(query="&q=مشاور+دیگر").json()
        self.assertEqual([row["id"] for row in search["results"]], [self.other_listing.id])

    def test_explore_detail_serves_full_staff_data_only_for_active_listings(self):
        response = self.agent_client.get(
            f"/listings/api/listings/explore/{self.other_listing.id}/"
        )
        self.assertEqual(response.status_code, 200, response.content[:400])
        payload = response.json()
        self.assertEqual(payload["id"], self.other_listing.id)
        self.assertEqual(payload["property_detail"]["id"], self.available_property.id)
        self.assertEqual(payload["publishChannel"], "INSTAGRAM")
        self.assertIn("attributes", payload)
        self.assertIn("attributeDetails", payload)
        self.assertEqual(payload["consultantName"], "رضا مرادی")
        self.assertEqual(payload["channelDisplay"], "اینستاگرام")
        self.assertFalse(payload["isMine"])
        self.assertEqual(payload["area"], self.available_property.area)
        self.assertEqual(payload["propertyType"], "آپارتمان")
        self.assertEqual(payload["district"], "مرکز شهر")
        self.assertEqual(payload["city"], "")

        own = self.agent_client.get(
            f"/listings/api/listings/explore/{self.own_listing.id}/"
        )
        self.assertEqual(own.status_code, 200, own.content[:400])
        self.assertTrue(own.json()["isMine"])

        paused = self.agent_client.get(
            f"/listings/api/listings/explore/{self.paused_listing.id}/"
        )
        self.assertEqual(paused.status_code, 404)

        not_found = self.agent_client.get("/listings/api/listings/explore/abc/")
        self.assertEqual(not_found.status_code, 404)

        anonymous = self.anonymous_client.get(
            f"/listings/api/listings/explore/{self.other_listing.id}/"
        )
        self.assertIn(anonymous.status_code, (401, 403))

        blocked_write = self.agent_client.patch(
            f"/listings/api/listings/explore/{self.other_listing.id}/",
            {"title": "ویرایش غیرمجاز"},
            format="json",
        )
        self.assertEqual(blocked_write.status_code, 405)
        self.other_listing.refresh_from_db()
        self.assertEqual(self.other_listing.title, "آگهی مشاور دیگر")

    def test_customer_matching_covers_every_listing_and_supports_own_scope(self):
        default = self.agent_client.get(
            "/listings/api/listings/recommendations/?page_size=100"
        )
        self.assertEqual(default.status_code, 200, default.content[:400])
        ids = {row["id"] for row in default.json()["results"]}
        self.assertEqual(ids, {self.own_listing.id, self.other_listing.id})

        mine = self.agent_client.get(
            "/listings/api/listings/recommendations/?scope=mine&page_size=100"
        )
        self.assertEqual(mine.status_code, 200, mine.content[:400])
        rows = mine.json()["results"]
        self.assertEqual([row["id"] for row in rows], [self.own_listing.id])
        self.assertTrue(rows[0]["isMine"])

    def test_customer_matching_keeps_the_admin_scope_and_marks_owners(self):
        response = self.admin_client.get(
            "/listings/api/listings/recommendations/?page_size=100"
        )
        self.assertEqual(response.status_code, 200, response.content[:400])
        rows = {row["id"]: row for row in response.json()["results"]}
        self.assertIn(self.other_listing.id, rows)
        self.assertFalse(rows[self.other_listing.id]["isMine"])
        self.assertEqual(rows[self.other_listing.id]["consultantName"], "رضا مرادی")

    def _assert_inactive_owner_hidden(self, listing):
        active_agent = User.objects.create_user(
            username="staff-explore-active-peer", password="pw", role="AGENT"
        )
        active_listing = self._listing(
            "آگهی مشاور فعال دیگر", active_agent, self.sale, Listing.PublishChannel.WEBSITE
        )
        for client in (self.agent_client, self.admin_client):
            for path in (
                "/listings/api/listings/explore/?page_size=100",
                "/listings/api/listings/recommendations/?page_size=100",
            ):
                with self.subTest(user=client, path=path):
                    response = client.get(path)
                    self.assertEqual(response.status_code, 200, response.content[:400])
                    ids = {row["id"] for row in response.json()["results"]}
                    self.assertNotIn(listing.id, ids)
                    self.assertIn(active_listing.id, ids)
            detail = client.get(f"/listings/api/listings/explore/{listing.id}/")
            self.assertEqual(detail.status_code, 404)

    def test_inactive_consultant_user_is_hidden_from_explore_and_recommendations(self):
        self.other_agent.is_active = False
        self.other_agent.save(update_fields=["is_active"])
        self._assert_inactive_owner_hidden(self.other_listing)

    def test_inactive_consultant_profile_is_hidden_from_explore_and_recommendations(self):
        self.other_profile.is_active = False
        self.other_profile.save(update_fields=["is_active"])
        self._assert_inactive_owner_hidden(self.other_listing)

    def test_active_consultant_without_profile_remains_available(self):
        for path in ("explore", "recommendations"):
            response = self.agent_client.get(
                f"/listings/api/listings/{path}/?page_size=100"
            )
            self.assertEqual(response.status_code, 200, response.content[:400])
            self.assertIn(self.own_listing.id, {row["id"] for row in response.json()["results"]})
        detail = self.agent_client.get(
            f"/listings/api/listings/explore/{self.own_listing.id}/"
        )
        self.assertEqual(detail.status_code, 200, detail.content[:400])

    def test_active_assignee_takes_precedence_over_an_inactive_property_consultant(self):
        self.available_property.consultant = self.other_agent
        self.available_property.save(update_fields=["consultant", "updated_at"])
        self.other_agent.is_active = False
        self.other_agent.save(update_fields=["is_active"])
        for path in ("explore", "recommendations"):
            response = self.agent_client.get(
                f"/listings/api/listings/{path}/?page_size=100"
            )
            self.assertEqual(response.status_code, 200, response.content[:400])
            ids = {row["id"] for row in response.json()["results"]}
            self.assertIn(self.own_listing.id, ids)
            self.assertNotIn(self.other_listing.id, ids)
        detail = self.agent_client.get(
            f"/listings/api/listings/explore/{self.own_listing.id}/"
        )
        self.assertEqual(detail.status_code, 200, detail.content[:400])

    def test_inactive_assignee_never_falls_back_to_an_active_property_consultant(self):
        self.other_agent.is_active = False
        self.other_agent.save(update_fields=["is_active"])
        self._assert_inactive_owner_hidden(self.other_listing)

    def test_unassigned_listing_uses_the_active_property_consultant_read_only(self):
        self.other_listing.assigned_to = None
        self.other_listing.save(update_fields=["assigned_to", "updated_at"])
        for path in ("explore", "recommendations"):
            response = self.agent_client.get(
                f"/listings/api/listings/{path}/?page_size=100"
            )
            self.assertEqual(response.status_code, 200, response.content[:400])
            row = next(item for item in response.json()["results"] if item["id"] == self.other_listing.id)
            self.assertEqual(row["consultantId"], self.agent.id)
            self.assertEqual(row["consultantName"], "مینا کریمی")
            self.assertFalse(row["isMine"])
        detail = self.agent_client.get(
            f"/listings/api/listings/explore/{self.other_listing.id}/"
        )
        self.assertEqual(detail.status_code, 200, detail.content[:400])
        self.assertFalse(detail.json()["isMine"])
        private = self.agent_client.get(f"/listings/api/listings/{self.other_listing.id}/")
        self.assertEqual(private.status_code, 404)

    def test_unassigned_listing_with_inactive_property_consultant_is_hidden(self):
        self.other_listing.assigned_to = None
        self.other_listing.save(update_fields=["assigned_to", "updated_at"])
        ConsultantProfile.objects.create(user=self.agent, is_active=False)
        self._assert_inactive_owner_hidden(self.other_listing)

    def test_unassigned_listing_with_inactive_property_user_is_hidden(self):
        self.other_listing.assigned_to = None
        self.other_listing.save(update_fields=["assigned_to", "updated_at"])
        self.agent.is_active = False
        self.agent.save(update_fields=["is_active"])
        self._assert_inactive_owner_hidden(self.other_listing)

    def test_active_admin_without_profile_can_own_an_explorable_listing(self):
        listing = self._listing(
            "آگهی مدیر فعال", self.admin, self.sale, Listing.PublishChannel.WEBSITE
        )
        for path in ("explore", "recommendations"):
            response = self.agent_client.get(
                f"/listings/api/listings/{path}/?page_size=100"
            )
            self.assertEqual(response.status_code, 200, response.content[:400])
            self.assertIn(listing.id, {row["id"] for row in response.json()["results"]})
        response = self.agent_client.get(f"/listings/api/listings/explore/{listing.id}/")
        self.assertEqual(response.status_code, 200, response.content[:400])

    def test_inactive_admin_profile_is_not_an_active_recipient(self):
        listing = self._listing(
            "آگهی مدیر بایگانی‌شده", self.admin, self.sale, Listing.PublishChannel.WEBSITE
        )
        AdminProfile.objects.create(user=self.admin, is_active=False)
        self._assert_inactive_owner_hidden(listing)

    def test_inactive_admin_user_is_not_an_active_recipient(self):
        listing = self._listing(
            "آگهی مدیر غیرفعال", self.admin, self.sale, Listing.PublishChannel.WEBSITE
        )
        self.admin.is_active = False
        self.admin.save(update_fields=["is_active"])
        self._assert_inactive_owner_hidden(listing)

    def test_non_staff_owner_is_not_an_active_recipient(self):
        self.other_agent.groups.clear()
        self._assert_inactive_owner_hidden(self.other_listing)

    def test_other_agents_private_listing_stays_inaccessible_for_reads_and_writes(self):
        path = f"/listings/api/listings/{self.other_listing.id}/"
        self.assertEqual(self.agent_client.get(path).status_code, 404)
        response = self.agent_client.patch(path, {"title": "ویرایش غیرمجاز"}, format="json")
        self.assertEqual(response.status_code, 404)
        self.other_listing.refresh_from_db()
        self.assertEqual(self.other_listing.title, "آگهی مشاور دیگر")
