from rest_framework import serializers
from django.db import transaction

from .phones import normalize_phone

from apps.accounts.models import SalesRange, ScopeMembership, ScopeTransferHistory
from apps.basics.models import DealTypeVersion

from . import models


class ContactPhoneSerializer(serializers.ModelSerializer):
    def validate_phone(self, value):
        if not normalize_phone(value):
            raise serializers.ValidationError("شماره تماس باید شامل رقم باشد.")
        return value

    class Meta:
        model = models.ContactPhone
        fields = ["id", "phone", "normalized_phone", "label", "is_primary"]
        read_only_fields = ["normalized_phone"]


class ContactSerializer(serializers.ModelSerializer):
    phones = ContactPhoneSerializer(many=True, required=False)
    duplicate_phone_ids = serializers.SerializerMethodField()

    class Meta:
        model = models.Contact
        fields = ["id", "version", "full_name", "national_code", "email", "notes", "phones", "duplicate_phone_ids", "is_legacy_placeholder", "legacy_review_status", "legacy_review_notes", "legacy_reviewed_by", "legacy_reviewed_at", "created_at", "updated_at"]
        read_only_fields = ["version", "is_legacy_placeholder", "legacy_review_status", "legacy_review_notes", "legacy_reviewed_by", "legacy_reviewed_at", "created_at", "updated_at"]

    def validate_phones(self, value):
        numbers = [normalize_phone(item.get("phone", "")) for item in value]
        if len(numbers) != len(set(numbers)):
            raise serializers.ValidationError("یک شماره تماس بیش از یک بار برای این شخص وارد شده است.")
        if sum(bool(item.get("is_primary")) for item in value) > 1:
            raise serializers.ValidationError("فقط یک شماره تماس می‌تواند اصلی باشد.")
        return value

    def get_duplicate_phone_ids(self, obj):
        numbers = list(obj.phones.values_list("normalized_phone", flat=True))
        if not numbers:
            return []
        return list(
            models.Contact.objects.filter(pk__in=self.context.get("visible_contact_ids", []), phones__normalized_phone__in=numbers)
            .exclude(pk=obj.pk)
            .distinct()
            .values_list("id", flat=True)
        )

    @transaction.atomic
    def create(self, validated_data):
        phones = validated_data.pop("phones", [])
        contact = models.Contact.objects.create(**validated_data)
        for item in phones:
            models.ContactPhone.objects.create(contact=contact, normalized_phone=normalize_phone(item.get("phone", "")), **{k: v for k, v in item.items() if k != "normalized_phone"})
        return contact

    @transaction.atomic
    def update(self, instance, validated_data):
        phones = validated_data.pop("phones", None)
        for key, value in validated_data.items():
            setattr(instance, key, value)
        instance.save()
        if phones is not None:
            instance.phones.all().delete()
            for item in phones:
                models.ContactPhone.objects.create(contact=instance, normalized_phone=normalize_phone(item.get("phone", "")), **{k: v for k, v in item.items() if k != "normalized_phone"})
        return instance



class SalesRangeSerializer(serializers.ModelSerializer):
    class Meta:
        model = SalesRange
        fields = ["id", "name", "is_active", "created_at", "managers", "members", "version"]
        read_only_fields = ["id", "created_at", "managers", "members", "version"]


ManagementScopeSerializer = SalesRangeSerializer


class ScopeMembershipSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.username", read_only=True)
    full_name = serializers.SerializerMethodField()
    sales_range_name = serializers.CharField(source="sales_range.name", read_only=True, default=None)
    scope = serializers.PrimaryKeyRelatedField(source="sales_range", read_only=True)
    scope_name = serializers.CharField(source="sales_range.name", read_only=True, default=None)

    class Meta:
        model = ScopeMembership
        fields = ["id", "sales_range", "sales_range_name", "scope", "scope_name", "user", "user_name", "full_name", "membership_role", "started_at", "ended_at", "created_at"]
        read_only_fields = ["scope", "scope_name", "created_at"]

    def get_full_name(self, obj):
        if not obj.user_id:
            return ""
        return obj.user.get_full_name().strip() or obj.user.username


class ScopeTransferHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ScopeTransferHistory
        fields = "__all__"


class DealTypeVersionSerializer(serializers.ModelSerializer):
    def validate(self, attrs):
        if self.initial_data.get("status", "DRAFT") != "DRAFT":
            raise serializers.ValidationError({"status": "برای انتشار نسخه از فرمان انتشار استفاده کنید."})
        return attrs

    def validate_terms_schema(self, value):
        from django.core.exceptions import ValidationError
        from apps.basics.terms import validate_terms_schema

        try:
            return validate_terms_schema(value)
        except ValidationError as exc:
            raise serializers.ValidationError(exc.message_dict["terms_schema"])

    deal_type_name = serializers.CharField(source="deal_type.display_name", read_only=True)

    class Meta:
        model = DealTypeVersion
        fields = ["id", "deal_type", "deal_type_name", "version_number", "family", "terms_schema", "financial_fields", "required_roles", "rules", "status", "published_at", "created_by", "created_at", "updated_at"]
        read_only_fields = ["published_at", "created_by", "created_at", "updated_at"]


