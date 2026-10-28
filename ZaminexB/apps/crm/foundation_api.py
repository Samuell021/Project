import datetime

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import RolePermission, ScopeMembership, StaffProfile
from apps.basics.models import DealType, DealTypeVersion
from apps.accounts.permission_catalog import PERMISSION_CODES
from apps.accounts.permissions import permission_codes_for_user, require_permission
from apps.accounts.scoping import team_user_ids
from apps.accounts.serializers import ConsultantProfileSerializer

from .services.foundation import save_staff
from .views import CrmBase, execute_idempotently


APPLYABLE_FIELDS = ("full_name", "mobile", "branch", "hired_at", "notes")


class StaffSerializer(ConsultantProfileSerializer):
    def validate(self, attrs):
        if "role" in self.initial_data:
            raise serializers.ValidationError({"role": "نقش کارمند از نقش‌های تعریف‌شده در تنظیمات دسترسی خوانده می‌شود."})
        return super().validate(attrs)

    def create(self, validated_data):
        staff_code = validated_data.pop("staff_code", None)
        profile = super().create(validated_data)
        profile.staff_code = staff_code
        profile.save(update_fields=["staff_code"])
        return profile

    class Meta(ConsultantProfileSerializer.Meta):
        fields = [name for name in ConsultantProfileSerializer.Meta.fields if name not in {"role", "extra_roles"}] + ["staff_code", "version", "legacy_metadata"]
        read_only_fields = ["id", "version", "legacy_metadata"]


class StaffViewSet(CrmBase):
    serializer_class = StaffSerializer
    queryset = StaffProfile.objects.select_related("user")
    search_fields = ("full_name", "mobile", "staff_code", "user__username")
    ordering_fields = ("id", "full_name", "hired_at", "staff_code")
    list_filter_fields = {"active": "is_active"}
    allow_create = True
    allow_update = True

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        require_permission(request.user, "staff.manage")

    def get_queryset(self):
        queryset = super().get_queryset()
        ids = team_user_ids(self.request.user)
        return queryset if ids is None else queryset.filter(user_id__in=ids)

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "is_admin_request": True}

    def perform_create(self, serializer):
        save_staff(self.request.user, serializer, self.request.data)

    def update(self, request, *args, **kwargs):
        def perform():
            instance = self.get_object()
            serializer = self.get_serializer(instance, data=request.data, partial=kwargs.get("partial", False))
            serializer.is_valid(raise_exception=True)
            save_staff(request.user, serializer, request.data)
            return Response(serializer.data)
        return execute_idempotently(request, "crm.staff.update", perform)

    @action(detail=True, methods=["post"], url_path="review_legacy")
    def review_legacy(self, request, pk=None):
        def perform():
            with transaction.atomic():
                profile = StaffProfile.objects.select_for_update().get(pk=self.get_object().pk)
                metadata = dict(profile.legacy_metadata or {})
                if not metadata.get("review_required"):
                    raise ValidationError({"detail": "این پروفایل تعارض بازبینی‌نشده ندارد."})
                decision = str(request.data.get("decision") or "").strip()
                if decision not in ("KEEP_CURRENT", "APPLY_ARCHIVE"):
                    raise ValidationError({"decision": "تصمیم بازبینی معتبر نیست."})
                notes = str(request.data.get("notes") or "").strip()[:5000]
                snapshot = metadata.get("admin_profile") or {}
                conflicting = [field for field in metadata.get("conflicting_fields") or [] if field in APPLYABLE_FIELDS]
                applied = []
                updates = {}
                if decision == "APPLY_ARCHIVE":
                    requested = request.data.get("fields", conflicting)
                    if not isinstance(requested, list) or not requested:
                        raise ValidationError({"fields": "حداقل یک فیلد برای اعمال انتخاب کنید."})
                    fields = [str(field) for field in requested]
                    invalid = [field for field in fields if field not in conflicting]
                    if invalid:
                        raise ValidationError({"fields": "فیلد انتخاب‌شده تعارض قابل اعمال ندارد."})
                    for field in fields:
                        value = snapshot.get(field)
                        if value in (None, ""):
                            continue
                        if field == "hired_at":
                            try:
                                value = datetime.date.fromisoformat(str(value))
                            except ValueError:
                                raise ValidationError({"fields": "تاریخ استخدام آرشیو معتبر نیست."})
                        updates[field] = value
                    mobile = updates.get("mobile")
                    if mobile and StaffProfile.objects.exclude(pk=profile.pk).filter(mobile=mobile).exists():
                        raise ValidationError({"mobile": "شماره آرشیو برای پروفایل دیگری ثبت شده است؛ تصمیم هویتی دستی لازم است."})
                    for field, value in updates.items():
                        setattr(profile, field, value)
                        applied.append(field)
                metadata["review"] = {
                    "decision": decision,
                    "fields": applied,
                    "notes": notes,
                    "reviewed_by": request.user.username,
                    "reviewed_at": timezone.now().isoformat(),
                }
                metadata["review_required"] = False
                profile.legacy_metadata = metadata
                profile.version += 1
                profile.save(update_fields=["legacy_metadata", "version", *updates.keys()])
                return Response(self.get_serializer(profile).data)
        return execute_idempotently(request, "crm.staff.review_legacy", perform)


class MeViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def list(self, request):
        user = request.user
        now = timezone.now()
        memberships = ScopeMembership.objects.filter(user=user, started_at__lte=now).filter(Q(ended_at__isnull=True) | Q(ended_at__gt=now)).filter(sales_range__is_active=True)
        permissions = sorted(permission_codes_for_user(user))
        return Response({
            "user": {"id": user.pk, "username": user.username, "full_name": user.get_full_name() or user.username, "role": user.role},
            "groups": list(user.groups.order_by("name").values("id", "name")),
            "permissions": permissions,
            "scopes": list(memberships.values("id", "sales_range_id", "sales_range__name", "membership_role", "started_at", "ended_at")),
            "capabilities": {code: code in permissions for code in PERMISSION_CODES},
        })


class DealTypeSerializer(serializers.ModelSerializer):
    versions = serializers.SerializerMethodField()
    published_version = serializers.SerializerMethodField()

    class Meta:
        model = DealType
        fields = ["id", "name", "display_name", "family", "is_active", "sort_order", "versions", "published_version"]

    def get_versions(self, obj):
        from .serializers import DealTypeVersionSerializer
        return DealTypeVersionSerializer(obj.versions.all(), many=True).data

    def get_published_version(self, obj):
        """Latest released version of this deal type, or null when nothing is released yet.

        The registration wizard and the supply form must only offer a deal type once its terms
        are publishable, so the released version is resolved on the server (a newer draft never
        wins) instead of being guessed from the ``versions`` list by the client.
        """
        from .serializers import DealTypeVersionSerializer

        published = [
            version
            for version in obj.versions.all()
            if version.status == DealTypeVersion.Status.PUBLISHED
        ]
        if not published:
            return None
        latest = max(published, key=lambda version: version.version_number)
        return DealTypeVersionSerializer(latest).data


class DealTypeViewSet(CrmBase):
    serializer_class = DealTypeSerializer
    queryset = DealType.objects.all().prefetch_related("versions").order_by("sort_order", "pk")
    search_fields = ("name", "display_name", "family")
    list_filter_fields = {"behavior": "family", "active": "is_active"}
    ordering_fields = ("id", "display_name", "sort_order")
    allow_create = True
    allow_update = True

    def perform_create(self, serializer):
        require_permission(self.request.user, "dealtype.manage")
        serializer.save()

    def perform_update(self, serializer):
        require_permission(self.request.user, "dealtype.manage")
        if serializer.instance.versions.filter(status=DealTypeVersion.Status.PUBLISHED).exists():
            if any(key in serializer.validated_data and serializer.validated_data[key] != getattr(serializer.instance, key) for key in ["name", "family"]):
                raise serializers.ValidationError({"name": "کد و رفتار نوع منتشرشده قابل تغییر نیست."})
        serializer.save()
