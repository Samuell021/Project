from django.apps import apps
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.basics.models import City, District, Province
from apps.common.models import District as CompatibilityDistrict


class DistrictUnificationTests(TestCase):
    def test_compatibility_import_is_the_canonical_model(self):
        self.assertIs(CompatibilityDistrict, District)
        self.assertNotIn("district", apps.all_models["common"])

    def test_unresolved_location_is_explicit_and_does_not_invent_a_city(self):
        district = District.objects.create(name="common-district-1", display_name="مرکزی")
        self.assertIsNone(district.city_id)
        self.assertTrue(district.needs_location_review)
        self.assertIn("شهر تعیین نشده", district.full_path)
        self.assertEqual(City.objects.count(), 0)
        self.assertEqual(Province.objects.count(), 0)

    def test_hierarchy_api_requires_city_for_new_records(self):
        admin = User.objects.create_user(username="district-admin", role="ADMIN")
        client = APIClient()
        client.force_authenticate(admin)
        response = client.post("/basics/api/districts/", {"displayName": "مرکزی"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("city", response.data)

    def test_legacy_management_writes_the_same_model_and_marks_location_for_review(self):
        admin = User.objects.create_user(username="district-compat-admin", role="ADMIN")
        client = APIClient()
        client.force_authenticate(admin)
        from apps.common.views import DistrictManageView
        from rest_framework.test import APIRequestFactory, force_authenticate

        request = APIRequestFactory().post("/common/api/districts/manage/", {"name": "محله قدیم"}, format="json")
        force_authenticate(request, admin)
        response = DistrictManageView.as_view()(request)
        self.assertEqual(response.status_code, 201, response.data)
        district = District.objects.get(pk=response.data["id"])
        self.assertEqual(district.display_name, "محله قدیم")
        self.assertTrue(response.data["needs_location_review"])
        self.assertTrue(district.needs_location_review)

    def test_assigning_an_explicit_city_resolves_review_and_preserves_archive(self):
        admin = User.objects.create_user(username="district-review-admin", role="ADMIN")
        province = Province.objects.create(name="review-province", display_name="استان بررسی")
        city = City.objects.create(province=province, name="review-city", display_name="شهر بررسی")
        snapshot = {"legacy_common_district": {"id": 55, "name": "محله پیشین"}}
        district = District.objects.create(name="common-district-55", display_name="محله پیشین", meta_data=snapshot)
        client = APIClient()
        client.force_authenticate(admin)
        response = client.patch(f"/basics/api/districts/{district.pk}/", {"city": city.pk}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["needsLocationReview"])
        district.refresh_from_db()
        self.assertEqual(district.city_id, city.pk)
        self.assertEqual(district.meta_data, snapshot)


class DistrictMigrationTests(TransactionTestCase):
    def setUp(self):
        self.latest = MigrationExecutor(connection).loader.graph.leaf_nodes()
        self.addCleanup(self.restore_latest)
        executor = MigrationExecutor(connection)
        executor.migrate([("common", "0019_companysettings_brand_theme")])
        self.old_apps = executor.loader.project_state([("common", "0019_companysettings_brand_theme")]).apps

    def restore_latest(self):
        MigrationExecutor(connection).migrate(self.latest)

    def test_forward_and_reverse_preserve_name_activity_and_timestamps(self):
        Legacy = self.old_apps.get_model("common", "District")
        old = Legacy.objects.create(name="مرکزی", is_active=False)
        original_created_at = old.created_at
        self.restore_latest()
        district = District.objects.get(meta_data__legacy_common_district__id=old.pk)
        self.assertEqual(district.display_name, "مرکزی")
        self.assertIsNone(district.city_id)
        self.assertFalse(district.is_active)
        self.assertEqual(district.created_at, original_created_at)
        executor = MigrationExecutor(connection)
        executor.migrate([("common", "0019_companysettings_brand_theme")])
        restored_apps = executor.loader.project_state([("common", "0019_companysettings_brand_theme")]).apps
        restored = restored_apps.get_model("common", "District").objects.get(pk=old.pk)
        self.assertEqual(restored.name, "مرکزی")
        self.assertFalse(restored.is_active)
        self.assertEqual(restored.created_at, original_created_at)
