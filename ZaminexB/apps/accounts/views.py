from django.contrib.auth import login, update_session_auth_hash
from django.contrib.auth.views import LoginView
from django.db import transaction
from django.http import HttpResponseRedirect
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.csrf import ensure_csrf_cookie

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .forms import INACTIVE_ACCOUNT_MESSAGE, ZaminexAuthenticationForm
from .models import (
    AdminProfile,
    ConsultantProfile,
    LoginMethod,
    Role,
    RolePermission,
    ROLE_GROUP_MAP,
    SalesRange,
    group_name_for_role,
    ScopeMembership,
    UserRole,
)
from .permission_catalog import PERMISSION_CODES, PERMISSION_DEFINITIONS
from .permissions import has_permission, permission_codes_for_user
from .scoping import can_manage_team_member, team_user_ids, user_is_admin
from .serializers import (
    AdminProfileSerializer,
    ConsultantProfileSerializer,
    RangeUserSerializer,
    SalesRangeSerializer,
)
from .sms import (
    OtpVerificationError,
    SmsSendError,
    active_login_method,
    find_user_by_mobile,
    is_sms_configured,
    issue_code,
    normalize_mobile,
    otp_length,
    resend_cooldown_remaining,
    send_verification_code,
    set_login_method,
    verify_code,
)
from .throttles import SmsRequestRateThrottle, SmsVerifyRateThrottle


def _safe_next_url(request) -> str:
    next_url = (request.data.get("next") or "").strip()
    if next_url and url_has_allowed_host_and_scheme(
        url=next_url,
        allowed_hosts={request.get_host()},
        require_https=request.is_secure(),
    ):
        return next_url
    return "/"


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CustomLoginView(LoginView):
    template_name = "accounts/login.html"
    form_class = ZaminexAuthenticationForm

    def get(self, request, *args, **kwargs):
        if request.user.is_authenticated:
            redirect_to = self.get_success_url()
            if redirect_to == request.path:
                raise ValueError(
                    "Redirection loop for authenticated user detected. Check that "
                    "your LOGIN_REDIRECT_URL doesn't point to a login page."
                )
            return HttpResponseRedirect(redirect_to)
        return super().get(request, *args, **kwargs)

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)

        context["initial_data"] = {
            "isAuthenticated": False,
            "role": None,
            "userName": "",
            "currentConsultantId": None,
            "initialPage": "login",
            "loginUrl": "/accounts/login/",
            "logoutUrl": "/accounts/logout/",
            "csrfToken": get_token(self.request),
            "next": self.request.GET.get("next", "/"),
            "loginMethod": active_login_method(),
        }

        form = context.get("form")
        login_errors = {}

        if form and form.errors:
            for field, error_list in form.errors.items():
                login_errors[field] = [str(e) for e in error_list]

        if self.request.GET.get("deactivated"):
            login_errors.setdefault("__all__", []).append(INACTIVE_ACCOUNT_MESSAGE)

        context["login_errors"] = login_errors
        return context


class IsAdminRole(BasePermission):
    message = "فقط مدیران به این بخش دسترسی دارند."

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and getattr(request.user, "role", "") == UserRole.ADMIN
        )


