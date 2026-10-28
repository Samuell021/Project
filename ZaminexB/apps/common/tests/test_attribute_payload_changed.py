import datetime
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.basics.models import (
    Attribute,
    AttributeOption,
    PropertyType,
    PropertyUsage,
)
from apps.common.attribute_values import attribute_payload_changed
from apps.properties.models import Property, PropertyAttributeValue

User = get_user_model()


class AttributePayloadChangedTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.agent = User.objects.create_user(
            username="diff-agent", password="x", role="AGENT"
        )
        usage = PropertyUsage.objects.create(name="diff-usage", display_name="مسکونی")
        cls.apartment = PropertyType.objects.create(
            name="diff-apartment", display_name="آپارتمان", property_usage=usage
        )
        cls.property = Property.objects.create(
            title="ملک تفاوت ویژگی",
            internal_code="DIFF-1",
            consultant=cls.agent,
            property_type="APARTMENT",
            property_type_ref=cls.apartment,
            property_usage=usage,
            deal_type="SALE",
            area=100,
            address="آدرس",
        )
        cls.integer_attribute = Attribute.objects.create(
            name="diff_parking",
            display_name="پارکینگ",
            data_type=Attribute.DataType.INTEGER,
        )
        cls.decimal_attribute = Attribute.objects.create(
            name="diff_land",
            display_name="متراژ زمین",
            data_type=Attribute.DataType.DECIMAL,
        )
        cls.boolean_attribute = Attribute.objects.create(
            name="diff_elevator",
            display_name="آسانسور",
            data_type=Attribute.DataType.BOOLEAN,
        )
        cls.multiselect_attribute = Attribute.objects.create(
            name="diff_facilities",
            display_name="امکانات",
            data_type=Attribute.DataType.MULTISELECT,
        )
        for option_value, option_label in (("pool", "استخر"), ("gym", "سالن ورزش")):
            AttributeOption.objects.create(
                attribute=cls.multiselect_attribute,
                value=option_value,
                display_name=option_label,
            )
        cls.date_attribute = Attribute.objects.create(
            name="diff_delivery",
            display_name="تاریخ تحویل",
            data_type=Attribute.DataType.DATE,
        )

    def _store(self, attribute, raw):
        value = PropertyAttributeValue(property=self.property, attribute=attribute)
        value.set_value(raw)
        value.save()
        return value

    def _changed(self, payload):
        return attribute_payload_changed(
            self.property, payload, PropertyAttributeValue, "property"
        )

    def test_empty_payload_is_never_a_change(self):
        self.assertFalse(self._changed(None))
        self.assertFalse(self._changed({}))

    def test_integer_value_compares_by_number_not_by_text(self):
        self._store(self.integer_attribute, "2")

        self.assertFalse(self._changed({"diff_parking": 2}))
        self.assertFalse(self._changed({"diff_parking": "2"}))
        self.assertTrue(self._changed({"diff_parking": 3}))

    def test_decimal_value_ignores_trailing_zeros(self):
        self._store(self.decimal_attribute, "450.7500")

        self.assertFalse(self._changed({"diff_land": "450.75"}))
        self.assertTrue(self._changed({"diff_land": "450.751"}))

    def test_boolean_value_accepts_boolean_and_persian_tokens(self):
        self._store(self.boolean_attribute, True)

        self.assertFalse(self._changed({"diff_elevator": True}))
        self.assertFalse(self._changed({"diff_elevator": "بله"}))
        self.assertTrue(self._changed({"diff_elevator": "خیر"}))

    def test_multiselect_value_compares_as_an_ordered_set(self):
        self._store(self.multiselect_attribute, ["pool", "gym"])

        self.assertFalse(self._changed({"diff_facilities": ["pool", "gym"]}))
        self.assertTrue(self._changed({"diff_facilities": ["pool"]}))

    def test_date_value_accepts_iso_strings(self):
        self._store(self.date_attribute, datetime.date(2026, 1, 1))

        self.assertFalse(self._changed({"diff_delivery": "2026-01-01"}))
        self.assertTrue(self._changed({"diff_delivery": "2026-01-02"}))

    def test_missing_value_counts_as_a_change_when_the_payload_sets_one(self):
        self.assertTrue(self._changed({"diff_parking": 1}))

    def test_blank_payload_value_matches_an_empty_record(self):
        self.assertFalse(self._changed({"diff_parking": ""}))
