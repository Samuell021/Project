from decimal import Decimal, InvalidOperation

from django.db import transaction
from rest_framework import serializers

from apps.basics.models import Attribute, DealType
from apps.common.attribute_serializers import AttributeValuesMixin
from apps.analytics.metrics import (
    content_richness_score,
    engagement_heat_score,
    images_count_for_property,
    property_file_marketing_metrics,
)
from .models import PropertyFile, PropertyFileAttributeValue
from apps.properties.models import Property
from apps.accounts.models import User

class PropertyMiniSerializer(serializers.ModelSerializer):
    district = serializers.CharField(source='neighborhood', read_only=True)
    image_url = serializers.SerializerMethodField()
    price = serializers.SerializerMethodField()

    def get_price(self, obj):
        price_map = self.context.get("effective_price_map")
        if price_map is not None:
            price = price_map.get(obj.pk)
        else:
            from apps.analytics.metrics import effective_sale_price

            price = effective_sale_price(obj)
        return str(price) if price is not None else None


    class Meta:
        model = Property
        fields = ['id', 'title', 'district', 'price', 'area', 'floor', 'internal_code', 'image_url']

    def get_image_url(self, obj):
        if hasattr(obj, 'images') and obj.images.exists():
            first_image = obj.images.first()
            if first_image and first_image.image:
                request = self.context.get('request')
                if request:
                    return request.build_absolute_uri(first_image.image.url)
                return first_image.image.url
        return None

class UserMiniSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()
    mobile = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'name', 'email', 'mobile', 'role']

    def get_name(self, obj):
        return obj.get_full_name().strip() or obj.username

    def get_mobile(self, obj):
        profile = getattr(obj, 'consultant_profile', None)
        return profile.mobile if profile else None

