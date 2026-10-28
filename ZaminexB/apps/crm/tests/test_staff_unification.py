from django.apps import apps
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase
from django.urls import reverse
from rest_framework.test import APIClient

from django.contrib.auth.models import Group

from apps.accounts.models import AdminProfile, ConsultantProfile, GROUP_GENERAL_MANAGER, StaffProfile, User
from apps.accounts.sms import find_user_by_mobile


class StaffUnificationTests(TestCase):
    def test_all_profile_imports_refer_to_one_registered_model(self):
        self.assertIs(AdminProfile, StaffProfile)
        self.assertIs(ConsultantProfile, StaffProfile)
        self.assertNotIn("adminprofile", apps.all_models["accounts"])

    def test_admin_profile_routes_share_the_staff_record(self):
        user = User.objects.create_user(username="unified-admin", role="ADMIN")
        profile = StaffProfile.objects.create(user=user, full_name="مدیر واحد", branch="مرکز", mobile="09123456789")
        client = APIClient()
        client.force_authenticate(user)
        response = client.get(reverse("accounts:admin-profile-me"))
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["id"], profile.pk)
        self.assertEqual(user.admin_profile.pk, user.staff_profile.pk)
        self.assertEqual(StaffProfile.objects.filter(user=user).count(), 1)
        self.assertEqual(find_user_by_mobile(profile.mobile)[0], user)

    def test_sms_login_cannot_bypass_an_inactive_canonical_profile(self):
        user = User.objects.create_user(username="unified-inactive-admin", role="ADMIN")
        profile = StaffProfile.objects.create(user=user, full_name="مدیر غیرفعال", branch="مرکز", mobile="09123456788", is_active=False)
        found, reason = find_user_by_mobile(profile.mobile)
        self.assertIsNone(found)
        self.assertTrue(reason)


class StaffMigrationTests(TransactionTestCase):
    old_target = [("accounts", "0025_delete_legacymanagementscope")]

    def setUp(self):
        self.latest = MigrationExecutor(connection).loader.graph.leaf_nodes()
        self.addCleanup(self.restore_latest)
        executor = MigrationExecutor(connection)
        executor.migrate(self.old_target)
        self.old_apps = executor.loader.project_state(self.old_target).apps

    def restore_latest(self):
        MigrationExecutor(connection).migrate(self.latest)

    def test_forward_and_reverse_preserve_admin_data(self):
        old = self.old_apps
        user = old.get_model("accounts", "User").objects.create(username="profile-migration")
        admin = old.get_model("accounts", "AdminProfile").objects.create(user=user, full_name="مدیر پیشین", branch="شعبه پیشین", mobile="09123456787", notes="یادداشت پیشین", profile_image="admins/profile/preserved.jpg")
        self.restore_latest()
        profile = StaffProfile.objects.get(user_id=user.pk)
        self.assertEqual(profile.full_name, admin.full_name)
        self.assertEqual(profile.mobile, admin.mobile)
        self.assertEqual(profile.profile_image.name, admin.profile_image.name)
        self.assertEqual(profile.notes, admin.notes)
        self.assertEqual(profile.legacy_metadata["admin_profile"]["id"], admin.pk)
        executor = MigrationExecutor(connection)
        executor.migrate(self.old_target)
        restored = executor.loader.project_state(self.old_target).apps.get_model("accounts", "AdminProfile").objects.get(pk=admin.pk)
        self.assertEqual(restored.mobile, admin.mobile)
        self.assertEqual(restored.profile_image.name, admin.profile_image.name)
        self.assertEqual(restored.notes, admin.notes)

    def test_conflicts_are_archived_without_duplicate_mobile_or_privilege_expansion(self):
        old = self.old_apps
        UserModel = old.get_model("accounts", "User")
        Staff = old.get_model("accounts", "StaffProfile")
        Admin = old.get_model("accounts", "AdminProfile")
        first = UserModel.objects.create(username="profile-existing")
        second = UserModel.objects.create(username="profile-conflicting")
        Staff.objects.create(user=first, full_name="کارمند موجود", branch="مرکز", mobile="09123456786")
        Admin.objects.create(user=second, full_name="مدیر دوم", mobile="09123456786", is_active=False)
        self.restore_latest()
        profile = StaffProfile.objects.get(user_id=second.pk)
        self.assertIsNone(profile.mobile)
        self.assertFalse(profile.is_active)
        self.assertTrue(profile.legacy_metadata["review_required"])
        self.assertEqual(profile.legacy_metadata["admin_profile"]["mobile"], "09123456786")
        self.assertIn("mobile", profile.legacy_metadata["conflicting_fields"])

class StaffLegacyReviewTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="staff-reviewer", role="ADMIN")
        general, _ = Group.objects.get_or_create(name=GROUP_GENERAL_MANAGER)
        self.user.groups.add(general)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        target = User.objects.create_user(username="legacy-target", role="CONSULTANT")
        self.profile = StaffProfile.objects.create(
            user=target,
            full_name="کارمند موجود",
            branch="مرکز",
            mobile="09120000001",
            legacy_metadata={
                "admin_profile": {"full_name": "مدیر آرشیو", "mobile": "09120000002", "branch": "شعبه آرشیو", "hired_at": "2020-01-02", "notes": "یادداشت آرشیو"},
                "created_from_admin": False,
                "review_required": True,
                "conflicting_fields": ["full_name", "mobile", "branch", "hired_at", "notes"],
            },
        )

    def url(self):
        return reverse("crm-staff-review-legacy", args=[self.profile.pk])

    def test_requires_staff_permission(self):
        outsider = User.objects.create_user(username="staff-outsider", role="CONSULTANT")
        client = APIClient()
        client.force_authenticate(outsider)
        response = client.post(self.url(), {"decision": "KEEP_CURRENT"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_profile_without_open_conflict_is_rejected(self):
        self.profile.legacy_metadata = {**self.profile.legacy_metadata, "review_required": False}
        self.profile.save(update_fields=["legacy_metadata"])
        response = self.client.post(self.url(), {"decision": "KEEP_CURRENT"}, format="json")
        self.assertEqual(response.status_code, 400, response.data)

    def test_keep_current_records_decision_without_touching_identity(self):
        response = self.client.post(self.url(), {"decision": "KEEP_CURRENT", "notes": "با سند اصلی مطابق است."}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.full_name, "کارمند موجود")
        self.assertEqual(self.profile.mobile, "09120000001")
        self.assertFalse(self.profile.legacy_metadata["review_required"])
        self.assertEqual(self.profile.legacy_metadata["review"]["decision"], "KEEP_CURRENT")
        self.assertEqual(self.profile.legacy_metadata["review"]["reviewed_by"], self.user.username)
        self.assertEqual(self.profile.version, 2)

    def test_apply_archive_updates_selected_conflicting_fields(self):
        response = self.client.post(self.url(), {"decision": "APPLY_ARCHIVE", "fields": ["full_name", "hired_at"]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.full_name, "مدیر آرشیو")
        self.assertEqual(self.profile.hired_at.isoformat(), "2020-01-02")
        self.assertEqual(self.profile.mobile, "09120000001")
        self.assertEqual(self.profile.legacy_metadata["review"]["fields"], ["full_name", "hired_at"])
        self.assertEqual(self.profile.version, 2)

    def test_apply_archive_rejects_unlisted_fields_and_mobile_collision(self):
        response = self.client.post(self.url(), {"decision": "APPLY_ARCHIVE", "fields": ["is_active"]}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        other = User.objects.create_user(username="mobile-holder", role="CONSULTANT")
        StaffProfile.objects.create(user=other, full_name="دارنده شماره", branch="مرکز", mobile="09120000002")
        response = self.client.post(self.url(), {"decision": "APPLY_ARCHIVE", "fields": ["mobile"]}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("mobile", response.data)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.mobile, "09120000001")

    def test_repeated_command_returns_the_same_receipt(self):
        headers = {"HTTP_IDEMPOTENCY_KEY": "staff-review-key-1"}
        first = self.client.post(self.url(), {"decision": "KEEP_CURRENT"}, format="json", **headers)
        second = self.client.post(self.url(), {"decision": "KEEP_CURRENT"}, format="json", **headers)
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(second.status_code, 200, second.data)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.version, 2)
