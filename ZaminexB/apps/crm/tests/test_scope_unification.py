from datetime import timedelta

from django.apps import apps
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import ManagementScope, SalesRange, ScopeMembership, User
from apps.accounts.scope_memberships import active_memberships
from apps.accounts.scoping import team_user_ids


class ScopeMembershipTests(TestCase):
    def setUp(self):
        self.manager = User.objects.create_user(username="scope-manager", role="RANGE_MANAGER")
        self.member = User.objects.create_user(username="scope-member", role="AGENT")
        self.sales_range = SalesRange.objects.create(name="رنج واحد")
        self.now = timezone.now()

    def membership(self, **kwargs):
        values = {"sales_range": self.sales_range, "user": self.member, "membership_role": "MEMBER", "started_at": self.now - timedelta(days=1)}
        values.update(kwargs)
        return ScopeMembership.objects.create(**values)

    def test_scope_alias_does_not_register_a_second_model(self):
        self.assertIs(ManagementScope, SalesRange)
        self.assertNotIn("legacymanagementscope", apps.all_models["accounts"])

    def test_membership_with_a_future_end_does_not_create_an_open_duplicate(self):
        membership = self.membership(ended_at=self.now + timedelta(days=1))
        self.assertTrue(self.sales_range.members.filter(pk=self.member.pk).exists())
        self.assertEqual(ScopeMembership.objects.count(), 1)
        self.sales_range.members.add(self.member)
        self.assertEqual(ScopeMembership.objects.count(), 1)
        self.assertTrue(active_memberships().filter(pk=membership.pk).exists())

    def test_historical_and_future_memberships_do_not_authorize(self):
        self.membership(ended_at=self.now - timedelta(hours=1))
        self.membership(started_at=self.now + timedelta(days=1))
        self.assertFalse(active_memberships().filter(user=self.member).exists())
        self.assertFalse(self.sales_range.members.filter(pk=self.member.pk).exists())

    def test_compatibility_add_remove_preserves_history(self):
        self.sales_range.members.add(self.member)
        first = ScopeMembership.objects.get(user=self.member)
        self.sales_range.members.remove(self.member)
        first.refresh_from_db()
        self.assertIsNotNone(first.ended_at)
        self.assertFalse(active_memberships().filter(user=self.member).exists())
        self.sales_range.members.add(self.member)
        self.assertEqual(ScopeMembership.objects.filter(user=self.member).count(), 2)
        self.assertEqual(active_memberships().filter(user=self.member).count(), 1)

    def test_forward_and_reverse_clear_close_manager_and_member_history(self):
        self.sales_range.managers.add(self.manager)
        self.sales_range.members.add(self.member)
        self.member.sales_ranges.clear()
        self.manager.managed_ranges.clear()
        self.assertFalse(active_memberships().exists())
        self.sales_range.members.add(self.member)
        self.sales_range.managers.add(self.manager)
        self.sales_range.members.clear()
        self.sales_range.managers.clear()
        self.assertFalse(active_memberships().exists())

    def test_scope_changes_are_not_hidden_by_a_cached_team(self):
        self.sales_range.managers.add(self.manager)
        self.assertEqual(team_user_ids(self.manager), {self.manager.pk})
        membership = self.membership(ended_at=self.now + timedelta(days=1))
        self.assertIn(self.member.pk, team_user_ids(self.manager))
        membership.ended_at = self.now
        membership.save(update_fields=["ended_at"])
        self.assertNotIn(self.member.pk, team_user_ids(self.manager))
        self.assertFalse(self.sales_range.members.filter(pk=self.member.pk).exists())

    def test_inactive_ranges_do_not_authorize(self):
        self.sales_range.managers.add(self.manager)
        self.membership()
        self.sales_range.is_active = False
        self.sales_range.save(update_fields=["is_active"])
        self.assertEqual(team_user_ids(self.manager), {self.manager.pk})

    def test_deleting_membership_removes_only_its_projection(self):
        self.sales_range.managers.add(self.manager)
        membership = self.membership()
        membership.delete()
        self.assertFalse(self.sales_range.members.filter(pk=self.member.pk).exists())
        self.assertTrue(self.sales_range.managers.filter(pk=self.manager.pk).exists())


class ScopeApiTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="scope-api-admin", role="ADMIN")
        self.member = User.objects.create_user(username="scope-api-member", role="AGENT")
        self.sales_range = SalesRange.objects.create(name="رنج نسخه‌دار")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_scope_api_only_reads_ranges_managed_in_settings(self):
        response = self.client.get("/crm/api/scopes/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([row["name"] for row in response.data["results"]], ["رنج نسخه‌دار"])
        self.assertEqual(self.client.patch(f"/crm/api/scopes/{self.sales_range.pk}/", {"name": "نام تازه"}, format="json").status_code, 405)
        self.assertEqual(self.client.post("/crm/api/scopes/", {"name": "رنج تازه"}, format="json").status_code, 405)

    def test_settings_range_membership_feeds_the_crm_projection(self):
        self.client.patch(f"/accounts/ranges/{self.sales_range.pk}/", {"member_ids": [self.member.pk]}, format="json")
        self.assertTrue(self.sales_range.members.filter(pk=self.member.pk).exists())
        memberships = self.client.get("/crm/api/scope-memberships/").data["results"]
        self.assertEqual([row["user"] for row in memberships], [self.member.pk])


class ScopeMigrationTests(TransactionTestCase):
    old_targets = [("accounts", "0023_groupsettings"), ("crm", "0006_contact_version_propertyparty_delete_propertycontact_and_more")]

    def setUp(self):
        self.latest = MigrationExecutor(connection).loader.graph.leaf_nodes()
        self.addCleanup(self.restore_latest)
        executor = MigrationExecutor(connection)
        executor.migrate(self.old_targets)
        self.old_apps = executor.loader.project_state(self.old_targets).apps

    def restore_latest(self):
        MigrationExecutor(connection).migrate(self.latest)

    def test_populated_legacy_scope_round_trip_preserves_references(self):
        old = self.old_apps
        user = old.get_model("accounts", "User").objects.create(username="scope-migration")
        sales_range = old.get_model("accounts", "SalesRange").objects.create(name="رنج مشترک")
        legacy = old.get_model("accounts", "LegacyManagementScope").objects.create(name="حوزه سابق", sales_range=sales_range)
        contact = old.get_model("crm", "Contact").objects.create(full_name="مخاطب مهاجرت")
        inquiry = old.get_model("crm", "Inquiry").objects.create(code="SCOPE-MIGRATION", contact=contact, scope=legacy)
        membership = old.get_model("accounts", "ScopeMembership").objects.create(scope=legacy, user=user, membership_role="MANAGER", started_at=timezone.now() - timedelta(days=2))
        transfer = old.get_model("accounts", "ScopeTransferHistory").objects.create(subject_type="INQUIRY", subject_id=inquiry.pk, from_scope=legacy, to_scope=legacy)
        self.restore_latest()
        self.assertEqual(ScopeMembership.objects.get(pk=membership.pk).sales_range_id, sales_range.pk)
        current = apps.get_model("crm", "Inquiry").objects.get(pk=inquiry.pk)
        self.assertEqual(current.sales_range_id, sales_range.pk)
        self.assertEqual(current.legacy_scope_id, legacy.pk)
        self.assertEqual(SalesRange.objects.get(pk=sales_range.pk).legacy_metadata[0]["scope"]["id"], legacy.pk)
        executor = MigrationExecutor(connection)
        executor.migrate(self.old_targets)
        restored = executor.loader.project_state(self.old_targets).apps
        self.assertEqual(restored.get_model("crm", "Inquiry").objects.get(pk=inquiry.pk).scope_id, legacy.pk)
        self.assertEqual(restored.get_model("accounts", "ScopeMembership").objects.get(pk=membership.pk).scope_id, legacy.pk)
        restored_transfer = restored.get_model("accounts", "ScopeTransferHistory").objects.get(pk=transfer.pk)
        self.assertEqual(restored_transfer.from_scope_id, legacy.pk)
        self.assertEqual(restored_transfer.to_scope_id, legacy.pk)
        self.assertEqual(restored.get_model("accounts", "LegacyManagementScope").objects.get(pk=legacy.pk).name, "حوزه سابق")
