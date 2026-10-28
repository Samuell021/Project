from django.contrib.auth.models import Group
from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import StaffProfile, User
from apps.accounts.permissions import permission_codes_for_user
from apps.crm.models import CommandReceipt, Contact, ContactPhone
from apps.crm.phones import normalize_phone


class FoundationApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="foundation-admin", password="test-password", role="ADMIN")
        self.agent = User.objects.create_user(username="foundation-agent", password="test-password", role="AGENT")
        self.finance = User.objects.create_user(username="foundation-finance", password="test-password", role="FINANCE")
        self.client.force_authenticate(self.admin)

    def test_role_is_derived_from_groups_and_is_read_only(self):
        self.assertEqual(self.admin.role, "ADMIN")
        self.admin.groups.set([Group.objects.get(name="FINANCE")])
        self.assertEqual(self.admin.role, "FINANCE")
        with self.assertRaises(AttributeError):
            self.admin.role = "ADMIN"
        self.assertNotIn("role", {field.name for field in User._meta.fields})

    def test_me_has_permissions_and_scopes(self):
        response = self.client.get("/crm/api/me/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("staff.manage", response.data["permissions"])
        self.assertTrue(response.data["capabilities"]["staff.manage"])
        self.assertEqual(response.data["groups"][0]["name"], "GENERAL_MANAGER")
        self.assertEqual(response.data["scopes"], [])

    def test_staff_is_distinct_from_contacts_and_legacy_profile_is_preserved(self):
        payload = {"username": "foundation-staff", "password": "StrongPassword123", "full_name": "کارمند نمونه", "branch": "مرکز", "staff_code": "S-001"}
        response = self.client.post("/crm/api/staff/", payload, format="json", HTTP_IDEMPOTENCY_KEY="staff-once")
        self.assertEqual(response.status_code, 201, response.data)
        again = self.client.post("/crm/api/staff/", payload, format="json", HTTP_IDEMPOTENCY_KEY="staff-once")
        self.assertEqual(again.data["id"], response.data["id"])
        self.assertEqual(StaffProfile.objects.filter(staff_code="S-001").count(), 1)
        self.assertFalse(Contact.objects.filter(full_name="کارمند نمونه").exists())
        self.assertEqual(CommandReceipt.objects.filter(actor=self.admin, idempotency_key="staff-once").count(), 1)
        profile = StaffProfile.objects.get(pk=response.data["id"])
        self.assertEqual(profile.user.consultant_profile, profile)
        self.assertEqual(profile.user.role, "AGENT")

    def test_staff_version_conflict_is_409_and_does_not_change_record(self):
        profile = StaffProfile.objects.create(user=self.agent, full_name="مشاور نمونه", branch="مرکز")
        url = f"/crm/api/staff/{profile.pk}/"
        response = self.client.patch(url, {"version": 1, "full_name": "نام تازه"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["version"], 2)
        conflict = self.client.patch(url, {"version": 1, "full_name": "نام کهنه"}, format="json")
        self.assertEqual(conflict.status_code, 409, conflict.data)
        profile.refresh_from_db()
        self.assertEqual(profile.full_name, "نام تازه")

    def test_staff_endpoint_rejects_agents_and_finance(self):
        for user in [self.agent, self.finance]:
            self.client.force_authenticate(user)
            response = self.client.get("/crm/api/staff/")
            self.assertEqual(response.status_code, 403, response.data)

    def test_group_management_endpoints_are_gone(self):
        for endpoint in ["groups", "permissions"]:
            self.assertEqual(self.client.get(f"/crm/api/{endpoint}/").status_code, 404, endpoint)

    def test_contacts_reject_duplicate_normalized_numbers_without_partial_writes(self):
        payload = {"full_name": "شخص نمونه", "phones": [{"phone": "۰۹۱۲۳۴۵۶۷۸۹"}, {"phone": "+98 912 345 6789"}]}
        response = self.client.post("/crm/api/contacts/", payload, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(Contact.objects.filter(full_name="شخص نمونه").exists())

    def test_contact_phones_allow_shared_numbers_but_are_unique_per_contact(self):
        one = Contact.objects.create(full_name="شخص اول")
        two = Contact.objects.create(full_name="شخص دوم")
        ContactPhone.objects.create(contact=one, phone="۰۹۱۲۳۴۵۶۷۸۹")
        ContactPhone.objects.create(contact=two, phone="0098 912 345 6789")
        self.assertEqual(normalize_phone("٠٩١٢٣٤٥٦٧٨٩"), "09123456789")
        self.assertEqual(ContactPhone.objects.filter(normalized_phone="09123456789").count(), 2)
        with self.assertRaises(IntegrityError), transaction.atomic():
            ContactPhone.objects.create(contact=one, phone="+98 912 345 6789")

    def test_pagination_search_and_boolean_filter(self):
        StaffProfile.objects.create(user=self.agent, full_name="مشاور روشن", branch="مرکز", is_active=False)
        response = self.client.get("/crm/api/staff/", {"search": "روشن", "active": "false", "page_size": 1, "ordering": "full_name"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(len(response.data["results"]), 1)

    def test_membership_revocation_via_reverse_relation_is_immediate(self):
        group = Group.objects.get(name="GENERAL_MANAGER")
        self.assertEqual(self.admin.role, "ADMIN")
        group.user_set.remove(self.admin)
        self.assertEqual(self.admin.role, "")
        self.assertNotIn("staff.manage", permission_codes_for_user(self.admin))

    def test_phone_duplicate_hints_do_not_disclose_other_ranges(self):
        visible = Contact.objects.create(full_name="شخص قابل مشاهده", created_by=self.agent)
        hidden = Contact.objects.create(full_name="شخص خارج از حوزه", created_by=self.finance)
        ContactPhone.objects.create(contact=visible, phone="09123456789")
        ContactPhone.objects.create(contact=hidden, phone="+98 912 345 6789")
        self.client.force_authenticate(self.agent)
        response = self.client.get(f"/crm/api/contacts/{visible.pk}/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["duplicate_phone_ids"], [])

    def test_staff_update_ignores_group_assignment(self):
        profile = StaffProfile.objects.create(user=self.agent, full_name="کارمند", branch="مرکز")
        before = set(self.agent.groups.values_list("name", flat=True))
        response = self.client.patch(f"/crm/api/staff/{profile.pk}/", {"version": 1, "groups": [Group.objects.get(name="GENERAL_MANAGER").pk]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(set(self.agent.groups.values_list("name", flat=True)), before)

    def test_contact_update_is_versioned_and_replays_safely(self):
        contact = Contact.objects.create(full_name="شخص نخست", created_by=self.admin)
        url = f"/crm/api/contacts/{contact.pk}/"
        payload = {"full_name": "شخص اصلاح‌شده", "version": 1, "phones": [{"phone": "09123456789", "is_primary": True}]}
        response = self.client.patch(url, payload, format="json", HTTP_IDEMPOTENCY_KEY="contact-update-once")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["version"], 2)
        replay = self.client.patch(url, payload, format="json", HTTP_IDEMPOTENCY_KEY="contact-update-once")
        self.assertEqual(replay.data, response.data)
        stale = self.client.patch(url, payload, format="json", HTTP_IDEMPOTENCY_KEY="contact-update-stale")
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(ContactPhone.objects.filter(contact=contact).count(), 1)
        contact.refresh_from_db()
        self.assertEqual(contact.version, 2)

    def test_contact_update_without_a_version_does_not_modify_nested_phones(self):
        contact = Contact.objects.create(full_name="شخص محفوظ", created_by=self.admin)
        phone = ContactPhone.objects.create(contact=contact, phone="09123456789")
        response = self.client.patch(f"/crm/api/contacts/{contact.pk}/", {"full_name": "تغییر بی‌نسخه", "phones": []}, format="json")
        self.assertEqual(response.status_code, 400)
        contact.refresh_from_db()
        self.assertEqual(contact.full_name, "شخص محفوظ")
        self.assertTrue(ContactPhone.objects.filter(pk=phone.pk).exists())

    def test_related_contacts_expose_owned_properties_within_scope(self):
        from apps.crm.models import PropertyParty
        from apps.properties.models import Property

        contact = Contact.objects.create(full_name="مالک مرتبط", created_by=self.admin)
        prop = Property.objects.create(title="ملک مرتبط", consultant=self.admin, area=80, address="نشانی", owner_first_name="مالک", owner_last_name="مرتبط")
        party = PropertyParty.objects.get(property=prop)
        response = self.client.get(f"/crm/api/contacts/{party.contact_id}/related/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["properties"][0]["id"], prop.pk)
        self.assertEqual(response.data["properties"][0]["role"], "OWNER")
        self.client.force_authenticate(self.agent)
        hidden = self.client.get(f"/crm/api/contacts/{party.contact_id}/related/")
        self.assertEqual(hidden.status_code, 404)
        self.assertFalse(Contact.objects.filter(pk=contact.pk, property_links__isnull=False).count() > 1)


class DealTypeSchemaTests(TestCase):
    def test_all_six_schemas_have_labels_types_and_required_fields(self):
        from apps.basics.terms import BEHAVIOR_FIELDS, default_terms_schema, validate_terms_schema

        self.assertEqual(len(BEHAVIOR_FIELDS), 6)
        for behavior in BEHAVIOR_FIELDS:
            schema = default_terms_schema(behavior)
            self.assertEqual(validate_terms_schema(schema), schema)
            self.assertTrue(all(field["label"] and isinstance(field["required"], bool) for field in schema["fields"]))

    def test_published_versions_are_immutable(self):
        from django.core.exceptions import ValidationError
        from apps.basics.models import DealType, DealTypeVersion

        deal_type = DealType.objects.create(name="schema-sale", display_name="فروش", family="SALE")
        version = DealTypeVersion.objects.create(deal_type=deal_type, version_number=1, family="SALE", status="PUBLISHED")
        self.assertEqual(version.terms_schema["fields"][0]["key"], "sale_price")
        version.terms_schema = {"fields": []}
        with self.assertRaises(ValidationError):
            version.save()
        version.refresh_from_db()
        self.assertEqual(version.terms_schema["fields"][0]["key"], "sale_price")

    def test_integer_toman_and_required_fields_are_validated(self):
        from django.core.exceptions import ValidationError
        from apps.basics.terms import default_terms_schema, validate_terms

        schema = default_terms_schema("RENT")
        for invalid in [{}, {"deposit": "1.5", "monthly_rent": 10}, {"deposit": -1, "monthly_rent": 10}, {"deposit": "NaN", "monthly_rent": 10}]:
            with self.assertRaises(ValidationError):
                validate_terms(schema, invalid)
        self.assertEqual(validate_terms(schema, {"deposit": 0, "monthly_rent": "1000"})["deposit"], 0)

    def test_deal_type_list_exposes_only_the_latest_published_version(self):
        from apps.basics.models import DealType, DealTypeVersion

        client = APIClient()
        client.force_authenticate(User.objects.create_user(username="dealtype-reader", password="test-password", role="AGENT"))

        released_twice = DealType.objects.create(name="ops-sale", display_name="فروش", family="SALE", sort_order=1)
        DealTypeVersion.objects.create(deal_type=released_twice, version_number=1, family="SALE", status="PUBLISHED")
        latest = DealTypeVersion.objects.create(deal_type=released_twice, version_number=2, family="SALE", status="PUBLISHED")
        # A newer draft must never be offered to the registration wizard.
        DealTypeVersion.objects.create(deal_type=released_twice, version_number=3, family="SALE", status="DRAFT")

        unreleased = DealType.objects.create(name="ops-rent", display_name="رهن و اجاره", family="RENT", sort_order=2)
        DealTypeVersion.objects.create(deal_type=unreleased, version_number=1, family="RENT", status="DRAFT")

        response = client.get("/crm/api/deal-types/")
        self.assertEqual(response.status_code, 200, response.data)
        rows = {row["name"]: row for row in response.data["results"]}
        self.assertIn("ops-sale", rows)
        self.assertIn("ops-rent", rows)

        published = rows["ops-sale"]["published_version"]
        self.assertIsNotNone(published)
        self.assertEqual(published["id"], latest.id)
        self.assertEqual(published["version_number"], 2)
        self.assertEqual(published["status"], "PUBLISHED")
        self.assertTrue(published["terms_schema"]["fields"])

        self.assertIsNone(rows["ops-rent"]["published_version"])


class DemoSeedTests(TestCase):
    def test_full_seed_is_idempotent_and_preserves_existing_passwords(self):
        from io import StringIO
        from tempfile import TemporaryDirectory

        from django.core.management import call_command
        from django.test import override_settings

        from apps.activity.models import ActivityLog
        from apps.analytics.models import AIInsightCache
        from apps.accounts.models import SalesRange, ScopeMembership, ScopeTransferHistory, SmsProviderSettings
        from apps.basics.models import DealTypeAttribute, DealTypeVersion
        from apps.crm import models
        from apps.followups.models import FollowUp
        from apps.listings.models import (
            PropertyFile,
            PropertyFileAttributeValue,
            PropertyFilePriceHistory,
            PropertyFileVersion,
        )
        from apps.notifications.models import Notification
        from apps.properties.models import Property, PropertyAppraisalReport, PropertyAttributeValue, PropertyImage
        from apps.tasks.models import Task
        from apps.tickets.models import Ticket, TicketAttachment, TicketAuditEvent, TicketMessage, TicketParticipant

        output = StringIO()
        tracked = [
            User,
            StaffProfile,
            SalesRange,
            ScopeMembership,
            ScopeTransferHistory,
            Contact,
            ContactPhone,
            models.PropertyParty,
            models.PropertyRegistrationRequest,
            models.RegistrationRequestDealType,
            models.PropertyAppraisal,
            models.PropertyReview,
            models.AssignmentHistory,
            models.AssignmentRescheduleRequest,
            models.ConsultantWithdrawalRequest,
            Property,
            PropertyAttributeValue,
            PropertyImage,
            PropertyAppraisalReport,
            PropertyFile,
            PropertyFileVersion,
            PropertyFileAttributeValue,
            PropertyFilePriceHistory,
            DealTypeAttribute,
            models.Inquiry,
            models.InquiryPreference,
            models.Introduction,
            models.Viewing,
            models.Deal,
            models.DealParticipant,
            models.Contract,
            models.ContractParty,
            models.ContractSignature,
            models.ContractAmendment,
            models.CommissionPolicyVersion,
            models.Commission,
            models.CommissionShare,
            models.Payment,
            models.PaymentAllocation,
            Task,
            FollowUp,
            Ticket,
            TicketParticipant,
            TicketMessage,
            TicketAttachment,
            TicketAuditEvent,
            ActivityLog,
            AIInsightCache,
            Notification,
            models.WorkflowSettings,
            DealTypeVersion,
        ]

        # Keep generated media inside a temporary directory during tests.
        with TemporaryDirectory() as media_root, override_settings(MEDIA_ROOT=media_root):
            call_command("seed_demo_data", password="DemoPasswordForTests329!", stdout=output)
            counts = {model._meta.label: model.objects.count() for model in tracked}

            self.assertEqual(User.objects.filter(username__startswith="demo.").count(), 8)
            self.assertEqual(SalesRange.objects.count(), 3)
            self.assertEqual(Contact.objects.count(), 10)
            self.assertEqual(ContactPhone.objects.count(), 10)
            self.assertEqual(models.PropertyRegistrationRequest.objects.count(), 12)
            self.assertEqual(Property.objects.count(), 10)
            self.assertEqual(PropertyFile.objects.count(), 6)
            self.assertEqual(PropertyFileAttributeValue.objects.count(), 6)
            self.assertEqual(
                DealTypeAttribute.objects.filter(attribute__name="demo_listing_note").count(), 6
            )
            self.assertEqual(DealTypeVersion.objects.filter(status="PUBLISHED").count(), 6)
            self.assertEqual(PropertyImage.objects.count(), 10)
            self.assertEqual(PropertyAppraisalReport.objects.count(), 6)
            self.assertEqual(Ticket.objects.count(), 2)
            self.assertEqual(TicketAttachment.objects.count(), 1)
            self.assertEqual(models.ContractAttachment.objects.count(), 1)
            self.assertEqual(AIInsightCache.objects.count(), 0)
            self.assertEqual(
                set(models.Deal.objects.values_list("stage", flat=True)),
                {"NEGOTIATION", "AGREED", "CONTRACT", "LOST", "FINALIZED"},
            )
            self.assertEqual(
                set(PropertyFile.objects.values_list("status", flat=True)),
                {"ACTIVE", "PAUSED", "DRAFT", "SOLD"},
            )
            self.assertEqual(User.objects.get(username="demo.contract").role, "FINANCE")
            self.assertTrue(all(phone.startswith("000") for phone in ContactPhone.objects.values_list("phone", flat=True)))
            self.assertTrue(all((contact.email or "").endswith("@example.invalid") for contact in Contact.objects.all()))
            sms_settings = SmsProviderSettings.objects.get(pk=1)
            self.assertEqual(sms_settings.smsir_api_key, "")
            self.assertEqual(sms_settings.kavenegar_api_key, "")

            password = User.objects.get(username="demo.general").password
            call_command("seed_crm_demo", password="DifferentPassword498!", stdout=output)
            self.assertEqual(counts, {model._meta.label: model.objects.count() for model in tracked})
            self.assertEqual(User.objects.get(username="demo.general").password, password)

        self.assertNotIn("DemoPasswordForTests", output.getvalue())
        self.assertNotIn("DifferentPassword498", output.getvalue())

    def test_dry_run_does_not_write_and_non_debug_seed_is_refused(self):
        from io import StringIO
        from unittest.mock import patch

        from django.core.management import call_command
        from django.core.management.base import CommandError
        from django.test import override_settings

        from apps.common.management.commands.seed_demo_data import Command
        from apps.crm.models import PropertyRegistrationRequest

        before = (User.objects.count(), Contact.objects.count(), PropertyRegistrationRequest.objects.count())
        call_command("seed_demo_data", "--dry-run", stdout=StringIO())
        after = (User.objects.count(), Contact.objects.count(), PropertyRegistrationRequest.objects.count())
        self.assertEqual(before, after)

        with override_settings(DEBUG=False), patch.object(Command, "_is_test_database", return_value=False):
            with self.assertRaises(CommandError):
                call_command("seed_demo_data", "--dry-run", stdout=StringIO())


class GroupRevocationTests(TestCase):
    def test_empty_group_permissions_are_not_reseeded(self):
        from django.apps import apps
        from apps.accounts.signals import ensure_permission_catalog

        user = User.objects.create_user(username="revoked-agent", role="AGENT")
        group = Group.objects.get(name="AGENT")
        group.permissions.clear()
        ensure_permission_catalog(sender=apps.get_app_config("accounts"))
        self.assertEqual(permission_codes_for_user(user), set())

    def test_staff_role_input_cannot_bypass_group_permission(self):
        client = APIClient()
        admin = User.objects.create_user(username="staff-role-admin", role="ADMIN")
        client.force_authenticate(admin)
        response = client.post("/crm/api/staff/", {"username": "invalid-staff", "password": "StrongPassword482!", "full_name": "کارمند", "branch": "مرکز", "role": "RANGE_MANAGER"}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(User.objects.filter(username="invalid-staff").exists())


class IntegerTomanMigrationTests(TestCase):
    def test_fractional_legacy_amounts_stop_before_column_conversion(self):
        from decimal import Decimal
        from importlib import import_module
        from unittest.mock import MagicMock

        guard = import_module("apps.properties.migrations.0028_check_integer_toman_prices")
        apps = MagicMock()
        apps.get_model.return_value.objects.using.return_value.values_list.return_value.iterator.return_value = [(7, Decimal("1.50"))]
        with self.assertRaisesRegex(RuntimeError, "تعیین تکلیف"):
            guard.check_prices(apps, MagicMock())

    def test_integer_and_unknown_legacy_amounts_are_preserved(self):
        from decimal import Decimal
        from importlib import import_module
        from unittest.mock import MagicMock

        guard = import_module("apps.properties.migrations.0028_check_integer_toman_prices")
        apps = MagicMock()
        apps.get_model.return_value.objects.using.return_value.values_list.return_value.iterator.return_value = [(1, None), (2, Decimal("1200.00"))]
        guard.check_prices(apps, MagicMock())


class PropertyPartyShareTests(TestCase):
    def setUp(self):
        from apps.properties.models import Property

        self.user = User.objects.create_user(username="party-share-agent", role="AGENT")
        self.property = Property.objects.create(title="ملک سهم", consultant=self.user, property_type="APARTMENT", area=100, address="نشانی")
        self.contact = Contact.objects.create(full_name="مالک سهم")

    def test_database_rejects_negative_and_excessive_shares(self):
        from apps.crm.models import PropertyParty

        for share in (-1, 101):
            with self.subTest(share=share), self.assertRaises(IntegrityError), transaction.atomic():
                PropertyParty.objects.create(property=self.property, contact=self.contact, share_percent=share)

    def test_zero_full_and_unknown_shares_are_valid(self):
        from apps.crm.models import PropertyParty

        for share in (0, 100, None):
            contact = Contact.objects.create(full_name="ذی‌نفع")
            party = PropertyParty.objects.create(property=self.property, contact=contact, share_percent=share)
            party.refresh_from_db()
            self.assertEqual(party.share_percent, share)
