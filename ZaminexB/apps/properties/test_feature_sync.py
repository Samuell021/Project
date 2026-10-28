import io

from django.core.management import call_command
from django.test import TestCase

from apps.accounts.models import User
from apps.basics.models import Attribute, PropertyType
from apps.properties.models import Property, PropertyAttributeValue

FEATURES = ("rooms", "floor", "built_year")


class PropertyFeatureSourceTests(TestCase):
    """`rooms`/`floor`/`built_year` must never live in only one of their homes.

    The dynamic, type-specific attribute is the current contract; the legacy
    ``Property`` columns are mirrors that ``beds``, the CRM snapshots, analytics
    and the inquiry matcher keep reading. These tests pin the wiring that keeps
    the two in agreement.
    """

    @classmethod
    def setUpTestData(cls):
        call_command("seed_basics", stdout=io.StringIO())
        cls.admin = User.objects.create_user(
            username="feature-admin", password="pw", role="ADMIN"
        )
        cls.agent = User.objects.create_user(
            username="feature-agent", password="pw", role="AGENT"
        )
        cls.apartment = PropertyType.objects.get(name="apartment")
        cls.studio = PropertyType.objects.get(name="studio")
        cls.land = PropertyType.objects.get(name="land")

    def setUp(self):
        self.client.force_login(self.admin)

    def _payload(self, **overrides):
        payload = {
            "title": "آپارتمان همگام",
            "propertyTypeRef": self.apartment.pk,
            "area": 120,
            "fullAddress": "تهران",
            "consultant": self.agent.pk,
            "ownerFirstName": "تست",
            "ownerLastName": "تستی",
            "ownerPhone": "09121234567",
        }
        payload.update(overrides)
        return payload

    def _create(self, **overrides):
        response = self.client.post(
            "/properties/api/properties/",
            self._payload(**overrides),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201, response.content[:500])
        return Property.objects.get(pk=response.json()["id"]), response.json()

    def _patch(self, prop, body):
        response = self.client.patch(
            f"/properties/api/properties/{prop.pk}/",
            body,
            content_type="application/json",
        )
        prop.refresh_from_db()
        return response

    def _dynamic_values(self, prop):
        attribute_ids = {
            attribute.pk: attribute.name
            for attribute in Attribute.objects.filter(
                name__in=FEATURES, entity=Attribute.Entity.PROPERTY
            )
        }
        return {
            attribute_ids[row.attribute_id]: row.value
            for row in PropertyAttributeValue.objects.filter(
                property=prop, attribute_id__in=attribute_ids
            )
        }

    def test_the_dynamic_feature_is_mirrored_into_the_legacy_columns(self):
        prop, body = self._create(attributes={"rooms": 3, "floor": 2, "built_year": 1398})

        self.assertEqual((prop.rooms, prop.floor, prop.built_year), (3, 2, 1398))
        self.assertEqual(self._dynamic_values(prop)["rooms"], 3)
        # The list/detail/analytics readers use the legacy column through `beds`.
        self.assertEqual(body["beds"], 3)

    def test_a_legacy_feature_is_stored_as_the_dynamic_value(self):
        # Older clients (and wizard drafts saved before the schema existed) send
        # only the legacy fields; they must not be rejected as "rooms missing".
        prop, body = self._create(beds=4, floor=3, constructionYear=1401)

        self.assertEqual((prop.rooms, prop.floor, prop.built_year), (4, 3, 1401))
        self.assertEqual(
            self._dynamic_values(prop),
            {"rooms": 4, "floor": 3, "built_year": 1401},
        )
        self.assertEqual(body["beds"], 4)

    def test_editing_the_dynamic_value_updates_the_mirror(self):
        prop, _ = self._create(attributes={"rooms": 3, "floor": 2})

        response = self._patch(prop, {"attributes": {"rooms": 6}})

        self.assertEqual(response.status_code, 200, response.content[:500])
        self.assertEqual(prop.rooms, 6)
        self.assertEqual(response.json()["beds"], 6)
        self.assertEqual(self._dynamic_values(prop)["rooms"], 6)
        # A partial attribute payload must not wipe the features it omits.
        self.assertEqual(prop.floor, 2)

    def test_editing_the_legacy_value_updates_the_dynamic_one(self):
        prop, _ = self._create(attributes={"rooms": 3, "floor": 2})

        response = self._patch(prop, {"beds": 5})

        self.assertEqual(response.status_code, 200, response.content[:500])
        self.assertEqual(prop.rooms, 5)
        self.assertEqual(self._dynamic_values(prop)["rooms"], 5)

    def test_the_dynamic_value_wins_when_both_are_sent(self):
        prop, body = self._create(beds=3, attributes={"rooms": 5})

        self.assertEqual(prop.rooms, 5)
        self.assertEqual(self._dynamic_values(prop)["rooms"], 5)
        self.assertEqual(body["beds"], 5)

    def test_a_feature_outside_the_property_type_is_not_stored_dynamically(self):
        response = self.client.post(
            "/properties/api/properties/",
            self._payload(
                propertyTypeRef=self.land.pk,
                beds=3,
                attributes={"land_area": 500},
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201, response.content[:500])
        prop = Property.objects.get(pk=response.json()["id"])
        self.assertNotIn("rooms", self._dynamic_values(prop))

    def test_clearing_an_optional_dynamic_feature_resets_the_mirror(self):
        prop, _ = self._create(propertyTypeRef=self.studio.pk, attributes={"rooms": 2})
        self.assertEqual(prop.rooms, 2)

        response = self._patch(prop, {"attributes": {"rooms": ""}})

        self.assertEqual(response.status_code, 200, response.content[:500])
        self.assertEqual(prop.rooms, 0)
        self.assertNotIn("rooms", self._dynamic_values(prop))

    def test_the_crm_workspace_keeps_using_the_shared_sync(self):
        from apps.crm.services.supply_workflow import _sync_legacy_property_feature_columns

        prop, _ = self._create(attributes={"rooms": 2, "floor": 1})
        PropertyAttributeValue.objects.filter(
            property=prop, attribute__name="rooms"
        ).update(value_integer=7)

        _sync_legacy_property_feature_columns(prop)
        prop.refresh_from_db()

        self.assertEqual(prop.rooms, 7)
