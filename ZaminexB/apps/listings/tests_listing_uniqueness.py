from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from apps.basics.models import DealType
from apps.listings.models import Listing
from apps.properties.models import Property

User = get_user_model()


class ListingUniquenessTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="uq-admin", password="pw", role="ADMIN"
        )
        self.agent = User.objects.create_user(
            username="uq-agent", password="pw", role="AGENT"
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)
        self.property = Property.objects.create(
            title="آپارتمان یکتا",
            internal_code="P-UQ-1",
            consultant=self.agent,
            area=100,
            address="تهران",
            review_status=Property.ReviewStatus.APPROVED,
        )
        self.sale = DealType.objects.create(name="uq-sale", display_name="فروش")
        self.rent = DealType.objects.create(
            name="uq-mortgage-rent", display_name="رهن و اجاره"
        )
        self.listing = Listing.objects.create(
            property=self.property,
            deal_type=self.sale,
            title="آگهی فروش",
            publish_channel=Listing.PublishChannel.WEBSITE,
            created_by=self.agent,
            assigned_to=self.agent,
            status=Listing.Status.ACTIVE,
            sale_price=Decimal("1000000000"),
        )

    def test_second_listing_for_same_property_and_deal_type_is_rejected(self):
        response = self.client.post(
            "/listings/api/listings/",
            {
                "title": "آگهی فروش تکراری",
                "property": self.property.pk,
                "dealType": self.sale.pk,
                "publishChannel": "WEBSITE",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content[:400])
        self.assertIn("dealType", response.json())
        self.assertEqual(
            Listing.objects.filter(
                property=self.property, deal_type=self.sale
            ).count(),
            1,
        )

    def test_other_deal_type_for_same_property_is_allowed(self):
        response = self.client.post(
            "/listings/api/listings/",
            {
                "title": "آگهی رهن و اجاره",
                "property": self.property.pk,
                "dealType": self.rent.pk,
                "publishChannel": "WEBSITE",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content[:400])

    def test_archived_duplicate_is_stored_without_conflict(self):
        archived = Listing.objects.create(
            property=self.property,
            deal_type=self.sale,
            title="آگهی فروش بایگانی",
            publish_channel=Listing.PublishChannel.WEBSITE,
            created_by=self.agent,
            status=Listing.Status.ARCHIVED,
        )
        self.assertEqual(archived.status, Listing.Status.ARCHIVED)
        self.assertEqual(
            Listing.objects.filter(
                property=self.property, deal_type=self.sale
            ).count(),
            2,
        )

    def test_database_rejects_active_duplicate(self):
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Listing.objects.create(
                    property=self.property,
                    deal_type=self.sale,
                    title="آگهی فروش تکراری",
                    publish_channel=Listing.PublishChannel.WEBSITE,
                    created_by=self.agent,
                    status=Listing.Status.PAUSED,
                )

    def test_unarchive_is_blocked_when_another_listing_is_active(self):
        archived = Listing.objects.create(
            property=self.property,
            deal_type=self.sale,
            title="آگهی فروش بایگانی",
            publish_channel=Listing.PublishChannel.WEBSITE,
            created_by=self.agent,
            status=Listing.Status.ARCHIVED,
        )
        response = self.client.post(
            f"/listings/api/listings/{archived.pk}/unarchive/"
        )
        self.assertEqual(response.status_code, 400, response.content[:400])
        archived.refresh_from_db()
        self.assertEqual(archived.status, Listing.Status.ARCHIVED)

    def test_unarchive_succeeds_when_no_other_listing_exists(self):
        self.listing.status = Listing.Status.ARCHIVED
        self.listing.save(update_fields=["status"])
        response = self.client.post(
            f"/listings/api/listings/{self.listing.pk}/unarchive/"
        )
        self.assertEqual(response.status_code, 200, response.content[:400])
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.status, Listing.Status.ACTIVE)

    def test_unarchive_without_deal_type_is_not_blocked(self):
        for title in ("آگهی بدون نوع ۱", "آگهی بدون نوع ۲"):
            Listing.objects.create(
                property=self.property,
                title=title,
                publish_channel=Listing.PublishChannel.WEBSITE,
                created_by=self.agent,
                status=Listing.Status.ACTIVE,
            )
        target = Listing.objects.filter(
            property=self.property, deal_type__isnull=True
        ).first()
        target.status = Listing.Status.ARCHIVED
        target.save(update_fields=["status"])
        response = self.client.post(
            f"/listings/api/listings/{target.pk}/unarchive/"
        )
        self.assertEqual(response.status_code, 200, response.content[:400])
        target.refresh_from_db()
        self.assertEqual(target.status, Listing.Status.ACTIVE)

    def test_editing_listing_keeps_deal_type_and_succeeds(self):
        response = self.client.patch(
            f"/listings/api/listings/{self.listing.pk}/",
            {"title": "آگهی فروش اصلاح‌شده", "dealType": self.sale.pk},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content[:400])

    def test_changing_deal_type_to_existing_one_is_rejected(self):
        rent_listing = Listing.objects.create(
            property=self.property,
            deal_type=self.rent,
            title="آگهی رهن و اجاره",
            publish_channel=Listing.PublishChannel.WEBSITE,
            created_by=self.agent,
            status=Listing.Status.ACTIVE,
        )
        response = self.client.patch(
            f"/listings/api/listings/{rent_listing.pk}/",
            {"dealType": self.sale.pk},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content[:400])
        rent_listing.refresh_from_db()
        self.assertEqual(rent_listing.deal_type_id, self.rent.pk)

    def test_listings_without_deal_type_are_not_limited(self):
        for title in ("آگهی بدون نوع ۱", "آگهی بدون نوع ۲"):
            Listing.objects.create(
                property=self.property,
                title=title,
                publish_channel=Listing.PublishChannel.WEBSITE,
                created_by=self.agent,
                status=Listing.Status.ACTIVE,
            )
        self.assertEqual(
            Listing.objects.filter(
                property=self.property, deal_type__isnull=True
            ).count(),
            2,
        )
