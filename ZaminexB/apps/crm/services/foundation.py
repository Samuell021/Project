from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from apps.accounts.models import StaffProfile, User
from apps.accounts.permissions import require_permission
from apps.activity.models import ActivityLog


class VersionConflict(APIException):
    status_code = 409
    default_detail = "این رکورد تغییر کرده است؛ اطلاعات را تازه کنید و دوباره تلاش کنید."


def require_version(instance, payload):
    value = payload.get("version")
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValidationError({"version": "نسخه صحیح رکورد الزامی است."})
    if value != instance.version:
        raise VersionConflict()


@transaction.atomic
def save_staff(actor, serializer, payload):
    require_permission(actor, "staff.manage")
    profile = serializer.instance
    if profile:
        locked = StaffProfile.objects.select_for_update().select_related("user").get(pk=profile.pk)
        User.objects.select_for_update().get(pk=locked.user_id)
        require_version(locked, payload)
        serializer.instance = locked
    password = serializer.validated_data.get("password")
    if password:
        try:
            validate_password(password, profile.user if profile else None)
        except DjangoValidationError as exc:
            raise ValidationError({"password": exc.messages})
    profile = serializer.save()
    if actor.pk == profile.user_id and not profile.is_active:
        raise ValidationError({"is_active": "غیرفعال‌کردن حساب جاری مجاز نیست."})
    if serializer.instance and payload.get("version") is not None:
        profile.version += 1
        profile.save(update_fields=["version"])
    user = profile.user
    user.is_active = profile.is_active
    user.save(update_fields=["is_active"])
    ActivityLog.objects.create(user=actor, action="update" if payload.get("version") is not None else "create", target_type="consultant", target_id=profile.pk, description="ثبت مشخصات کارمند", metadata={"version": profile.version})
    return profile