class AssignableStaffSerializer(serializers.Serializer):
    """Shape the responsible-consultant picker needs, resolved straight from the user record.

    Staff profiles are optional for legacy accounts, so the display name and the branch are read
    from the profile when it exists and fall back to the account itself.
    """

    id = serializers.IntegerField(read_only=True)
    full_name = serializers.SerializerMethodField()
    role = serializers.SerializerMethodField()
    branch = serializers.SerializerMethodField()
    profile_image = serializers.SerializerMethodField()

    def get_full_name(self, obj):
        profile = getattr(obj, "consultant_profile", None)
        return (profile.full_name if profile and profile.full_name else obj.get_full_name().strip() or obj.username)

    def get_role(self, obj):
        return obj.role

    def get_branch(self, obj):
        profile = getattr(obj, "consultant_profile", None)
        return profile.branch if profile else ""

    def get_profile_image(self, obj):
        profile = getattr(obj, "consultant_profile", None)
        if not profile or not profile.profile_image:
            return None
        try:
            return profile.profile_image.url
        except ValueError:
            return None


class AssignmentHistorySerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()
    from_user_name = serializers.SerializerMethodField()
    to_user_name = serializers.SerializerMethodField()
    action_display = serializers.CharField(source="get_action_display", read_only=True)

    def _display_user(self, u):
        if u is None:
            return None
        return u.get_full_name() or u.username

    def get_actor_name(self, obj):
        return self._display_user(obj.actor)

    def get_from_user_name(self, obj):
        return self._display_user(obj.from_user)

    def get_to_user_name(self, obj):
        return self._display_user(obj.to_user)

    class Meta:
        model = models.AssignmentHistory
        fields = "__all__"


class RescheduleSerializer(serializers.ModelSerializer):
    requested_by_name = serializers.SerializerMethodField()
    decided_by_name = serializers.SerializerMethodField()

    def get_requested_by_name(self, obj):
        return (obj.requested_by.get_full_name() or obj.requested_by.username) if obj.requested_by else None

    def get_decided_by_name(self, obj):
        return (obj.decided_by.get_full_name() or obj.decided_by.username) if obj.decided_by else None

    class Meta:
        model = models.AssignmentRescheduleRequest
        fields = "__all__"
        read_only_fields = ["status", "requested_by", "requested_at", "decided_by", "decided_at"]


class WithdrawalSerializer(serializers.ModelSerializer):
    requested_by_name = serializers.SerializerMethodField()
    decided_by_name = serializers.SerializerMethodField()

    def get_requested_by_name(self, obj):
        return (obj.requested_by.get_full_name() or obj.requested_by.username) if obj.requested_by else None

    def get_decided_by_name(self, obj):
        return (obj.decided_by.get_full_name() or obj.decided_by.username) if obj.decided_by else None

    class Meta:
        model = models.ConsultantWithdrawalRequest
        fields = "__all__"
        read_only_fields = ["status", "requested_by", "requested_at", "decided_by", "decided_at"]


class PropertyAppraisalSerializer(serializers.ModelSerializer):
    updated_by_name = serializers.SerializerMethodField()

    def get_updated_by_name(self, obj):
        return (obj.updated_by.get_full_name() or obj.updated_by.username) if obj.updated_by else None

    class Meta:
        model = models.PropertyAppraisal
        fields = "__all__"
        read_only_fields = ["version", "archived_reports", "updated_by", "created_at", "updated_at"]


class PropertyReviewSerializer(serializers.ModelSerializer):
    submitted_by_name = serializers.SerializerMethodField()
    reviewed_by_name = serializers.SerializerMethodField()
    case_id = serializers.IntegerField(source="registration_request_id", read_only=True)
    case_code = serializers.CharField(source="registration_request.code", read_only=True, default=None)
    property_title = serializers.SerializerMethodField()
    scope_id = serializers.IntegerField(source="registration_request.sales_range_id", read_only=True, default=None)
    scope_name = serializers.CharField(source="registration_request.sales_range.name", read_only=True, default=None)
    assigned_to_name = serializers.SerializerMethodField()
    current_review_version = serializers.IntegerField(source="property.submitted_review_version", read_only=True)
    property_review_status = serializers.CharField(source="property.review_status", read_only=True)
    version_drift = serializers.SerializerMethodField()

    def get_submitted_by_name(self, obj):
        return (obj.submitted_by.get_full_name() or obj.submitted_by.username) if obj.submitted_by else None

    def get_reviewed_by_name(self, obj):
        return (obj.reviewed_by.get_full_name() or obj.reviewed_by.username) if obj.reviewed_by else None

    def get_property_title(self, obj):
        if obj.registration_request and obj.registration_request.property_title:
            return obj.registration_request.property_title
        return obj.property.title if obj.property_id else ""

    def get_assigned_to_name(self, obj):
        if obj.registration_request and obj.registration_request.assigned_to:
            u = obj.registration_request.assigned_to
            return u.get_full_name() or u.username
        if obj.property_id and obj.property.consultant:
            u = obj.property.consultant
            return u.get_full_name() or u.username
        return None

    def get_version_drift(self, obj):
        if not obj.property_id:
            return False
        return obj.version != obj.property.submitted_review_version

    class Meta:
        model = models.PropertyReview
        fields = "__all__"
        read_only_fields = ["submitted_by", "submitted_at", "decision", "reviewed_by", "reviewed_at"]