class LoginOptionsView(APIView):
    permission_classes = [IsAuthenticated]

    def _forbidden(self):
        return Response(
            {"detail": "شما اجازه تغییر روش ورود را ندارید."},
            status=status.HTTP_403_FORBIDDEN,
        )

    def get(self, request):
        if not has_permission(request.user, "login.settings"):
            return self._forbidden()
        return Response(
            {"method": active_login_method(), "smsConfigured": is_sms_configured()}
        )

    def patch(self, request):
        if not has_permission(request.user, "login.settings"):
            return self._forbidden()
        method = (request.data.get("method") or "").strip()
        if method not in LoginMethod.values:
            return Response(
                {"detail": "روش ورود انتخاب‌شده معتبر نیست."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        set_login_method(method)
        return Response({"method": method, "smsConfigured": is_sms_configured()})


class SmsLoginRequestView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [SmsRequestRateThrottle]

    def post(self, request):
        if active_login_method() != LoginMethod.SMS:
            return Response(
                {"detail": "ورود با کد پیامکی در حال حاضر غیرفعال است."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        raw_mobile = (request.data.get("mobile") or "").strip()
        try:
            mobile = normalize_mobile(raw_mobile)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        user, _reason = find_user_by_mobile(mobile)
        if user is None:
            return Response(
                {"detail": "در صورت ثبت بودن شماره، کد تأیید برای شما پیامک می‌شود."},
                status=status.HTTP_200_OK,
            )

        cooldown = resend_cooldown_remaining(mobile)
        if cooldown > 0:
            return Response(
                {
                    "detail": f"ارسال کد به‌تازگی انجام شده است. {cooldown} ثانیه دیگر صبر کنید."
                },
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        try:
            code = issue_code(mobile)
            send_verification_code(mobile, code)
        except SmsSendError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        return Response(
            {"detail": "کد تأیید برای شماره شما پیامک شد."},
            status=status.HTTP_200_OK,
        )


class SmsLoginVerifyView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [SmsVerifyRateThrottle]

    def post(self, request):
        if active_login_method() != LoginMethod.SMS:
            return Response(
                {"detail": "ورود با کد پیامکی در حال حاضر غیرفعال است."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        raw_mobile = (request.data.get("mobile") or "").strip()
        code = (request.data.get("code") or "").strip()
        try:
            mobile = normalize_mobile(raw_mobile)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        if not code.isdigit() or len(code) != otp_length():
            return Response(
                {"detail": "کد تأیید واردشده صحیح نیست."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            user = verify_code(mobile, code)
        except OtpVerificationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        login(request, user)
        return Response(
            {"detail": "ورود با موفقیت انجام شد.", "next": _safe_next_url(request)},
            status=status.HTTP_200_OK,
        )


def change_password_for_user(request) -> Response:
    user = request.user
    if not has_permission(user, "profile.edit"):
        return Response(
            {"detail": "شما اجازه تغییر رمز عبور را ندارید."},
            status=status.HTTP_403_FORBIDDEN,
        )
    current_password = request.data.get("current_password") or request.data.get("currentPassword")
    new_password = request.data.get("new_password") or request.data.get("newPassword")

    if not current_password or not new_password:
        return Response(
            {"detail": "وارد کردن رمز عبور فعلی و رمز عبور جدید الزامی است."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not user.check_password(current_password):
        return Response(
            {"detail": "رمز عبور فعلی نامعتبر است."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if len(new_password) < 8:
        return Response(
            {"detail": "رمز عبور جدید باید حداقل ۸ کاراکتر باشد."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user.set_password(new_password)
    user.save()
    update_session_auth_hash(request, user)
    from apps.common.session_security import flush_user_sessions

    flush_user_sessions(user, keep_session_key=request.session.session_key)

    return Response({"detail": "رمز عبور با موفقیت تغییر کرد."}, status=status.HTTP_200_OK)


class ConsultantProfileViewSet(viewsets.ModelViewSet):
    serializer_class = ConsultantProfileSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        queryset = ConsultantProfile.objects.select_related("user").filter(
            user__groups__name__in=["AGENT", "RANGE_MANAGER"]
        )
        if user_is_admin(user):
            return queryset
        if getattr(user, "role", "") == UserRole.RANGE_MANAGER:
            return queryset.filter(user_id__in=team_user_ids(user) or set())
        return queryset.filter(user=user)

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["is_admin_request"] = user_is_admin(self.request.user)
        return context

    def create(self, request, *args, **kwargs):
        if not has_permission(request.user, "consultant.manage"):
            return Response(
                {"detail": "شما اجازه افزودن کارشناس را ندارید."},
                status=status.HTTP_403_FORBIDDEN,
            )
        role = (request.data.get("role") or UserRole.AGENT).strip()
        if not user_is_admin(request.user) and role != UserRole.AGENT:
            return Response(
                {"detail": "فقط مدیر می‌تواند مدیر رنج ایجاد کند."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        profile = serializer.save()
        user = self.request.user
        if getattr(user, "role", "") == UserRole.RANGE_MANAGER:
            managed_range = (
                SalesRange.objects.filter(managers=user, is_active=True)
                .order_by("pk")
                .first()
            )
            if managed_range is not None:
                managed_range.members.add(profile.user)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        is_self = instance.user_id == request.user.pk
        if is_self:
            if not has_permission(request.user, "profile.edit"):
                return Response(
                    {"detail": "شما اجازه ویرایش این پروفایل را ندارید."},
                    status=status.HTTP_403_FORBIDDEN,
                )
        elif not has_permission(request.user, "consultant.manage"):
            return Response(
                {"detail": "شما اجازه ویرایش این پروفایل را ندارید."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not is_self and not can_manage_team_member(request.user, instance.user):
            return Response(
                {"detail": "این کاربر در رنج شما نیست."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.user_id == request.user.pk:
            return Response(
                {"detail": "حذف حساب کاربری خودتان مجاز نیست."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not has_permission(request.user, "consultant.manage"):
            return Response(
                {"detail": "شما اجازه حذف کارشناس را ندارید."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not can_manage_team_member(request.user, instance.user):
            return Response(
                {"detail": "این کاربر در رنج شما نیست."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().destroy(request, *args, **kwargs)

    def perform_destroy(self, instance):
        with transaction.atomic():
            instance = ConsultantProfile.objects.select_for_update().get(pk=instance.pk)
            instance.is_active = False
            instance.save(update_fields=["is_active"])
            user = instance.user
            user.is_active = False
            user.save(update_fields=["is_active"])

            from apps.common.session_security import flush_user_sessions
            flush_user_sessions(user)

    @action(detail=False, methods=["get", "patch"], url_path="me")
    def me(self, request):
        if getattr(request.user, "role", "") == UserRole.ADMIN:
            return Response(
                {"detail": "مدیران از طریق endpoint اختصاصی خود پروفایلشان را مدیریت می‌کنند."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            profile = request.user.consultant_profile
        except AttributeError:
            profile, _ = ConsultantProfile.objects.get_or_create(
                user=request.user,
                defaults={
                    "full_name": request.user.get_full_name() or request.user.username,
                    "mobile": None,
                    "branch": "شعبه مرکزی",
                }
            )

        if request.method == "GET":
            serializer = self.get_serializer(profile)
            return Response(serializer.data)

        elif request.method == "PATCH":
            if not has_permission(request.user, "profile.edit"):
                return Response(
                    {"detail": "شما اجازه ویرایش پروفایل را ندارید."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            serializer = self.get_serializer(profile, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            return Response(serializer.data)

    @action(detail=False, methods=["post"], url_path="change-password")
    def change_password(self, request):
        return change_password_for_user(request)

    @action(detail=False, methods=["post"], url_path="me/change-password")
    def change_password_me(self, request):
        return change_password_for_user(request)


class AdminProfileViewSet(viewsets.GenericViewSet):
    serializer_class = AdminProfileSerializer
    permission_classes = [IsAuthenticated, IsAdminRole]

    def get_queryset(self):
        return AdminProfile.objects.select_related("user").filter(
            user__groups__name="GENERAL_MANAGER"
        )

    def _get_or_create_profile(self, user):
        profile = AdminProfile.objects.filter(user=user).first()
        if profile is None:
            profile = AdminProfile.objects.create(
                user=user,
                full_name=user.get_full_name() or user.username,
                branch="شعبه مرکزی",
            )
        return profile

    @action(detail=False, methods=["get", "patch"], url_path="me")
    def me(self, request):
        profile = self._get_or_create_profile(request.user)

        if request.method == "GET":
            serializer = self.get_serializer(profile)
            return Response(serializer.data)

        serializer = self.get_serializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    @action(detail=False, methods=["post"], url_path="change-password")
    def change_password(self, request):
        return change_password_for_user(request)

    @action(detail=False, methods=["post"], url_path="me/change-password")
    def change_password_me(self, request):
        return change_password_for_user(request)


class MePermissionsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(
            {
                "role": getattr(request.user, "role", ""),
                "permissions": sorted(permission_codes_for_user(request.user)),
            }
        )


class RolePermissionMatrixView(APIView):
    permission_classes = [IsAuthenticated]

    def _payload(self, user):
        from django.contrib.auth.models import Group

        roles = Role.objects.prefetch_related("permissions").order_by("sort_order", "code")
        role_rows = []
        for role in roles:
            if role.is_locked or role.code == UserRole.ADMIN:
                codes = list(PERMISSION_CODES)
            else:
                codes = sorted(set(Group.objects.filter(name=group_name_for_role(role.code)).values_list("permissions__codename", flat=True)) & set(PERMISSION_CODES))
            role_rows.append(
                {
                    "code": role.code,
                    "name": role.name,
                    "isLocked": bool(role.is_locked or role.code == UserRole.ADMIN),
                    "isCustom": role.code not in ROLE_GROUP_MAP,
                    "permissions": codes,
                }
            )
        permissions = [
            {
                "code": code,
                "label": label,
                "group": group,
                "groupOrder": group_order,
                "order": sort_order,
            }
            for code, label, group, group_order, sort_order in PERMISSION_DEFINITIONS
        ]
        return {
            "permissions": permissions,
            "roles": role_rows,
            "canEdit": user_is_admin(user),
        }

    def get(self, request):
        return Response(self._payload(request.user))

    def post(self, request):
        if not user_is_admin(request.user):
            return Response(
                {"detail": "فقط مدیر می‌تواند نقش تازه بسازد."},
                status=status.HTTP_403_FORBIDDEN,
            )
        from django.contrib.auth.models import Group

        name = (request.data.get("name") or "").strip()
        if not name or len(name) > 80:
            return Response(
                {"detail": "نام نقش باید بین ۱ تا ۸۰ نویسه باشد."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if Role.objects.filter(name=name).exists():
            return Response(
                {"detail": "نقشی با این نام قبلاً ثبت شده است."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        with transaction.atomic():
            sequence = 1
            while Role.objects.filter(code=f"CUSTOM_{sequence}").exists():
                sequence += 1
            role = Role.objects.create(
                code=f"CUSTOM_{sequence}",
                name=name,
                sort_order=(Role.objects.order_by("-sort_order").values_list("sort_order", flat=True).first() or 0) + 10,
                permissions_provisioned=True,
            )
            Group.objects.get_or_create(name=group_name_for_role(role.code))
        return Response(self._payload(request.user), status=status.HTTP_201_CREATED)

    def patch(self, request):
        if not user_is_admin(request.user):
            return Response(
                {"detail": "فقط مدیر می‌تواند دسترسی نقش‌ها را تغییر دهد."},
                status=status.HTTP_403_FORBIDDEN,
            )
        role_code = (request.data.get("role") or "").strip()
        role = Role.objects.filter(code=role_code).first()
        if role is None:
            return Response(
                {"detail": "نقش انتخاب‌شده معتبر نیست."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if role.is_locked or role.code == UserRole.ADMIN:
            return Response(
                {"detail": "دسترسی نقش مدیر قابل تغییر نیست."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        codes = request.data.get("permissions")
        if not isinstance(codes, list):
            return Response(
                {"detail": "فهرست دسترسی‌ها معتبر نیست."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        normalized = {str(code).strip() for code in codes if str(code).strip()}
        unknown = normalized - set(PERMISSION_CODES)
        if unknown:
            return Response(
                {"detail": "برخی از دسترسی‌های انتخاب‌شده معتبر نیستند."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        role.permissions.set(RolePermission.objects.filter(code__in=normalized))
        return Response(self._payload(request.user))


class SalesRangeViewSet(viewsets.ModelViewSet):
    serializer_class = SalesRangeSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        queryset = SalesRange.objects.prefetch_related("managers", "members").all()
        user = self.request.user
        if user_is_admin(user):
            return queryset
        if getattr(user, "role", "") == UserRole.RANGE_MANAGER:
            return queryset.filter(managers=user)
        return queryset.filter(members=user)

    def _forbidden(self):
        return Response(
            {"detail": "فقط مدیر می‌تواند رنج‌ها را تغییر دهد."},
            status=status.HTTP_403_FORBIDDEN,
        )

    def _sync_membership_history(self, sales_range, old_managers, old_members):
        now = timezone.now()
        new_managers = set(sales_range.managers.values_list("pk", flat=True))
        new_members = set(sales_range.members.values_list("pk", flat=True))
        changes = (
            (ScopeMembership.MembershipRole.MANAGER, old_managers, new_managers),
            (ScopeMembership.MembershipRole.MEMBER, old_members, new_members),
        )
        for role, old_ids, new_ids in changes:
            removed = old_ids - new_ids
            added = new_ids - old_ids
            if removed:
                ScopeMembership.objects.filter(
                    sales_range=sales_range,
                    membership_role=role,
                    user_id__in=removed,
                    ended_at__isnull=True,
                ).update(ended_at=now)
            for user_id in added:
                ScopeMembership.objects.get_or_create(
                    sales_range=sales_range,
                    user_id=user_id,
                    membership_role=role,
                    ended_at=None,
                    defaults={"started_at": now},
                )

    def create(self, request, *args, **kwargs):
        if not user_is_admin(request.user):
            return self._forbidden()
        return super().create(request, *args, **kwargs)

    @transaction.atomic
    def perform_create(self, serializer):
        sales_range = serializer.save()
        self._sync_membership_history(sales_range, set(), set())

    def update(self, request, *args, **kwargs):
        if not user_is_admin(request.user):
            return self._forbidden()
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        if not user_is_admin(request.user):
            return self._forbidden()
        return super().partial_update(request, *args, **kwargs)

    @transaction.atomic
    def perform_update(self, serializer):
        instance = serializer.instance
        old_managers = set(instance.managers.values_list("pk", flat=True))
        old_members = set(instance.members.values_list("pk", flat=True))
        sales_range = serializer.save()
        self._sync_membership_history(sales_range, old_managers, old_members)

    def destroy(self, request, *args, **kwargs):
        if not user_is_admin(request.user):
            return self._forbidden()
        return super().destroy(request, *args, **kwargs)


class RangeUserOptionsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not user_is_admin(request.user):
            return Response(
                {"detail": "فقط مدیر به فهرست کاربران دسترسی دارد."},
                status=status.HTTP_403_FORBIDDEN,
            )
        from django.contrib.auth import get_user_model

        User = get_user_model()
        managers = User.objects.filter(
            groups__name="RANGE_MANAGER", is_active=True
        ).order_by("first_name", "last_name", "username")
        members = User.objects.filter(
            groups__name="AGENT", is_active=True
        ).order_by("first_name", "last_name", "username")
        return Response(
            {
                "managers": RangeUserSerializer(managers, many=True).data,
                "members": RangeUserSerializer(members, many=True).data,
            }
        )
