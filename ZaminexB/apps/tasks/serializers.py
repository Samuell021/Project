from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import serializers

from apps.properties.models import Property

from .models import Task


User = get_user_model()


class UserMiniSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()
    mobile = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "name", "email", "mobile", "role"]

    def get_name(self, obj):
        return obj.get_full_name().strip() or obj.username

    def get_mobile(self, obj):
        profile = getattr(obj, "consultant_profile", None)
        return profile.mobile if profile else None


class PropertyMiniSerializer(serializers.ModelSerializer):
    district = serializers.CharField(source="neighborhood", read_only=True)
    price = serializers.SerializerMethodField()

    def get_price(self, obj):
        from apps.analytics.metrics import effective_sale_price

        price = effective_sale_price(obj)
        return str(price) if price is not None else None


    class Meta:
        model = Property
        fields = ["id", "title", "district", "price", "area", "floor", "internal_code"]


class TaskSerializer(serializers.ModelSerializer):
    assigned_to_detail = UserMiniSerializer(source="assigned_to", read_only=True)
    created_by_detail = UserMiniSerializer(source="created_by", read_only=True)
    property_detail = PropertyMiniSerializer(source="property", read_only=True)
    property_case_code = serializers.CharField(source="property_case.code", read_only=True, allow_null=True)
    inquiry_code = serializers.CharField(source="inquiry.code", read_only=True, allow_null=True)
    propertyCaseId = serializers.IntegerField(source="property_case_id", read_only=True, allow_null=True)
    inquiryId = serializers.IntegerField(source="inquiry_id", read_only=True, allow_null=True)

    taskType = serializers.SerializerMethodField()
    assignee = serializers.SerializerMethodField()
    assigneeId = serializers.IntegerField(source="assigned_to_id", read_only=True)
    creator = serializers.SerializerMethodField()
    propertyId = serializers.IntegerField(source="property_id", read_only=True, allow_null=True)
    due = serializers.DateField(source="due_date", read_only=True)
    isOverdue = serializers.SerializerMethodField()
    completionDate = serializers.SerializerMethodField()
    statusLabel = serializers.SerializerMethodField()
    priorityLabel = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = [
            "id",
            "title",
            "description",
            "note",
            "status",
            "priority",
            "task_type",
            "taskType",
            "assigned_to",
            "assigned_to_detail",
            "assignee",
            "assigneeId",
            "created_by",
            "created_by_detail",
            "creator",
            "property",
            "property_detail",
            "property_case",
            "property_case_code",
            "propertyCaseId",
            "inquiry",
            "inquiry_code",
            "inquiryId",
            "propertyId",
            "due_date",
            "due",
            "isOverdue",
            "completed_at",
            "completionDate",
            "created_at",
            "updated_at",
            "statusLabel",
            "priorityLabel",
        ]
        read_only_fields = ["created_by", "created_at", "updated_at", "completed_at"]

    def get_taskType(self, obj):
        return obj.get_task_type_display()

    def get_assignee(self, obj):
        if not obj.assigned_to:
            return None
        return obj.assigned_to.get_full_name().strip() or obj.assigned_to.username

    def get_creator(self, obj):
        if not obj.created_by:
            return None
        return obj.created_by.get_full_name().strip() or obj.created_by.username

    def get_isOverdue(self, obj):
        return bool(obj.is_overdue())

    def get_completionDate(self, obj):
        if not obj.completed_at:
            return None
        return obj.completed_at.date().isoformat()

    def get_statusLabel(self, obj):
        return obj.get_status_display()

    def get_priorityLabel(self, obj):
        return obj.get_priority_display()


    def to_internal_value(self, data):
        if hasattr(data, "copy"):
            data = data.copy()

        if "taskType" in data and "task_type" not in data:
            value = str(data["taskType"]).strip()
            data["task_type"] = value.upper() if value.upper() in dict(Task.TaskType.choices) else value

        if "priority" in data:
            value = str(data["priority"]).strip()
            data["priority"] = value.upper() if value.upper() in dict(Task.Priority.choices) else value.lower()

        if "status" in data and isinstance(data["status"], str):
            data["status"] = data["status"].upper()

        if "assignee" in data and "assigned_to" not in data:
            value = data["assignee"]
            if value not in (None, "", "null"):
                data["assigned_to"] = value
            data.pop("assignee", None)

        if "propertyId" in data and "property" not in data:
            pid = data["propertyId"]
            if pid in (None, "", "null"):
                data.pop("propertyId", None)
            else:
                data["property"] = pid

        if "propertyCaseId" in data and "property_case" not in data:
            data["property_case"] = data.pop("propertyCaseId")

        if "inquiryId" in data and "inquiry" not in data:
            data["inquiry"] = data.pop("inquiryId")

        if "due" in data and "due_date" not in data:
            data["due_date"] = data["due"]

        return super().to_internal_value(data)

    def validate(self, attrs):
        from apps.accounts.scoping import user_in_scope, user_is_admin
        from apps.common.access import can_access_property
        from apps.crm.services import can_view_case

        request = self.context.get("request")
        user = getattr(request, "user", None) if request else None
        instance = self.instance

        if user and getattr(user, "is_authenticated", False):
            assigned_to = attrs.get(
                "assigned_to", instance.assigned_to if instance else None
            )
            if (
                assigned_to is not None
                and assigned_to.pk != user.pk
                and not user_is_admin(user)
                and not user_in_scope(user, assigned_to.pk)
            ):
                raise serializers.ValidationError(
                    {"assigned_to": "این کاربر در رنج شما نیست."}
                )

            prop = attrs.get("property", instance.property if instance else None)
            if prop is not None and not can_access_property(user, prop):
                raise serializers.ValidationError(
                    {"property": "شما به این ملک دسترسی ندارید."}
                )

            property_case = attrs.get(
                "property_case", instance.property_case if instance else None
            )
            inquiry = attrs.get("inquiry", instance.inquiry if instance else None)
            if property_case is not None and inquiry is not None:
                raise serializers.ValidationError(
                    {"property_case": "وظیفه فقط به یک پرونده یا درخواست متصل می‌شود."}
                )
            if property_case is not None and not can_view_case(user, property_case):
                raise serializers.ValidationError(
                    {"property_case": "شما به این پرونده دسترسی ندارید."}
                )
            if inquiry is not None and not can_view_case(user, inquiry):
                raise serializers.ValidationError(
                    {"inquiry": "شما به این درخواست دسترسی ندارید."}
                )

        new_status = attrs.get("status")
        if new_status == Task.Status.COMPLETED:
            if not instance or not instance.completed_at:
                attrs["completed_at"] = timezone.now()
        elif (
            new_status
            and new_status != Task.Status.COMPLETED
            and instance
            and instance.completed_at
        ):
            attrs["completed_at"] = None
        return attrs