class ExploreListingSerializer(serializers.Serializer):
    id = serializers.IntegerField(read_only=True)
    title = serializers.CharField(read_only=True)
    description = serializers.CharField(read_only=True)
    status = serializers.CharField(read_only=True)
    publish_channel = serializers.CharField(read_only=True)
    property_id = serializers.IntegerField(read_only=True)
    property_code = serializers.CharField(source="property.internal_code", read_only=True)
    property_title = serializers.CharField(source="property.title", read_only=True)
    property_type = serializers.CharField(source="property.property_type", read_only=True)
    property_type_ref = serializers.IntegerField(source="property.property_type_ref_id", read_only=True)
    property_type_display = serializers.SerializerMethodField()
    property_usage_display = serializers.SerializerMethodField()
    city = serializers.SerializerMethodField()
    district = serializers.SerializerMethodField()
    district_id = serializers.IntegerField(source="property.district_id", read_only=True)
    neighborhood = serializers.CharField(source="property.neighborhood", read_only=True)
    area = serializers.IntegerField(source="property.area", read_only=True)
    rooms = serializers.IntegerField(source="property.rooms", read_only=True)
    floor = serializers.IntegerField(source="property.floor", read_only=True)
    built_year = serializers.IntegerField(source="property.built_year", read_only=True)
    deal_type = serializers.IntegerField(source="deal_type_id", read_only=True)
    deal_type_name = serializers.CharField(source="deal_type.display_name", read_only=True, default=None)
    deal_type_family = serializers.CharField(source="deal_type.family", read_only=True, default=None)
    sale_price = serializers.DecimalField(max_digits=18, decimal_places=0, read_only=True)
    deposit = serializers.DecimalField(max_digits=18, decimal_places=0, read_only=True)
    monthly_rent = serializers.DecimalField(max_digits=18, decimal_places=0, read_only=True)
    terms = serializers.JSONField(read_only=True)
    consultant_name = serializers.SerializerMethodField()
    image_url = serializers.SerializerMethodField()
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)

    def get_property_type_display(self, obj):
        if obj.property.property_type_ref_id:
            return obj.property.property_type_ref.display_name
        return obj.property.get_property_type_display()

    def get_property_usage_display(self, obj):
        return obj.property.property_usage.display_name if obj.property.property_usage_id else None

    def get_city(self, obj):
        if obj.property.district_id and obj.property.district.city_id:
            return obj.property.district.city.display_name
        return None

    def get_district(self, obj):
        if obj.property.district_id:
            return obj.property.district.display_name
        return obj.property.neighborhood or None

    def get_consultant_name(self, obj):
        advisor = obj.assigned_to or obj.property.consultant
        if advisor is None:
            return None
        return advisor.get_full_name() or advisor.username

    def get_image_url(self, obj):
        request = self.context.get("request")
        images = list(obj.property.images.all())
        if not images or not images[0].image:
            return None
        url = images[0].image.url
        return request.build_absolute_uri(url) if request else url


