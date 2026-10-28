import datetime
import json
from decimal import Decimal
from importlib import import_module
from types import SimpleNamespace

from django.apps import apps
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.serializers.json import DjangoJSONEncoder
from django.test import TestCase
from rest_framework.test import APIClient

from apps.basics.models import DealType, DealTypeVersion
from apps.basics.terms import default_terms_schema
from apps.listings.models import Listing, ListingVersion
from apps.properties.models import Property

User = get_user_model()


class ListingLifecycleTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="lifecycle-admin", password="pw", role="ADMIN")
        self.agent = User.objects.create_user(username="lifecycle-agent", password="pw", role="AGENT")
        self.client = APIClient()
        self.client.force_authenticate(self.agent)
        self.sale = DealType.objects.create(name="sale", display_name="فروش", family="SALE")
        self.version = DealTypeVersion.objects.create(deal_type=self.sale, version_number=1, family="SALE", terms_schema=default_terms_schema("SALE"), status="PUBLISHED")
        self.property = Property.objects.create(title="ملک چرخه", consultant=self.agent, area=90, address="نشانی", deal_type="SALE", review_status=Property.ReviewStatus.APPROVED, status=Property.Status.AVAILABLE)
        self.listing = self.create_listing()

    def create_listing(self, **kwargs):
        defaults = dict(property=self.property, title="فایل چرخه", publish_channel="WEBSITE", created_by=self.agent, assigned_to=self.agent, deal_type=self.sale, deal_type_version=self.version, terms={"sale_price": 1000}, sale_price=Decimal("1000"))
        defaults.update(kwargs)
        return Listing.objects.create(**defaults)

    def test_every_creation_and_change_records_an_immutable_snapshot(self):
        self.assertEqual(self.listing.version, 1)
        self.listing.sale_price = Decimal("2000")
        self.listing.save()
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.version, 2)
        versions = self.listing.versions.order_by("version_number")
        self.assertEqual([item.version_number for item in versions], [1, 2])
        self.assertEqual(versions.last().snapshot["sale_price"], "2000")
        with self.assertRaises(ValidationError):
            versions.first().save()
        with self.assertRaises(ValidationError):
            versions.first().delete()

    def test_unchanged_save_does_not_create_noise_versions(self):
        self.listing.save(update_fields=["title", "updated_at"])
        self.listing.updated_at = self.listing.updated_at
        self.assertEqual(self.listing.versions.count(), 1)

    def test_invalid_transitions_are_rejected_in_persian(self):
        with self.assertRaises(ValidationError):
            self.listing.transition_to(Listing.Status.ACTIVE)
        self.listing.transition_to(Listing.Status.PAUSED)
        self.listing.save()
        self.listing.transition_to(Listing.Status.SOLD)
        self.listing.save()
        with self.assertRaises(ValidationError):
            self.listing.transition_to(Listing.Status.ACTIVE)

    def test_publishing_requires_published_schema_terms_and_approved_property(self):
        other = Property.objects.create(title="ملک انتشار", consultant=self.agent, area=80, address="نشانی", deal_type="SALE", review_status=Property.ReviewStatus.APPROVED)
        draft = self.create_listing(property=other, status=Listing.Status.DRAFT, sale_price=Decimal("3000"))
        draft.deal_type_version = None
        with self.assertRaises(ValidationError):
            draft.transition_to(Listing.Status.ACTIVE)
        draft.deal_type_version = self.version
        other.review_status = Property.ReviewStatus.PENDING
        other.save(update_fields=["review_status", "updated_at"])
        with self.assertRaises(ValidationError):
            draft.transition_to(Listing.Status.ACTIVE)
        other.review_status = Property.ReviewStatus.APPROVED
        other.save(update_fields=["review_status", "updated_at"])
        draft.terms = {}
        with self.assertRaises(ValidationError):
            draft.transition_to(Listing.Status.ACTIVE)
        draft.terms = {"sale_price": 3000}
        draft.transition_to(Listing.Status.ACTIVE)
        draft.save()
        self.assertEqual(draft.versions.first().snapshot["status"], "ACTIVE")

    def test_transition_api_reports_version_conflicts_and_records_history(self):
        stale = self.listing.version
        self.listing.sale_price = Decimal("1500")
        self.listing.save()
        response = self.client.post(f"/listings/api/listings/{self.listing.pk}/transition/", {"status": "PAUSED", "version": stale}, format="json")
        self.assertEqual(response.status_code, 409, response.content[:300])
        response = self.client.post(f"/listings/api/listings/{self.listing.pk}/transition/", {"status": "PAUSED", "version": self.listing.version}, format="json")
        self.assertEqual(response.status_code, 200, response.content[:300])
        response = self.client.get(f"/listings/api/listings/{self.listing.pk}/versions/")
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(len(response.json()), 2)

    def test_terms_must_match_the_published_schema(self):
        other = Property.objects.create(title="ملک دیگر", consultant=self.agent, area=70, address="نشانی", deal_type="SALE", review_status=Property.ReviewStatus.APPROVED)
        with self.assertRaises(ValidationError):
            self.create_listing(property=other, title="شرایط نامعتبر", terms={"unknown": 1}, sale_price=Decimal("12"))


