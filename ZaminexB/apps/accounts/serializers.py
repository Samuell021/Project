from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.analytics.metrics import consultant_performance_metrics

from .models import AdminProfile, ConsultantProfile, ROLE_GROUP_MAP, Role, SalesRange, UserRole, group_name_for_role

User = get_user_model()


class ConsultantProfileSerializer(serializers.ModelSerializer):
    first_name = serializers.CharField(write_only=True, required=False, allow_blank=True)
    last_name = serializers.CharField(write_only=True, required=False, allow_blank=True)
    username = serializers.CharField(write_only=True, required=False, allow_blank=True)
    email = serializers.EmailField(write_only=True, required=False, allow_blank=True)
    password = serializers.CharField(
        write_only=True,
        required=False,
        min_length=8,
        error_messages={
            "min_length": "رمز عبور باید حداقل ۸ کاراکتر باشد.",
            "blank": "رمز عبور نمی‌تواند خالی باشد.",
        },
    )
    role = serializers.ChoiceField(
        choices=[UserRole.AGENT, UserRole.RANGE_MANAGER],
        write_only=True,
        required=False,
    )
    extra_roles = serializers.ListField(
        child=serializers.CharField(max_length=40),
        write_only=True,
        required=False,
    )

    class Meta:
        model = ConsultantProfile
        fields = [
            "id",
            "first_name",
            "last_name",
            "username",
            "email",
            "password",
            "role",
            "extra_roles",
            "full_name",
            "mobile",
            "branch",
            "profile_image",
            "hired_at",
            "notes",
            "is_active",
        ]
        read_only_fields = ["id"]

    def validate_mobile(self, value):
        if value and not value.startswith("09"):
            raise serializers.ValidationError("شماره موبایل معتبر نیست. شماره باید با ۰۹ شروع شود.")
        if value and len(value) != 11:
            raise serializers.ValidationError("شماره موبایل باید ۱۱ رقم باشد.")
        return value

    def _extra_role_groups(self, codes):
        from django.contrib.auth.models import Group

        if not isinstance(codes, list):
            raise serializers.ValidationError({"extra_roles": "فهرست نقش‌های تکمیلی معتبر نیست."})
        requested = [str(code).strip() for code in codes if str(code).strip()]
        roles = list(Role.objects.filter(code__in=requested))
        if len(roles) != len(set(requested)) or any(role.code in ROLE_GROUP_MAP for role in roles):
            raise serializers.ValidationError({"extra_roles": "نقش تکمیلی انتخاب‌شده معتبر نیست."})
        return [Group.objects.get_or_create(name=group_name_for_role(role.code))[0] for role in roles]

    def validate(self, attrs):
        if attrs.get("mobile") == "":
            attrs["mobile"] = None

        mobile = attrs.get("mobile")
        username = attrs.get("username")

        if username and User.objects.filter(username=username).exists():
            if self.instance and self.instance.user.username == username:
                pass
            else:
                raise serializers.ValidationError({"username": "این نام کاربری قبلاً ثبت شده است."})

        if mobile and ConsultantProfile.objects.filter(mobile=mobile).exists():
            if self.instance and self.instance.mobile == mobile:
                pass
            else:
                raise serializers.ValidationError({"mobile": "این شماره موبایل قبلاً برای کاربر دیگری ثبت شده است."})

        return attrs

    @transaction.atomic
    def create(self, validated_data):
        first_name = validated_data.pop("first_name", "")
        last_name = validated_data.pop("last_name", "")
        username = validated_data.pop("username", None) or validated_data.get("email", "")
        email = validated_data.pop("email", "")
        password = validated_data.pop("password", None)
        role = validated_data.pop("role", UserRole.AGENT)
        extra_roles = validated_data.pop("extra_roles", None)
        if extra_roles is not None and not self.context.get("is_admin_request"):
            raise serializers.ValidationError({"extra_roles": "فقط مدیر می‌تواند نقش تکمیلی تعیین کند."})
        extra_groups = self._extra_role_groups(extra_roles) if extra_roles is not None else []

        if not password:
            raise serializers.ValidationError({"password": "وارد کردن رمز عبور برای ایجاد کارشناس الزامی است."})

        full_name = validated_data.get("full_name") or f"{first_name} {last_name}".strip()

        user = User.objects.create_user(
            username=username,
            email=email,
            password=password,
            first_name=first_name,
            last_name=last_name,
            role=role,
        )

        if extra_groups:
            user.groups.add(*extra_groups)

        consultant_profile = ConsultantProfile.objects.create(
            user=user,
            full_name=full_name,
            mobile=validated_data.get("mobile", ""),
            branch=validated_data.get("branch", ""),
            profile_image=validated_data.get("profile_image", None),
            hired_at=validated_data.get("hired_at") or timezone.now().date(),
            notes=validated_data.get("notes", ""),
            is_active=validated_data.get("is_active", True),
        )

        return consultant_profile

    @transaction.atomic
    def update(self, instance, validated_data):
        if not self.context.get("is_admin_request"):
            validated_data.pop("is_active", None)

        first_name = validated_data.pop("first_name", None)
        last_name = validated_data.pop("last_name", None)
        username = validated_data.pop("username", None)
        email = validated_data.pop("email", None)
        role = validated_data.pop("role", None)
        extra_roles = validated_data.pop("extra_roles", None)
        validated_data.pop("password", None)

        user = instance.user
        if self.context.get("is_admin_request") and (role or extra_roles is not None):
            from django.contrib.auth.models import Group

            base_group = Group.objects.get_or_create(name=ROLE_GROUP_MAP[role or user.role or UserRole.AGENT])[0]
            if extra_roles is not None:
                user.groups.set([base_group, *self._extra_role_groups(extra_roles)])
            else:
                user.groups.set([base_group, *user.groups.exclude(name__in=set(ROLE_GROUP_MAP.values()))])
        if first_name is not None:
            user.first_name = first_name
        if last_name is not None:
            user.last_name = last_name
        if username and username != user.username:
            user.username = username
        if email is not None:
            user.email = email
        user.save()

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        return instance

    def to_representation(self, instance):
        data = super().to_representation(instance)
        user = instance.user

        data["user"] = {
            "id": user.id,
            "username": user.username,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "email": user.email,
            "role": user.role,
        }
        data["extra_roles"] = sorted(
            group.name for group in user.groups.all() if group.name not in set(ROLE_GROUP_MAP.values())
        )
        perf = consultant_performance_metrics(instance)
        data["agentId"] = perf["agentId"]
        data["tenureDays"] = perf["tenureDays"]
        data["tasksOverdueCount"] = perf["tasksOverdueCount"]
        data["followupsOverdueCount"] = perf["followupsOverdueCount"]
        data["closedDealsCount"] = perf["closedDealsCount"]
        data["completedWorkCount"] = perf["completedWorkCount"]
        data["overdueWorkCount"] = perf["overdueWorkCount"]
        data["headlineValue"] = perf["headlineValue"]
        data["headlineLabel"] = perf["headlineLabel"]
        return data