class PropertyCaseSerializer(serializers.ModelSerializer):
    stage = serializers.SerializerMethodField()
    contact_name = serializers.CharField(source="contact.full_name", read_only=True)
    contact_phone = serializers.SerializerMethodField()
    lead_source_display = serializers.CharField(source="get_lead_source_display", read_only=True)
    created_by_name = serializers.SerializerMethodField()
    assigned_to_name = serializers.CharField(source="assigned_to.username", read_only=True, default=None)
    assigned_to_display = serializers.SerializerMethodField()
    lead_accepted_by_name = serializers.SerializerMethodField()
    sales_range = serializers.PrimaryKeyRelatedField(queryset=SalesRange.objects.all(), required=False, allow_null=True)
    scope = serializers.PrimaryKeyRelatedField(source="sales_range", queryset=SalesRange.objects.all(), required=False, allow_null=True)
    sales_range_name = serializers.CharField(source="sales_range.name", read_only=True, default=None)
    scope_name = serializers.CharField(source="sales_range.name", read_only=True, default=None)
    legacy_scope_id = serializers.IntegerField(read_only=True)
    desired_deal_type_ids = serializers.SerializerMethodField()
    submitted_review_version = serializers.SerializerMethodField()
    has_locked_contract = serializers.SerializerMethodField()
    has_finalized_contract = serializers.SerializerMethodField()
    pending_extension = serializers.SerializerMethodField()
    pending_withdrawal = serializers.SerializerMethodField()
    resulting_property_detail = serializers.SerializerMethodField()
    listings = serializers.SerializerMethodField()
    appraisal = PropertyAppraisalSerializer(read_only=True)

    def get_stage(self, obj):
        from .services import property_case_stage

        return property_case_stage(obj)

    def get_contact_phone(self, obj):
        phones = list(obj.contact.phones.all()) if obj.contact_id else []
        if not phones:
            return ""
        phones.sort(key=lambda item: (not item.is_primary, item.pk))
        return phones[0].phone

    def get_created_by_name(self, obj):
        if not obj.created_by:
            return None
        return obj.created_by.get_full_name() or obj.created_by.username

    def get_assigned_to_display(self, obj):
        if not obj.assigned_to:
            return None
        return obj.assigned_to.get_full_name() or obj.assigned_to.username

    def get_lead_accepted_by_name(self, obj):
        if not obj.lead_accepted_by:
            return None
        return obj.lead_accepted_by.get_full_name() or obj.lead_accepted_by.username

    def get_desired_deal_type_ids(self, obj):
        return [item.deal_type_id for item in obj.desired_deal_types.all()]

    def get_has_locked_contract(self, obj):
        from .services.supply_workflow import case_has_locked_contract

        return case_has_locked_contract(obj, finalized_only=False)

    def get_has_finalized_contract(self, obj):
        from .services.supply_workflow import case_has_locked_contract

        return case_has_locked_contract(obj, finalized_only=True)

    def get_pending_extension(self, obj):
        items = [r for r in obj.reschedule_requests.all() if r.status == models.AssignmentRescheduleRequest.Status.PENDING]
        if not items:
            return None
        req = items[0]
        return {
            "id": req.pk,
            "requested_due_at": req.requested_due_at,
            "reason": req.reason,
            "requested_by": req.requested_by_id,
            "requested_at": req.requested_at,
        }

    def get_pending_withdrawal(self, obj):
        items = [w for w in obj.withdrawal_requests.all() if w.status == models.ConsultantWithdrawalRequest.Status.PENDING]
        if not items:
            return None
        req = items[0]
        return {
            "id": req.pk,
            "reason": req.reason,
            "requested_by": req.requested_by_id,
            "requested_at": req.requested_at,
        }

    def get_listings(self, obj):
        prop = obj.resulting_property
        if not prop:
            return []
        return [
            {
                "id": pf.pk,
                "title": pf.title,
                "deal_type": pf.deal_type_id,
                "deal_type_name": pf.deal_type.display_name if pf.deal_type_id else "",
                "deal_type_family": pf.deal_type.family if pf.deal_type_id else "",
                "deal_type_version": pf.deal_type_version_id,
                "status": pf.status,
                "version": pf.version,
                "sale_price": str(pf.sale_price) if pf.sale_price is not None else None,
                "deposit": str(pf.deposit) if pf.deposit is not None else None,
                "monthly_rent": str(pf.monthly_rent) if pf.monthly_rent is not None else None,
                "terms": pf.terms or {},
                "price_details": pf.price_details or {},
                "publish_channel": pf.publish_channel,
                "description": pf.description,
                "updated_at": pf.updated_at,
            }
            for pf in prop.property_files.all()
            if pf.status != "ARCHIVED"
        ]

    def get_resulting_property_detail(self, obj):
        prop = obj.resulting_property
        if not prop:
            return None
        parties = [
            {
                "id": link.pk,
                "contact": link.contact_id,
                "full_name": link.contact.full_name,
                "phone": next((p.phone for p in sorted(link.contact.phones.all(), key=lambda x: (not x.is_primary, x.pk))), ""),
                "email": link.contact.email,
                "role": link.role,
                "role_display": link.get_role_display(),
                "share_percent": str(link.share_percent) if link.share_percent is not None else None,
                "is_primary": link.is_primary,
            }
            for link in prop.contact_links.all()
            if link.ended_at is None
        ]
        return {
            "id": prop.pk,
            "internal_code": prop.internal_code,
            "title": prop.title,
            "status": prop.status,
            "review_status": prop.review_status,
            "review_version": prop.review_version,
            "submitted_review_version": prop.submitted_review_version,
            "rejection_reason": prop.rejection_reason,
            "address": prop.address,
            "district": prop.district_id,
            "district_name": prop.district.display_name if prop.district_id else None,
            "city_name": prop.district.city.display_name if prop.district_id and prop.district.city_id else None,
            "neighborhood": prop.neighborhood,
            "area": prop.area,
            "rooms": prop.rooms,
            "floor": prop.floor,
            "built_year": prop.built_year,
            "property_type": prop.property_type,
            "deal_type": prop.deal_type,
            "property_type_ref": prop.property_type_ref_id,
            "property_type_name": prop.property_type_ref.display_name if prop.property_type_ref_id else None,
            "property_usage": prop.property_usage_id,
            "property_usage_name": prop.property_usage.display_name if prop.property_usage_id else None,
            "description": prop.description,
            "owner_first_name": prop.owner_first_name,
            "owner_last_name": prop.owner_last_name,
            "owner_phone": prop.owner_phone,
            "parties": parties,
        }

    def get_submitted_review_version(self, obj):
        return (
            obj.resulting_property.submitted_review_version
            if obj.resulting_property_id
            else None
        )

    class Meta:
        model = models.PropertyRegistrationRequest
        fields = [
            "id",
            "code",
            "stage",
            "contact",
            "contact_name",
            "contact_phone",
            "description",
            "lead_source",
            "lead_source_display",
            "property_title",
            "sales_range",
            "sales_range_name",
            "scope",
            "scope_name",
            "legacy_scope_id",
            "created_by",
            "created_by_name",
            "lead_status",
            "lead_accepted_by",
            "lead_accepted_by_name",
            "lead_accepted_at",
            "acceptance_status",
            "assigned_to",
            "assigned_to_name",
            "assigned_to_display",
            "assigned_at",
            "accepted_at",
            "due_at",
            "resulting_property",
            "status",
            "is_legacy",
            "legacy_review_status",
            "legacy_review_notes",
            "legacy_reviewed_by",
            "legacy_reviewed_at",
            "duplicate_of",
            "closure_reason",
            "version",
            "desired_deal_type_ids",
            "submitted_review_version",
            "has_locked_contract",
            "has_finalized_contract",
            "pending_extension",
            "pending_withdrawal",
            "resulting_property_detail",
            "listings",
            "appraisal",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "code",
            "stage",
            "created_by",
            "lead_status",
            "lead_accepted_by",
            "lead_accepted_at",
            "acceptance_status",
            "assigned_at",
            "accepted_at",
            "resulting_property",
            "is_legacy",
            "legacy_review_status",
            "legacy_review_notes",
            "legacy_reviewed_by",
            "legacy_reviewed_at",
            "version",
            "created_at",
            "updated_at",
        ]


class InquiryPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.InquiryPreference
        fields = ["id", "deal_type", "deal_type_version", "min_amount", "max_amount", "max_deposit", "max_monthly_rent", "min_area", "max_area", "criteria", "districts", "property_types"]

    def validate(self, attrs):
        minimum_area = attrs.get("min_area")
        maximum_area = attrs.get("max_area")
        if minimum_area is not None and maximum_area is not None and minimum_area > maximum_area:
            raise serializers.ValidationError({"max_area": "حداکثر متراژ نمی‌تواند از حداقل کمتر باشد."})
        minimum_amount = attrs.get("min_amount")
        maximum_amount = attrs.get("max_amount")
        if minimum_amount is not None and maximum_amount is not None and minimum_amount > maximum_amount:
            raise serializers.ValidationError({"max_amount": "حداکثر بودجه نمی‌تواند از حداقل کمتر باشد."})
        criteria = attrs.get("criteria", {})
        if not isinstance(criteria, dict):
            raise serializers.ValidationError({"criteria": "معیارهای نیاز باید یک شیء باشند."})
        deal_type = attrs.get("deal_type")
        deal_type_version = attrs.get("deal_type_version")
        if deal_type_version and (
            deal_type is None
            or deal_type_version.deal_type_id != deal_type.pk
            or deal_type_version.status != DealTypeVersion.Status.PUBLISHED
        ):
            raise serializers.ValidationError({"deal_type_version": "نسخهٔ منتشرشده باید متعلق به همان نوع معامله باشد."})
        return attrs