class PropertyFileSerializer(AttributeValuesMixin, serializers.ModelSerializer):
    attribute_value_model = PropertyFileAttributeValue
    attribute_owner_field = "property_file"
    attribute_entity = Attribute.Entity.PROPERTY_FILE

    attributes = serializers.SerializerMethodField()
    attributeDetails = serializers.SerializerMethodField()
    assigned_to = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(groups__name__in=["AGENT", "RANGE_MANAGER"]),
        required=False,
        allow_null=True,
    )

    dealType = serializers.PrimaryKeyRelatedField(
        source="deal_type",
        queryset=DealType.objects.all(),
        required=False,
        allow_null=True,
    )
    dealTypeName = serializers.CharField(
        source="deal_type.name", read_only=True, default=None
    )
    dealTypeDisplay = serializers.CharField(
        source="deal_type.display_name", read_only=True, default=None
    )
    salePrice = serializers.DecimalField(
        source="sale_price", max_digits=18, decimal_places=0,
        required=False, allow_null=True,
    )
    monthlyRent = serializers.DecimalField(
        source="monthly_rent", max_digits=18, decimal_places=0,
        required=False, allow_null=True,
    )
    priceDetails = serializers.JSONField(source="price_details", required=False)
    dealTypeVersion = serializers.PrimaryKeyRelatedField(source="deal_type_version", queryset=DealType.objects.none(), required=False, allow_null=True)
    termsSchema = serializers.SerializerMethodField()

    property_detail = PropertyMiniSerializer(source='property', read_only=True)
    rejectionReason = serializers.CharField(source="rejection_reason", read_only=True)
    created_by_detail = UserMiniSerializer(source='created_by', read_only=True)
    assigned_to_detail = UserMiniSerializer(source='assigned_to', read_only=True)

    channels = serializers.SerializerMethodField()
    score = serializers.SerializerMethodField()
    views = serializers.SerializerMethodField()

    publishChannel = serializers.ChoiceField(
        choices=PropertyFile.PublishChannel.choices,
        source="publish_channel",
    )
    effectiveExposureDays = serializers.SerializerMethodField()
    delegationIndicator = serializers.SerializerMethodField()
    isBurnedPropertyFile = serializers.SerializerMethodField()
    isBurnedListing = serializers.SerializerMethodField()
    generatedHighProbLeads = serializers.SerializerMethodField()
    contentRichnessScore = serializers.SerializerMethodField()
    engagementHeatScore = serializers.SerializerMethodField()

    class Meta:
        model = PropertyFile
        fields = [
            'id', 'title', 'description', 'status', 'rejectionReason', 'publishChannel',
            'start_date', 'end_date', 'assigned_to', 'created_by',
            'priority', 'is_featured', 'created_at', 'updated_at',
            'property', 'property_detail', 'created_by_detail', 'assigned_to_detail',
            'channels', 'score', 'views',
            'effectiveExposureDays', 'delegationIndicator', 'isBurnedPropertyFile',
            'generatedHighProbLeads', 'contentRichnessScore', 'engagementHeatScore', 'isBurnedListing',
            'dealType', 'dealTypeName', 'dealTypeDisplay',
            'salePrice', 'deposit', 'monthlyRent', 'priceDetails', 'terms', 'version', 'dealTypeVersion', 'termsSchema',
            'attributes', 'attributeDetails',
        ]
        read_only_fields = ['created_by', 'created_at', 'updated_at', 'status', 'rejectionReason']
        validators = []

    def get_channels(self, obj):
        return [obj.publish_channel] if obj.publish_channel else []

    def get_termsSchema(self, obj):
        version = obj.deal_type_version
        return version.terms_schema if version is not None else {"fields": []}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        from apps.basics.models import DealTypeVersion

        self.fields["dealTypeVersion"].queryset = DealTypeVersion.objects.filter(status="PUBLISHED")

    def _property_file_metrics(self, obj):
        if not hasattr(self, "_property_file_metrics_cache"):
            setattr(self, "_property_file_metrics_cache", {})
        cache = self._property_file_metrics_cache
        if obj.pk not in cache:
            cache[obj.pk] = property_file_marketing_metrics(obj)
        return cache[obj.pk]

    def get_score(self, obj):
        richness = self._property_file_metrics(obj).get("contentRichnessScore") or 0
        return int(round((richness / 5) * 100))

    def get_views(self, obj):
        return self._property_file_metrics(obj).get("engagementHeatScore") or 0

    def get_effectiveExposureDays(self, obj):
        return self._property_file_metrics(obj).get("effectiveExposureDays")

    def get_delegationIndicator(self, obj):
        return self._property_file_metrics(obj).get("delegationIndicator")

    def get_isBurnedPropertyFile(self, obj):
        return self._property_file_metrics(obj).get("isBurnedPropertyFile")

    def get_isBurnedListing(self, obj):
        return self.get_isBurnedPropertyFile(obj)

    def get_generatedHighProbLeads(self, obj):
        return self._property_file_metrics(obj).get("generatedHighProbLeads")

    def get_contentRichnessScore(self, obj):
        return self._property_file_metrics(obj).get("contentRichnessScore")

    def get_engagementHeatScore(self, obj):
        return self._property_file_metrics(obj).get("engagementHeatScore")

    def validate_salePrice(self, value):
        if value is not None and value <= 0:
            raise serializers.ValidationError("قیمت فروش باید بیشتر از صفر باشد.")
        return value

    def validate_deposit(self, value):
        if value is not None and value <= 0:
            raise serializers.ValidationError("مبلغ رهن / ودیعه باید بیشتر از صفر باشد.")
        return value

    def validate_monthlyRent(self, value):
        if value is not None and value <= 0:
            raise serializers.ValidationError("اجاره ماهانه باید بیشتر از صفر باشد.")
        return value

    def validate(self, attrs):
        from apps.common.access import can_access_property

        request = self.context.get("request")
        user = getattr(request, "user", None) if request else None
        prop = attrs.get("property")
        if prop is None and self.instance is not None:
            prop = self.instance.property
        if prop is not None and prop.status == Property.Status.DRAFT:
            raise serializers.ValidationError(
                {"property": "پیش‌نویس باید پیش از ایجاد فایل توسط کارشناس تکمیل شود."}
            )
        if user and prop is not None and not can_access_property(user, prop):
            raise serializers.ValidationError({"property": "شما به این ملک دسترسی ندارید."})
        deal_type = (
            attrs["deal_type"]
            if "deal_type" in attrs
            else getattr(self.instance, "deal_type", None)
        )
        status_value = (
            self.instance.status
            if self.instance is not None
            else PropertyFile.Status.ACTIVE
        )
        if (
            prop is not None
            and deal_type is not None
            and status_value != PropertyFile.Status.ARCHIVED
        ):
            conflicts = PropertyFile.objects.filter(
                property=prop, deal_type=deal_type
            ).exclude(status=PropertyFile.Status.ARCHIVED)
            if self.instance is not None:
                conflicts = conflicts.exclude(pk=self.instance.pk)
            if conflicts.exists():
                raise serializers.ValidationError(
                    {
                        "dealType": "برای این ملک با این نوع معامله فایل دیگری ثبت شده است؛ همان فایل را ویرایش کنید."
                    }
                )
        if user and getattr(user, "role", "") != "ADMIN":
            assigned_to = attrs.get("assigned_to")
            if assigned_to is not None and assigned_to.pk != user.pk:
                from apps.accounts.permissions import has_permission
                from apps.accounts.scoping import user_in_scope

                if not has_permission(user, "property_file.assign") or not user_in_scope(
                    user, assigned_to.pk
                ):
                    raise serializers.ValidationError(
                        {"assigned_to": "واگذاری فایل به این کارشناس مجاز نیست."}
                    )
        return attrs

    @transaction.atomic
    def validate_terms(self, value):
        version = self.initial_data.get("dealTypeVersion") if hasattr(self, "initial_data") else None
        if value and version:
            from apps.basics.models import DealTypeVersion
            from apps.basics.terms import validate_terms

            target = DealTypeVersion.objects.filter(pk=version).first()
            if target is not None:
                validate_terms(target.terms_schema, value)
        return value

    def create(self, validated_data):
        payload = self._pop_attribute_payload()
        instance = super().create(validated_data)
        self._save_attribute_values(instance, payload or {})
        self._validate_required_attributes(
            instance, instance.deal_type, "attribute_links"
        )
        return instance

    @transaction.atomic
    def update(self, instance, validated_data):
        payload = self._pop_attribute_payload()
        instance = super().update(instance, validated_data)
        if payload is not None:
            self._save_attribute_values(instance, payload)
        self._validate_required_attributes(
            instance, instance.deal_type, "attribute_links"
        )
        return instance