class VersionSnapshotMigrationTests(TestCase):
    def setUp(self):
        self.module = import_module("apps.listings.migrations.0014_propertyfile_terms_propertyfileversion")
        self.agent = User.objects.create_user(username="snapshot-agent", password="pw", role="AGENT")
        self.sale = DealType.objects.create(name="sale", display_name="فروش", family="SALE")
        self.version = DealTypeVersion.objects.create(deal_type=self.sale, version_number=1, family="SALE", terms_schema=default_terms_schema("SALE"), status="PUBLISHED")
        self.property = Property.objects.create(title="ملک مهاجرت", consultant=self.agent, area=80, address="نشانی", deal_type="SALE", review_status=Property.ReviewStatus.APPROVED)
        self.listing = Listing.objects.create(
            property=self.property,
            title="فایل مهاجرت",
            publish_channel="WEBSITE",
            created_by=self.agent,
            assigned_to=self.agent,
            deal_type=self.sale,
            deal_type_version=self.version,
            sale_price=Decimal("900"),
            price_details={"note": "جزئیات"},
            start_date=datetime.datetime(2026, 1, 5, 8, 30, tzinfo=datetime.timezone.utc),
            end_date=datetime.datetime(2026, 2, 5, 8, 30, tzinfo=datetime.timezone.utc),
        )
        self.listing.versions.all().delete()

    def test_existing_files_get_a_json_serializable_snapshot(self):
        schema_editor = SimpleNamespace(connection=SimpleNamespace(alias="default"))
        self.module.snapshot_existing(apps, schema_editor)
        version = ListingVersion.objects.get(property_file=self.listing, version_number=self.listing.version)
        self.assertEqual(version.snapshot["start_date"], "2026-01-05T08:30:00+00:00")
        self.assertEqual(version.snapshot["end_date"], "2026-02-05T08:30:00+00:00")
        self.assertEqual(version.snapshot["status"], self.listing.status)
        self.assertEqual(json.loads(json.dumps(version.snapshot, cls=DjangoJSONEncoder)), version.snapshot)

    def test_json_safe_converts_nested_dates_and_decimals(self):
        payload = self.module.json_safe({
            "when": datetime.datetime(2026, 3, 1, 10, 0),
            "day": datetime.date(2026, 3, 1),
            "amount": Decimal("12.5"),
            "nested": {"items": [Decimal("1"), datetime.date(2026, 4, 1)]},
        })
        self.assertEqual(payload["when"], "2026-03-01T10:00:00")
        self.assertEqual(payload["day"], "2026-03-01")
        self.assertEqual(payload["amount"], "12.5")
        self.assertEqual(payload["nested"]["items"], ["1", "2026-04-01"])
        self.assertEqual(json.loads(json.dumps(payload)), payload)