class InquirySerializer(serializers.ModelSerializer):
    contact_name = serializers.CharField(source="contact.full_name", read_only=True)
    contact_phone = serializers.SerializerMethodField()
    assigned_to_name = serializers.CharField(source="assigned_to.username", read_only=True, default=None)
    stage = serializers.SerializerMethodField()
    stage_label = serializers.SerializerMethodField()
    stage_responsible = serializers.SerializerMethodField()
    sales_range = serializers.PrimaryKeyRelatedField(queryset=SalesRange.objects.all(), required=False, allow_null=True)
    scope = serializers.PrimaryKeyRelatedField(source="sales_range", queryset=SalesRange.objects.all(), required=False, allow_null=True)
    sales_range_name = serializers.CharField(source="sales_range.name", read_only=True, default=None)
    scope_name = serializers.CharField(source="sales_range.name", read_only=True, default=None)
    legacy_scope_id = serializers.IntegerField(read_only=True)
    preferences = InquiryPreferenceSerializer(many=True, required=False)

    class Meta:
        model = models.Inquiry
        fields = ["id", "code", "contact", "contact_name", "contact_phone", "description", "sales_range", "sales_range_name", "scope", "scope_name", "legacy_scope_id", "created_by", "lead_status", "lead_accepted_by", "lead_accepted_at", "acceptance_status", "assigned_to", "assigned_to_name", "assigned_at", "accepted_at", "due_at", "needs_confirmed_at", "status", "duplicate_of", "closure_reason", "stage", "stage_label", "stage_responsible", "version", "preferences", "created_at", "updated_at"]
        read_only_fields = ["code", "created_by", "lead_status", "lead_accepted_by", "lead_accepted_at", "acceptance_status", "assigned_at", "accepted_at", "needs_confirmed_at", "version", "created_at", "updated_at"]

    def get_contact_phone(self, obj):
        phone = obj.contact.phones.filter(is_primary=True).first() or obj.contact.phones.first()
        return phone.phone if phone else ""

    def get_stage(self, obj):
        from .services.inquiry_workflow import inquiry_stage

        return inquiry_stage(obj)

    def get_stage_label(self, obj):
        from .services.inquiry_workflow import INQUIRY_STAGE_LABELS, inquiry_stage

        return INQUIRY_STAGE_LABELS.get(inquiry_stage(obj), "")

    def get_stage_responsible(self, obj):
        from .services.inquiry_workflow import inquiry_stage_responsible

        return inquiry_stage_responsible(obj)

    def create(self, validated_data):
        preferences = validated_data.pop("preferences", [])
        inquiry = models.Inquiry.objects.create(**validated_data)
        for item in preferences:
            districts = item.pop("districts", [])
            property_types = item.pop("property_types", [])
            if "deal_type" in item:
                item["deal_type_id"] = item.pop("deal_type")
            if "deal_type_version" in item:
                item["deal_type_version_id"] = item.pop("deal_type_version")
            pref = models.InquiryPreference.objects.create(inquiry=inquiry, **item)
            pref.districts.set(districts)
            pref.property_types.set(property_types)
        return inquiry

    def update(self, instance, validated_data):
        preferences = validated_data.pop("preferences", None)
        for key, value in validated_data.items():
            setattr(instance, key, value)
        instance.save()
        if preferences is not None:
            instance.preferences.all().delete()
            for item in preferences:
                districts = item.pop("districts", [])
                property_types = item.pop("property_types", [])
                if "deal_type" in item:
                    item["deal_type_id"] = item.pop("deal_type")
                if "deal_type_version" in item:
                    item["deal_type_version_id"] = item.pop("deal_type_version")
                pref = models.InquiryPreference.objects.create(inquiry=instance, **item)
                pref.districts.set(districts)
                pref.property_types.set(property_types)
        return instance


class IntroductionSerializer(serializers.ModelSerializer):
    inquiry_code = serializers.CharField(source="inquiry.code", read_only=True)
    contact_name = serializers.CharField(source="inquiry.contact.full_name", read_only=True)
    property_file_title = serializers.CharField(source="property_file.title", read_only=True)
    listing = serializers.IntegerField(source="property_file_id", read_only=True)
    listing_title = serializers.CharField(source="property_file.title", read_only=True)
    introduced_by_name = serializers.SerializerMethodField()
    buyer_consultant_name = serializers.SerializerMethodField()
    seller_consultant_name = serializers.SerializerMethodField()

    class Meta:
        model = models.Introduction
        fields = ["id", "inquiry", "inquiry_code", "contact_name", "property_file", "property_file_title", "listing", "listing_title", "introduced_terms_snapshot", "introduced_by", "introduced_by_name", "buyer_consultant", "buyer_consultant_name", "seller_consultant", "seller_consultant_name", "status", "customer_interest", "feedback", "rejection_reason", "version", "created_at", "updated_at"]
        read_only_fields = ["introduced_terms_snapshot", "introduced_by", "buyer_consultant", "seller_consultant", "version", "created_at", "updated_at"]

    def _name(self, user):
        if not user:
            return ""
        return user.get_full_name() or user.username

    def get_introduced_by_name(self, obj):
        return self._name(obj.introduced_by)

    def get_buyer_consultant_name(self, obj):
        return self._name(obj.buyer_consultant)

    def get_seller_consultant_name(self, obj):
        return self._name(obj.seller_consultant)

    def to_internal_value(self, data):
        normalized = data.copy()
        if "listing" in normalized:
            if "property_file" in normalized and str(normalized["listing"]) != str(normalized["property_file"]):
                raise serializers.ValidationError({"property_file": "شناسه فایل با فیلد سازگاری مغایرت دارد."})
            normalized["property_file"] = normalized.pop("listing")
        return super().to_internal_value(normalized)