_PROPERTY_FILE_LIST_EXCLUDED = {
    "description",
    "attributes",
    "attributeDetails",
    "created_by_detail",
    "priceDetails",
    "effectiveExposureDays",
    "delegationIndicator",
    "isBurnedPropertyFile",
    "isBurnedListing",
    "generatedHighProbLeads",
    "contentRichnessScore",
    "engagementHeatScore",
}


class PropertyFileListSerializer(PropertyFileSerializer):
    class Meta(PropertyFileSerializer.Meta):
        fields = [
            field
            for field in PropertyFileSerializer.Meta.fields
            if field not in _PROPERTY_FILE_LIST_EXCLUDED
        ]

    def get_score(self, obj):
        prop = obj.property
        img_count = images_count_for_property(prop) if prop else 0
        return int(round((content_richness_score(obj, img_count) / 5) * 100))

    def get_views(self, obj):
        prop = obj.property
        return engagement_heat_score(prop) if prop else 0


class PublicPropertyFileSerializer(serializers.ModelSerializer):
    dealTypeId = serializers.IntegerField(
        source="deal_type_id", read_only=True, allow_null=True
    )
    dealTypeName = serializers.CharField(
        source="deal_type.name", read_only=True, default=None
    )
    dealTypeDisplay = serializers.CharField(
        source="deal_type.display_name", read_only=True, default=None
    )
    salePrice = serializers.DecimalField(
        source="sale_price", max_digits=18, decimal_places=0, read_only=True, allow_null=True
    )
    monthlyRent = serializers.DecimalField(
        source="monthly_rent", max_digits=18, decimal_places=0, read_only=True, allow_null=True
    )
    propertyTitle = serializers.CharField(source="property.title", read_only=True)
    propertyType = serializers.SerializerMethodField()
    area = serializers.IntegerField(source="property.area", read_only=True)
    district = serializers.SerializerMethodField()
    city = serializers.SerializerMethodField()
    imageUrl = serializers.SerializerMethodField()

    class Meta:
        model = PropertyFile
        fields = [
            "id",
            "title",
            "description",
            "dealTypeId",
            "dealTypeName",
            "dealTypeDisplay",
            "salePrice",
            "deposit",
            "monthlyRent",
            "propertyTitle",
            "propertyType",
            "area",
            "district",
            "city",
            "imageUrl",
        ]

    def get_propertyType(self, obj):
        property_type = obj.property.property_type_ref
        if property_type:
            return property_type.display_name
        return obj.property.get_property_type_display()

    def get_district(self, obj):
        return obj.property.neighborhood or (
            obj.property.district.display_name if obj.property.district_id else ""
        )

    def get_city(self, obj):
        district = obj.property.district
        return district.city.display_name if district else ""

    def get_imageUrl(self, obj):
        images = list(obj.property.images.all())
        if not images:
            return None
        image = min(images, key=lambda item: (item.sort_order, item.pk))
        if not image.image:
            return None
        request = self.context.get("request")
        url = image.image.url
        return request.build_absolute_uri(url) if request else url


