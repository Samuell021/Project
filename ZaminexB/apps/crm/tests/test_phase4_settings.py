from django.test import TestCase

from apps.basics.models import DealTypeFamily, DealTypeVersion

from .phase4_support import Phase4FixtureMixin


class DealTypeSettingsTests(Phase4FixtureMixin, TestCase):
    def make_draft(self):
        return DealTypeVersion.objects.create(
            deal_type=self.deal_type,
            version_number=2,
            family=DealTypeFamily.SALE,
            created_by=self.admin,
        )

    def test_draft_version_can_be_archived_without_touching_the_published_one(self):
        draft = self.make_draft()
        self.auth(self.admin)
        response = self.client.post(f"/crm/api/deal-type-versions/{draft.pk}/archive/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        draft.refresh_from_db()
        self.assertEqual(draft.status, DealTypeVersion.Status.ARCHIVED)
        self.assertTrue(
            DealTypeVersion.objects.filter(
                deal_type=self.deal_type,
                version_number=1,
                status=DealTypeVersion.Status.PUBLISHED,
            ).exists()
        )

    def test_published_version_is_not_archivable(self):
        published = DealTypeVersion.objects.get(deal_type=self.deal_type, version_number=1)
        self.auth(self.admin)
        response = self.client.post(f"/crm/api/deal-type-versions/{published.pk}/archive/", {}, format="json")
        self.assertEqual(response.status_code, 400, response.content)
        published.refresh_from_db()
        self.assertEqual(published.status, DealTypeVersion.Status.PUBLISHED)
        self.assertIsNotNone(published.published_at)
