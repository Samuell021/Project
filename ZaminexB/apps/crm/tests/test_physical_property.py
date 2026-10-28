from django.apps import apps
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase

from apps.accounts.models import User
from apps.basics.models import DealType
from apps.crm.models import PropertyParty
from apps.listings.models import PropertyFile
from apps.properties.models import Property


class PhysicalPropertyTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="physical-property-agent", role="AGENT")
        DealType.objects.get_or_create(name="sale", defaults={"display_name": "فروش", "family": "SALE"})

    def create_property(self, **kwargs):
        return Property.objects.create(title="دارایی مستقل", consultant=self.user, area=90, address="نشانی", **kwargs)

    def test_property_has_no_stored_owner_price_or_deal_type(self):
        fields = {field.name for field in Property._meta.fields}
        self.assertFalse(fields & {"price", "deal_type", "owner_first_name", "owner_last_name", "owner_phone"})

    def test_compatibility_owner_input_writes_only_contact_and_party(self):
        prop = self.create_property(owner_first_name="نام", owner_last_name="مالک", owner_phone="09123456789")
        party = PropertyParty.objects.get(property=prop, ended_at__isnull=True)
        self.assertEqual(party.contact.full_name, "نام مالک")
        self.assertEqual(party.contact.phones.get().normalized_phone, "09123456789")
        prop.refresh_from_db()
        self.assertEqual(prop.owner_first_name, "نام")
        self.assertEqual(prop.owner_last_name, "مالک")
        self.assertEqual(prop.owner_phone, "09123456789")

    def test_owner_change_preserves_the_previous_relationship_and_person(self):
        prop = self.create_property(owner_first_name="مالک", owner_last_name="اول")
        old = PropertyParty.objects.get(property=prop)
        prop.owner_last_name = "دوم"
        prop.save()
        old.refresh_from_db()
        self.assertIsNotNone(old.ended_at)
        self.assertFalse(old.is_primary)
        self.assertEqual(old.contact.full_name, "مالک اول")
        self.assertEqual(PropertyParty.objects.get(property=prop, ended_at__isnull=True).contact.full_name, "مالک دوم")

    def test_physical_workspace_without_price_does_not_create_supply(self):
        prop = self.create_property(deal_type="SALE")
        self.assertFalse(PropertyFile.objects.filter(property=prop).exists())
        self.assertIsNone(prop.price)

    def test_legacy_sale_input_is_archived_without_creating_supply(self):
        prop = self.create_property(deal_type="SALE", price=1200)
        self.assertFalse(PropertyFile.objects.filter(property=prop).exists())
        self.assertTrue(prop.legacy_data["pricing_review_required"])
        self.assertEqual(prop.legacy_data["pricing"]["price"], "1200")
        self.assertIsNone(Property.objects.values_list("price", flat=True).get(pk=prop.pk))

    def test_unclassified_rental_amount_is_archived_not_inferred_as_deposit(self):
        prop = self.create_property(deal_type="RENT", price=1200)
        self.assertFalse(PropertyFile.objects.filter(property=prop).exists())
        self.assertTrue(prop.legacy_data["pricing_review_required"])
        self.assertIsNone(prop.price)


class PhysicalPropertyMigrationTests(TransactionTestCase):
    old_targets = [("properties", "0027_alter_property_consultant"), ("crm", "0008_alter_propertyparty_share_percent_and_more")]

    def setUp(self):
        self.latest = MigrationExecutor(connection).loader.graph.leaf_nodes()
        self.addCleanup(self.restore_latest)
        executor = MigrationExecutor(connection)
        executor.migrate(self.old_targets)
        self.old_apps = executor.loader.project_state(self.old_targets).apps

    def restore_latest(self):
        MigrationExecutor(connection).migrate(self.latest)

    def test_forward_and_reverse_preserve_original_data_without_publishing(self):
        UserModel = self.old_apps.get_model("accounts", "User")
        OldProperty = self.old_apps.get_model("properties", "Property")
        user = UserModel.objects.create(username="physical-migration")
        prop = OldProperty.objects.create(title="دارایی مهاجرت", internal_code="PHYSICAL-MIGRATION", consultant=user, area=90, address="نشانی", owner_first_name="نام", owner_last_name="پیشین", owner_phone="09123456780", deal_type="SALE", price=1250)
        self.restore_latest()
        current = Property.objects.get(pk=prop.pk)
        self.assertEqual(current.owner_last_name, "پیشین")
        self.assertEqual(current.price, 1250)
        self.assertEqual(current.legacy_data["pricing"]["price"], "1250")
        self.assertEqual(PropertyFile.objects.get(property=current).status, "DRAFT")
        executor = MigrationExecutor(connection)
        executor.migrate(self.old_targets)
        restored = executor.loader.project_state(self.old_targets).apps.get_model("properties", "Property").objects.get(pk=prop.pk)
        self.assertEqual(restored.owner_first_name, "نام")
        self.assertEqual(restored.owner_phone, "09123456780")
        self.assertEqual(restored.deal_type, "SALE")
        self.assertEqual(restored.price, 1250)