class PublicPropertyFileDetailSerializer(PublicPropertyFileSerializer):
    priceDetails = serializers.SerializerMethodField()
    images = serializers.SerializerMethodField()
    propertyFileAttributes = serializers.SerializerMethodField()
    propertyFileAttributeDetails = serializers.SerializerMethodField()
    listingAttributes = serializers.SerializerMethodField()
    listingAttributeDetails = serializers.SerializerMethodField()
    propertyAttributes = serializers.SerializerMethodField()
    propertyAttributeDetails = serializers.SerializerMethodField()

    class Meta(PublicPropertyFileSerializer.Meta):
        fields = PublicPropertyFileSerializer.Meta.fields + [
            "priceDetails",
            "images",
            "propertyFileAttributes",
            "propertyFileAttributeDetails",
            "listingAttributes",
            "listingAttributeDetails",
            "propertyAttributes",
            "propertyAttributeDetails",
        ]

    @staticmethod
    def _is_public_name(name):
        normalized = "".join(
            character for character in str(name).lower() if character.isalnum()
        )
        private_terms = (
            "owner",
            "consultant",
            "staff",
            "internal",
            "phone",
            "telephone",
            "mobile",
            "whatsapp",
            "telegram",
            "fax",
            "email",
            "contact",
            "address",
            "latitude",
            "longitude",
            "coordinate",
            "gps",
        )
        return not any(term in normalized for term in private_terms)

    @staticmethod
    def _is_public_attribute(attribute):
        return PublicPropertyFileDetailSerializer._is_public_name(attribute.name)

    def get_priceDetails(self, obj):
        if not isinstance(obj.price_details, dict):
            return {}
        price_terms = (
            "price",
            "deposit",
            "rent",
            "mortgage",
            "amount",
            "payment",
            "installment",
            "fee",
        )
        public_prices = {}
        for key, value in obj.price_details.items():
            if not self._is_public_name(key):
                continue
            if not any(term in str(key).lower() for term in price_terms):
                continue
            if isinstance(value, bool) or not isinstance(value, (int, float, str)):
                continue
            normalized_value = str(value).replace(",", "").replace(" ", "")
            try:
                amount = Decimal(normalized_value)
            except (InvalidOperation, TypeError, ValueError):
                continue
            if amount.is_finite() and amount > 0:
                public_prices[str(key)] = value
        return public_prices

    def _attribute_links(self, obj, owner_type):
        if owner_type == "property":
            property_type = obj.property.property_type_ref
            if property_type is None:
                return []
            return list(
                property_type.attribute_links.filter(
                    is_active=True, attribute__is_active=True
                )
                .select_related("attribute")
                .order_by("sort_order", "attribute__sort_order")
            )
        if obj.deal_type_id is None:
            return []
        return list(
            obj.deal_type.attribute_links.filter(
                is_active=True, attribute__is_active=True
            )
            .select_related("attribute")
            .order_by("sort_order", "attribute__sort_order")
        )

    def _attribute_payload_for_property_file(self, obj, owner_type):
        cache = getattr(self, "_public_attribute_payload_cache", None)
        if cache is None:
            cache = {}
            self._public_attribute_payload_cache = cache
        key = (obj.pk, owner_type)
        if key not in cache:
            owner = obj.property if owner_type == "property" else obj
            cache[key] = self._attribute_payload(
                owner, self._attribute_links(obj, owner_type), owner_type
            )
        return cache[key]

    @staticmethod
    def _attribute_payload(owner, links, owner_type):
        values_by_id = {
            value.attribute_id: value
            for value in owner.attribute_values.filter(
                attribute_id__in=[link.attribute_id for link in links]
            ).select_related("attribute")
        }
        values = {}
        details = []
        for link in links:
            attribute = link.attribute
            if not PublicPropertyFileDetailSerializer._is_public_attribute(attribute):
                continue
            if owner_type == "property" and attribute.is_core:
                if attribute.name == "area":
                    continue
                raw_value = getattr(owner, attribute.core_field, None)
                display_value = str(raw_value) if raw_value is not None else ""
            else:
                stored_value = values_by_id.get(attribute.pk)
                if stored_value is None:
                    continue
                raw_value = stored_value.value
                display_value = stored_value.display_value
            if raw_value is None or raw_value == "" or raw_value == []:
                continue
            values[attribute.name] = raw_value
            details.append(
                {
                    "name": attribute.name,
                    "displayName": attribute.display_name,
                    "dataType": attribute.data_type,
                    "unit": attribute.unit,
                    "isFacility": attribute.is_facility,
                    "value": raw_value,
                    "displayValue": display_value,
                }
            )
        return values, details

    def get_images(self, obj):
        request = self.context.get("request")
        result = []
        for image in obj.property.images.all():
            if not image.image:
                continue
            url = image.image.url
            result.append(
                {
                    "id": image.pk,
                    "url": request.build_absolute_uri(url) if request else url,
                }
            )
        return result

    def get_propertyFileAttributes(self, obj):
        values, _ = self._attribute_payload_for_property_file(obj, "property_file")
        return values

    def get_propertyFileAttributeDetails(self, obj):
        _, details = self._attribute_payload_for_property_file(obj, "property_file")
        return details

    def get_listingAttributes(self, obj):
        return self.get_propertyFileAttributes(obj)

    def get_listingAttributeDetails(self, obj):
        return self.get_propertyFileAttributeDetails(obj)

    def get_propertyAttributes(self, obj):
        values, _ = self._attribute_payload_for_property_file(obj, "property")
        return values

    def get_propertyAttributeDetails(self, obj):
        _, details = self._attribute_payload_for_property_file(obj, "property")
        return details