class ViewingSerializer(serializers.ModelSerializer):
    assigned_to_name = serializers.SerializerMethodField()
    companion_name = serializers.SerializerMethodField()
    inquiry_id = serializers.IntegerField(source="introduction.inquiry_id", read_only=True)
    inquiry_code = serializers.CharField(source="introduction.inquiry.code", read_only=True)
    introduction_code = serializers.CharField(source="introduction.inquiry.code", read_only=True)
    property_file_title = serializers.CharField(source="introduction.property_file.title", read_only=True)
    contact_name = serializers.CharField(source="introduction.inquiry.contact.full_name", read_only=True)

    class Meta:
        model = models.Viewing
        fields = ["id", "introduction", "introduction_code", "inquiry_id", "inquiry_code", "contact_name", "property_file_title", "scheduled_at", "assigned_to", "assigned_to_name", "companion_id", "companion_name", "result", "notes", "task", "completed_at", "version", "created_at", "updated_at"]
        read_only_fields = ["task", "companion_id", "completed_at", "version", "created_at", "updated_at"]

    def _name(self, user):
        if not user:
            return ""
        return user.get_full_name() or user.username

    def get_assigned_to_name(self, obj):
        return self._name(obj.assigned_to)

    def get_companion_name(self, obj):
        if not obj.companion_id:
            return ""
        from apps.accounts.models import User

        user = User.objects.filter(pk=obj.companion_id).first()
        return self._name(user)


class DealSerializer(serializers.ModelSerializer):
    property_file = serializers.PrimaryKeyRelatedField(read_only=True)
    listing = serializers.IntegerField(source="property_file_id", read_only=True)
    stage_label = serializers.CharField(source="get_stage_display", read_only=True)
    inquiry_code = serializers.CharField(source="inquiry.code", read_only=True)
    contact_name = serializers.CharField(source="inquiry.contact.full_name", read_only=True)
    property_file_title = serializers.CharField(source="property_file.title", read_only=True)
    assigned_to_name = serializers.SerializerMethodField()
    participants = serializers.SerializerMethodField()

    class Meta:
        model = models.Deal
        fields = ["id", "introduction", "viewing", "property_file", "listing", "property_file_title", "inquiry", "inquiry_code", "contact_name", "assigned_to", "assigned_to_name", "deal_type_version", "stage", "stage_label", "result_notes", "closure_reason", "participants", "started_at", "closed_at", "version"]
        read_only_fields = ["property_file", "listing", "inquiry", "stage", "closed_at", "version", "started_at"]

    def get_assigned_to_name(self, obj):
        if not obj.assigned_to_id:
            return ""
        return obj.assigned_to.get_full_name() or obj.assigned_to.username

    def get_participants(self, obj):
        return [
            {
                "id": participant.pk,
                "contact": participant.contact_id,
                "contact_name": participant.contact.full_name,
                "participant_role": participant.participant_role,
                "is_primary": participant.is_primary,
            }
            for participant in obj.participants.select_related("contact")
        ]


class DealParticipantSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.DealParticipant
        fields = "__all__"


class ContractPartySerializer(serializers.ModelSerializer):
    contact_name = serializers.CharField(source="contact.full_name", read_only=True)
    signature_status = serializers.SerializerMethodField()

    class Meta:
        model = models.ContractParty
        fields = ["id", "contract", "contact", "contact_name", "party_role", "identity_snapshot", "signature_status"]

    def get_signature_status(self, obj):
        sig = getattr(obj, "signature", None)
        return sig.status if sig else models.ContractSignature.Status.PENDING


class ContractSerializer(serializers.ModelSerializer):
    parties = ContractPartySerializer(many=True, read_only=True)
    attachments = serializers.SerializerMethodField()
    amendments = serializers.SerializerMethodField()
    deal_type = serializers.SerializerMethodField()
    deal_type_name = serializers.SerializerMethodField()
    inquiry_code = serializers.CharField(source="deal.inquiry.code", read_only=True)
    contact_name = serializers.CharField(source="deal.inquiry.contact.full_name", read_only=True)
    property_title = serializers.CharField(source="deal.property_file.property.title", read_only=True)

    class Meta:
        model = models.Contract
        fields = ["id", "deal", "contract_number", "deal_type", "deal_type_name", "inquiry_code", "contact_name", "property_title", "deal_type_version", "terms_snapshot", "terms_history", "sale_price", "deposit", "monthly_rent", "status", "signed_at", "effective_at", "finalized_at", "created_by", "finalized_by", "version", "parties", "attachments", "amendments", "created_at", "updated_at"]
        read_only_fields = ["contract_number", "status", "signed_at", "finalized_at", "finalized_by", "version", "created_at", "updated_at"]

    def get_attachments(self, obj):
        attachments = obj.attachments.all()
        return ContractAttachmentSerializer(attachments, many=True, context=self.context).data

    def get_amendments(self, obj):
        return [
            {
                "id": item.pk,
                "amendment_number": item.amendment_number,
                "reason": item.reason,
                "previous_terms_snapshot": item.previous_terms_snapshot,
                "new_terms_snapshot": item.new_terms_snapshot,
                "effective_at": item.effective_at,
                "status": item.status,
                "created_at": item.created_at,
            }
            for item in obj.amendments.all()
        ]

    def get_deal_type(self, obj):
        return obj.deal_type_version.deal_type_id if obj.deal_type_version_id else None

    def get_deal_type_name(self, obj):
        return obj.deal_type_version.deal_type.display_name if obj.deal_type_version_id else ""


class FinanceContractSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.Contract
        fields = ["id", "contract_number", "sale_price", "deposit", "monthly_rent", "status"]
        read_only_fields = fields


class ContractAttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.ContractAttachment
        fields = ["id", "contract", "document_type", "file", "filename", "uploaded_by", "uploaded_at"]
        read_only_fields = fields


class ContractAmendmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.ContractAmendment
        fields = "__all__"
        read_only_fields = ["amendment_number", "previous_terms_snapshot", "approved_by", "created_at"]


class CommissionPolicySerializer(serializers.ModelSerializer):
    class Meta:
        model = models.CommissionPolicyVersion
        fields = "__all__"
        read_only_fields = ["created_by", "created_at"]


class CommissionShareSerializer(serializers.ModelSerializer):
    paid_amount = serializers.SerializerMethodField()
    remaining_amount = serializers.SerializerMethodField()

    class Meta:
        model = models.CommissionShare
        fields = ["id", "commission", "beneficiary_type", "beneficiary_user", "share_percent", "amount", "status", "paid_amount", "remaining_amount"]

    def get_paid_amount(self, obj):
        from django.db.models import Sum

        return obj.allocations.filter(
            payment__status__in=(models.Payment.Status.CONFIRMED, models.Payment.Status.REVERSED)
        ).aggregate(total=Sum("amount"))["total"] or 0

    def get_remaining_amount(self, obj):
        return obj.amount - self.get_paid_amount(obj)


class CommissionSerializer(serializers.ModelSerializer):
    shares = CommissionShareSerializer(many=True, read_only=True)
    received_amount = serializers.SerializerMethodField()
    remaining_amount = serializers.SerializerMethodField()

    class Meta:
        model = models.Commission
        fields = ["id", "contract", "debtor_contact", "policy_version", "calculation_snapshot", "calculated_amount", "adjustment_amount", "final_amount", "adjustment_reason", "due_at", "status", "shares", "received_amount", "remaining_amount", "created_at", "updated_at"]
        read_only_fields = ["calculation_snapshot", "calculated_amount", "created_at", "updated_at"]

    def get_received_amount(self, obj):
        from django.db.models import Sum

        return obj.allocations.filter(
            payment__status__in=(models.Payment.Status.CONFIRMED, models.Payment.Status.REVERSED),
            payment__direction=models.Payment.Direction.IN,
        ).aggregate(total=Sum("amount"))["total"] or 0

    def get_remaining_amount(self, obj):
        return obj.final_amount - self.get_received_amount(obj)


class PaymentAllocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.PaymentAllocation
        fields = ["id", "payment", "commission", "commission_share", "amount"]
        read_only_fields = ["payment"]


class PaymentSerializer(serializers.ModelSerializer):
    allocations = PaymentAllocationSerializer(many=True, required=False)

    class Meta:
        model = models.Payment
        fields = ["id", "direction", "contact", "user", "amount", "paid_at", "method", "reference_number", "status", "recorded_by", "reversal_of", "allocations", "created_at"]
        read_only_fields = ["status", "recorded_by", "reversal_of", "created_at"]

    def create(self, validated_data):
        allocations = validated_data.pop("allocations", [])
        payment = models.Payment.objects.create(**validated_data)
        for item in allocations:
            models.PaymentAllocation.objects.create(payment=payment, **item)
        return payment


class StageTransitionSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.StageTransitionHistory
        fields = "__all__"


class WorkflowSettingsSerializer(serializers.ModelSerializer):
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = models.WorkflowSettings
        fields = ["id", "assignment_waiting_hours", "default_assignment_due_days", "withdrawal_decision_note_required", "extension_decision_note_required", "stall_threshold_days", "updated_by", "updated_by_name", "updated_at"]
        read_only_fields = ["id", "updated_by", "updated_at"]

    def get_updated_by_name(self, obj):
        return obj.updated_by.get_full_name() or obj.updated_by.username if obj.updated_by else ""
