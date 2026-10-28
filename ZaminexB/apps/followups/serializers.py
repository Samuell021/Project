from django.contrib.auth import get_user_model
from rest_framework import serializers

from apps.properties.models import Property
from apps.crm.models import Inquiry, PropertyRegistrationRequest
from .models import FollowUp, FollowUpStatus, FollowUpType

User = get_user_model()


class FollowUpListSerializer(serializers.ModelSerializer):
    type = serializers.CharField(source="follow_up_type", read_only=True)
    contact = serializers.CharField(source="contact_name", read_only=True)
    date = serializers.DateTimeField(source="scheduled_at", read_only=True)
    consultant = serializers.CharField(source="consultant_name", read_only=True)
    consultantId = serializers.PrimaryKeyRelatedField(source="consultant", read_only=True)
    propertyId = serializers.PrimaryKeyRelatedField(source="property", read_only=True)
    property = serializers.CharField(source="property_title", read_only=True)
    propertyCaseId = serializers.IntegerField(source="property_case_id", read_only=True, allow_null=True)
    property_case_code = serializers.CharField(source="property_case.code", read_only=True, allow_null=True)
    inquiryId = serializers.IntegerField(source="inquiry_id", read_only=True, allow_null=True)
    inquiry_code = serializers.CharField(source="inquiry.code", read_only=True, allow_null=True)
    isOverdue = serializers.SerializerMethodField()
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)
    updatedAt = serializers.DateTimeField(source="updated_at", read_only=True)

    class Meta:
        model = FollowUp
        fields = [
            "id",
            "title",
            "type",
            "contact",
            "date",
            "consultant",
            "consultantId",
            "property",
            "propertyId",
            "propertyCaseId",
            "property_case_code",
            "inquiryId",
            "inquiry_code",
            "outcome",
            "status",
            "probability",
            "notes",
            "outcome",
            "next_action",
            "next_action_at",
            "completed_at",
            "reschedule_history",
            "version",
            "is_archived",
            "isOverdue",
            "createdAt",
            "updatedAt",
        ]

    def get_isOverdue(self, obj):
        return bool(obj.is_overdue())


class FollowUpWriteSerializer(serializers.ModelSerializer):
    type = serializers.ChoiceField(
        choices=FollowUpType.choices,
        source="follow_up_type",
        required=True,
    )
    contact = serializers.CharField(
        source="contact_name",
        required=True,
        allow_blank=False,
        max_length=255,
    )
    date = serializers.DateTimeField(
        source="scheduled_at",
        required=True,
    )
    
    consultantId = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(groups__name__in=["AGENT", "RANGE_MANAGER"]),
        source="consultant",
        required=True,
    )
    propertyId = serializers.PrimaryKeyRelatedField(
        queryset=Property.objects.all(),
        source="property",
        required=False,
        allow_null=True,
    )
    propertyCaseId = serializers.PrimaryKeyRelatedField(
        queryset=PropertyRegistrationRequest.objects.all(),
        source="property_case",
        required=False,
        allow_null=True,
    )
    inquiryId = serializers.PrimaryKeyRelatedField(
        queryset=Inquiry.objects.all(),
        source="inquiry",
        required=False,
        allow_null=True,
    )
    notes = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    outcome = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    probability = serializers.IntegerField(required=False, allow_null=True)
    status = serializers.ChoiceField(
        choices=FollowUpStatus.choices,
        required=False,
        default=FollowUpStatus.SCHEDULED,
    )

    class Meta:
        model = FollowUp
        fields = [
            "id",
            "title",
            "type",
            "contact",
            "date",
            "consultantId",
            "propertyId",
            "propertyCaseId",
            "inquiryId",
            "notes",
            "outcome",
            "status",
            "probability",
        ]

    def validate_probability(self, value):
        if value is None:
            return value
        if value < 0 or value > 100:
            raise serializers.ValidationError("احتمال موفقیت باید عددی بین ۰ تا ۱۰۰ باشد.")
        return value

    def validate(self, attrs):
        from apps.common.access import can_access_property

        request = self.context.get("request")
        user = getattr(request, "user", None) if request else None
        if user and getattr(user, "is_authenticated", False):
            from apps.accounts.permissions import has_permission
            from apps.accounts.scoping import user_in_scope, user_is_admin

            if not user_is_admin(user):
                requested = attrs.get("consultant")
                allowed = (
                    getattr(user, "role", "") == "RANGE_MANAGER"
                    and has_permission(user, "followup.manage")
                    and requested is not None
                    and user_in_scope(user, requested.pk)
                )
                if not allowed:
                    attrs["consultant"] = user

        prop = attrs.get("property")
        if prop is None and self.instance is not None:
            prop = self.instance.property
        if user and prop is not None and not can_access_property(user, prop):
            raise serializers.ValidationError({"propertyId": "شما به این ملک دسترسی ندارید."})

        property_case = attrs.get(
            "property_case", self.instance.property_case if self.instance else None
        )
        inquiry = attrs.get("inquiry", self.instance.inquiry if self.instance else None)
        if property_case is not None and inquiry is not None:
            raise serializers.ValidationError(
                {"propertyCaseId": "پیگیری فقط به یک پرونده یا درخواست متصل می‌شود."}
            )
        if user and getattr(user, "is_authenticated", False):
            from apps.crm.services import can_view_case

            if property_case is not None and not can_view_case(user, property_case):
                raise serializers.ValidationError(
                    {"propertyCaseId": "شما به این پرونده دسترسی ندارید."}
                )
            if inquiry is not None and not can_view_case(user, inquiry):
                raise serializers.ValidationError(
                    {"inquiryId": "شما به این درخواست دسترسی ندارید."}
                )

        status_value = attrs.get("status")
        outcome_value = attrs.get("outcome", None)

        if status_value == FollowUpStatus.COMPLETED and not outcome_value:
            raise serializers.ValidationError(
                {"outcome": "ثبت نتیجه برای پیگیری تکمیل‌شده الزامی است."}
            )

        return attrs

class FollowUpArchiveSerializer(serializers.Serializer):
    is_archived = serializers.BooleanField(read_only=True)