class StaffPropertyFileOwnerMixin(serializers.Serializer):
    consultantId = serializers.SerializerMethodField()
    consultantName = serializers.SerializerMethodField()
    consultantAvatar = serializers.SerializerMethodField()
    isMine = serializers.SerializerMethodField()

    def _property_file_owner(self, obj):
        property_obj = obj.property
        return obj.assigned_to or (property_obj.consultant if property_obj else None)

    def _profile_image_url(self, owner):
        if owner is None:
            return None
        profile = getattr(owner, "consultant_profile", None)
        image = getattr(profile, "profile_image", None)
        return image.url if image else None

    def get_consultantId(self, obj):
        owner = self._property_file_owner(obj)
        return owner.pk if owner else None

    def get_consultantName(self, obj):
        owner = self._property_file_owner(obj)
        if owner is None:
            return ""
        return owner.get_full_name().strip() or owner.username

    def get_consultantAvatar(self, obj):
        return self._profile_image_url(self._property_file_owner(obj))

    def get_isMine(self, obj):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user is None or not user.is_authenticated:
            return False
        return obj.assigned_to_id == user.pk


class StaffPropertyFileCardSerializer(StaffPropertyFileOwnerMixin, PublicPropertyFileSerializer):
    channel = serializers.CharField(source="publish_channel", read_only=True)
    channelDisplay = serializers.CharField(
        source="get_publish_channel_display", read_only=True
    )
    propertyId = serializers.IntegerField(source="property_id", read_only=True)

    class Meta(PublicPropertyFileSerializer.Meta):
        fields = PublicPropertyFileSerializer.Meta.fields + [
            "consultantId",
            "consultantName",
            "consultantAvatar",
            "channel",
            "channelDisplay",
            "propertyId",
            "isMine",
        ]


class StaffPropertyFileDetailSerializer(StaffPropertyFileOwnerMixin, PropertyFileSerializer):
    channelDisplay = serializers.CharField(
        source="get_publish_channel_display", read_only=True
    )
    area = serializers.IntegerField(source="property.area", read_only=True)
    propertyType = serializers.SerializerMethodField()
    district = serializers.SerializerMethodField()
    city = serializers.SerializerMethodField()

    def get_propertyType(self, obj):
        return PublicPropertyFileSerializer.get_propertyType(self, obj)

    def get_district(self, obj):
        return PublicPropertyFileSerializer.get_district(self, obj)

    def get_city(self, obj):
        return PublicPropertyFileSerializer.get_city(self, obj)

    class Meta(PropertyFileSerializer.Meta):
        fields = PropertyFileSerializer.Meta.fields + [
            "area",
            "propertyType",
            "district",
            "city",
            "consultantId",
            "consultantName",
            "consultantAvatar",
            "channelDisplay",
            "isMine",
        ]