class AdminProfileSerializer(serializers.ModelSerializer):
    first_name = serializers.CharField(write_only=True, required=False, allow_blank=True)
    last_name = serializers.CharField(write_only=True, required=False, allow_blank=True)
    username = serializers.CharField(write_only=True, required=False, allow_blank=True)
    email = serializers.EmailField(write_only=True, required=False, allow_blank=True)
    password = serializers.CharField(
        write_only=True,
        required=False,
        min_length=8,
        error_messages={
            "min_length": "رمز عبور باید حداقل ۸ کاراکتر باشد.",
            "blank": "رمز عبور نمی‌تواند خالی باشد.",
        },
    )

    class Meta:
        model = AdminProfile
        fields = [
            "id",
            "first_name",
            "last_name",
            "username",
            "email",
            "password",
            "full_name",
            "mobile",
            "branch",
            "profile_image",
            "hired_at",
            "notes",
            "is_active",
        ]
        read_only_fields = ["id", "is_active"]

    def validate_mobile(self, value):
        if value and not value.startswith("09"):
            raise serializers.ValidationError("شماره موبایل معتبر نیست. شماره باید با ۰۹ شروع شود.")
        if value and len(value) != 11:
            raise serializers.ValidationError("شماره موبایل باید ۱۱ رقم باشد.")
        return value

    def validate(self, attrs):
        if attrs.get("mobile") == "":
            attrs["mobile"] = None

        username = attrs.get("username")
        if username and User.objects.filter(username=username).exists():
            if self.instance and self.instance.user.username == username:
                pass
            else:
                raise serializers.ValidationError({"username": "این نام کاربری قبلاً ثبت شده است."})

        return attrs

    @transaction.atomic
    def update(self, instance, validated_data):
        first_name = validated_data.pop("first_name", None)
        last_name = validated_data.pop("last_name", None)
        username = validated_data.pop("username", None)
        email = validated_data.pop("email", None)
        validated_data.pop("password", None)

        user = instance.user
        if first_name is not None:
            user.first_name = first_name
        if last_name is not None:
            user.last_name = last_name
        if username and username != user.username:
            user.username = username
        if email is not None:
            user.email = email
        user.save()

        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        if not instance.full_name:
            full = f"{user.first_name} {user.last_name}".strip()
            if full:
                instance.full_name = full

        instance.save()
        return instance

    def to_representation(self, instance):
        data = super().to_representation(instance)
        user = instance.user
        data["user"] = {
            "id": user.id,
            "username": user.username,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "email": user.email,
            "role": user.role,
        }
        return data


class RangeUserSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "name", "role"]

    def get_name(self, obj):
        return obj.get_full_name().strip() or obj.username


class SalesRangeSerializer(serializers.ModelSerializer):
    managers = RangeUserSerializer(many=True, read_only=True)
    members = RangeUserSerializer(many=True, read_only=True)
    manager_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        source="managers",
        write_only=True,
        required=False,
        queryset=User.objects.filter(groups__name="RANGE_MANAGER", is_active=True),
    )
    member_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        source="members",
        write_only=True,
        required=False,
        queryset=User.objects.filter(groups__name="AGENT", is_active=True),
    )

    class Meta:
        model = SalesRange
        fields = [
            "id",
            "name",
            "is_active",
            "managers",
            "members",
            "manager_ids",
            "member_ids",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    def validate_name(self, value):
        name = (value or "").strip()
        if not name:
            raise serializers.ValidationError("نام رنج الزامی است.")
        queryset = SalesRange.objects.filter(name=name)
        if self.instance is not None:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError("رنجی با این نام وجود دارد.")
        return name
