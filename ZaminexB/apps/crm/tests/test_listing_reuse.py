from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.basics.models import DealType, DealTypeVersion
from apps.listings.models import Listing
from apps.properties.models import Property


class CrmListingReuseTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="reuse-gm", password="x", role="ADMIN"
        )
        self.deal_type = DealType.objects.create(
            name="reuse-sale", display_name="فروش"
        )
        DealTypeVersion.objects.create(
            deal_type=self.deal_type,
            version_number=1,
            status=DealTypeVersion.Status.PUBLISHED,
            published_at=timezone.now(),
        )
        self.property = Property.objects.create(
            title="ملک استفاده مجدد",
            internal_code="P-RU-1",
            consultant=self.admin,
            area=90,
            address="تهران",
            status=Property.Status.AVAILABLE,
            review_status=Property.ReviewStatus.APPROVED,
        )
        self.active_listing = Listing.objects.create(
            property=self.property,
            deal_type=self.deal_type,
            title="آگهی فعال",
            publish_channel=Listing.PublishChannel.WEBSITE,
            created_by=self.admin,
            status=Listing.Status.ACTIVE,
            sale_price=Decimal("1000"),
        )
        self.archived_listing = Listing.objects.create(
            property=self.property,
            deal_type=self.deal_type,
            title="آگهی بایگانی",
            publish_channel=Listing.PublishChannel.WEBSITE,
            created_by=self.admin,
            status=Listing.Status.ARCHIVED,
            sale_price=Decimal("2000"),
        )
        Listing.objects.filter(pk=self.archived_listing.pk).update(
            created_at=timezone.now()
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def _save_listing(self, price="3000"):
        return self.client.post(
            "/crm/api/crm-listings/save_listing/",
            {
                "property": self.property.pk,
                "deal_type": self.deal_type.pk,
                "sale_price": price,
                "status": Listing.Status.ACTIVE,
            },
            format="json",
        )

    def test_save_listing_reuses_active_listing_instead_of_archived_one(self):
        response = self._save_listing()
        self.assertEqual(response.status_code, 200, response.content[:400])
        self.active_listing.refresh_from_db()
        self.archived_listing.refresh_from_db()
        self.assertEqual(self.active_listing.version, 2)
        self.assertEqual(self.active_listing.sale_price, Decimal("3000"))
        self.assertEqual(self.archived_listing.status, Listing.Status.ARCHIVED)
        self.assertEqual(
            Listing.objects.filter(
                property=self.property, deal_type=self.deal_type
            ).count(),
            2,
        )

    def test_save_listing_creates_new_listing_when_only_archived_exists(self):
        self.active_listing.status = Listing.Status.ARCHIVED
        self.active_listing.save(update_fields=["status"])
        response = self._save_listing()
        self.assertEqual(response.status_code, 200, response.content[:400])
        created = Listing.objects.get(pk=response.json()["id"])
        self.assertNotIn(created.pk, (self.active_listing.pk, self.archived_listing.pk))
        self.assertEqual(created.status, Listing.Status.ACTIVE)
        self.assertEqual(
            Listing.objects.filter(
                property=self.property,
                deal_type=self.deal_type,
                status=Listing.Status.ACTIVE,
            ).count(),
            1,
        )
