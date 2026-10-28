from uuid import uuid4

from rest_framework import status, permissions
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import has_permission

from .throttles import PasswordResetRateThrottle, ResilientScopedRateThrottle

from .models import CompanySettings
from .serializers import CompanySettingsSerializer


class DistrictListView(APIView):
    def get(self, request):
        from apps.basics.models import District as HierarchyDistrict

        names = list(
            HierarchyDistrict.objects.filter(is_active=True)
            .order_by("city__province__sort_order", "city__sort_order", "sort_order")
            .values_list("display_name", flat=True)
        )
        return Response(list(dict.fromkeys(names)))


class DistrictManageView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not has_permission(request.user, "basics.manage"):
            return Response({"detail": "شما اجازه مدیریت مناطق را ندارید."}, status=status.HTTP_403_FORBIDDEN)
        
        from .serializers import DistrictSerializer
        districts = CompanySettings.DistrictModel.objects.all().order_by("name")
        return Response(DistrictSerializer(districts, many=True).data)

    def post(self, request):
        if not has_permission(request.user, "basics.manage"):
            return Response({"detail": "شما اجازه مدیریت مناطق را ندارید."}, status=status.HTTP_403_FORBIDDEN)
        
        from .serializers import DistrictSerializer
        raw_name = request.data.get("name", "")
        name = raw_name.strip() if isinstance(raw_name, str) else ""
        if not name or len(name) > 255:
            return Response({"detail": "نام محله الزامی است."}, status=status.HTTP_400_BAD_REQUEST)
        
        if CompanySettings.DistrictModel.objects.filter(display_name=name).exists():
            return Response({"detail": "این محله قبلاً ثبت شده است."}, status=status.HTTP_400_BAD_REQUEST)
        
        district = CompanySettings.DistrictModel.objects.create(name=f"district-{uuid4().hex}", display_name=name)
        return Response(DistrictSerializer(district).data, status=status.HTTP_201_CREATED)

    def delete(self, request, pk=None):
        if not has_permission(request.user, "basics.manage"):
            return Response({"detail": "شما اجازه مدیریت مناطق را ندارید."}, status=status.HTTP_403_FORBIDDEN)
        
        try:
            district = CompanySettings.DistrictModel.objects.get(pk=pk)
            district.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        except CompanySettings.DistrictModel.DoesNotExist:
            return Response({"detail": "محله یافت نشد."}, status=status.HTTP_404_NOT_FOUND)

    def patch(self, request, pk=None):
        if not has_permission(request.user, "basics.manage"):
            return Response({"detail": "شما اجازه مدیریت مناطق را ندارید."}, status=status.HTTP_403_FORBIDDEN)
        
        from .serializers import DistrictSerializer
        try:
            district = CompanySettings.DistrictModel.objects.get(pk=pk)
            serializer = DistrictSerializer(district, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            return Response(serializer.data)
        except CompanySettings.DistrictModel.DoesNotExist:
            return Response({"detail": "محله یافت نشد."}, status=status.HTTP_404_NOT_FOUND)


class CompanySettingsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        obj = CompanySettings.get_solo()
        return Response(CompanySettingsSerializer(obj).data)

    def _update(self, request):
        if not has_permission(request.user, "company.edit"):
            return Response(
                {"detail": "شما اجازه ویرایش اطلاعات شرکت را ندارید."},
                status=status.HTTP_403_FORBIDDEN,
            )
        obj = CompanySettings.get_solo()
        serializer = CompanySettingsSerializer(obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def patch(self, request):
        return self._update(request)

    def put(self, request):
        return self._update(request)

    
class PasswordResetRequestView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [PasswordResetRateThrottle]

    def post(self, request):
        from django.contrib.auth import get_user_model
        from apps.notifications.models import Notification
        
        User = get_user_model()
        username = request.data.get("username", "").strip()
        
        if not username:
            return Response({"error": "نام کاربری الزامی است"}, status=400)
        
        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist:
            return Response({"success": True, "message": "درخواست شما ثبت شد"})
        
        admins = User.objects.filter(groups__name="GENERAL_MANAGER")
        for admin in admins:
            Notification.objects.create(
                user=admin,
                type=Notification.NotificationType.PASSWORD_RESET_REQUEST,
                title="درخواست تغییر رمز عبور",
                message=f"کاربر {user.get_full_name() or user.username} درخواست تغییر رمز عبور خود را ارسال کرده است.",
                metadata={"requester_id": user.id, "requester_username": user.username}
            )
        
        return Response({"success": True, "message": "درخواست شما ثبت شد"})


class LoginStatsView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        from apps.accounts.models import ConsultantProfile, UserRole
        from apps.listings.models import PropertyFile
        from apps.properties.models import Property

        return Response({
            "totalProperties": Property.active_objects.count(),
            "activeConsultants": ConsultantProfile.objects.filter(
                is_active=True,
                user__groups__name__in=["AGENT", "RANGE_MANAGER"],
            ).count(),
            "soldProperties": Property.objects.filter(
                status=Property.Status.SOLD
            ).count(),
            "activePropertyFiles": PropertyFile.objects.filter(
                status=PropertyFile.Status.ACTIVE
            ).count(),
        })


class AdminPasswordChangeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, user_id=None):
        from django.contrib.auth import get_user_model
        from apps.notifications.models import Notification
        
        User = get_user_model()
        
        if not has_permission(request.user, "consultant.manage"):
            return Response(
                {"error": "شما اجازه تغییر رمز عبور کاربران را ندارید"},
                status=403,
            )
        
        new_password = request.data.get("new_password", "")
        confirm_password = request.data.get("confirm_password", "")
        
        if not new_password or not confirm_password:
            return Response({"error": "رمز عبور و تکرار آن الزامی است"}, status=400)
        
        if new_password != confirm_password:
            return Response({"error": "رمز عبور و تکرار آن مطابقت ندارند"}, status=400)
        
        if len(new_password) < 8:
            return Response({"error": "رمز عبور باید حداقل ۸ کاراکتر باشد"}, status=400)
        
        try:
            target_user = User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return Response({"error": "کاربر یافت نشد"}, status=404)

        from apps.accounts.scoping import user_in_scope, user_is_admin

        if not user_is_admin(request.user) and not user_in_scope(
            request.user, target_user.pk
        ):
            return Response(
                {"error": "این کاربر در رنج شما نیست"},
                status=403,
            )

        target_user.set_password(new_password)
        target_user.save()
        
        admins = User.objects.filter(groups__name="GENERAL_MANAGER")
        admin_name = request.user.get_full_name() or request.user.username
        target_name = target_user.get_full_name() or target_user.username
        
        for admin in admins:
            Notification.objects.create(
                user=admin,
                type=Notification.NotificationType.PASSWORD_CHANGED,
                title="تغییر رمز عبور",
                message=f"{admin_name} رمز عبور کاربر {target_name} را تغییر داد.",
                metadata={"changed_user_id": target_user.id, "changed_by_id": request.user.id}
            )
        
        Notification.objects.create(
            user=target_user,
            type=Notification.NotificationType.PASSWORD_CHANGED,
            title="تغییر رمز عبور",
            message=f"مدیر {admin_name} رمز عبور شما را تغییر داد. لطفاً با رمز جدید وارد شوید.",
            metadata={"changed_by_id": request.user.id}
        )
        
        return Response({"success": True, "message": "رمز عبور با موفقیت تغییر کرد"})


class GeocodeView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ResilientScopedRateThrottle]
    throttle_scope = "geocode"

    def get(self, request):
        from django.conf import settings

        from .geocode import GeocodeUnavailable, clean_viewbox, geocode

        query = (request.query_params.get("q") or "").strip()
        max_length = int(getattr(settings, "GEOCODE_MAX_QUERY_LENGTH", 200))
        if not query:
            return Response(
                {"detail": "عبارت جستجوی مکان نمی‌تواند خالی باشد."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(query) > max_length:
            return Response(
                {"detail": f"عبارت جستجو نباید بیشتر از {max_length} نویسه باشد."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        viewbox = clean_viewbox(request.query_params.get("viewbox"))
        if request.query_params.get("viewbox") and viewbox is None:
            return Response(
                {"detail": "محدودهٔ جغرافیایی معتبر نیست."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        bounded = request.query_params.get("bounded") in {"1", "true", "yes"}

        try:
            results = geocode(query, viewbox, bounded)
        except GeocodeUnavailable:
            return Response(
                {"detail": "سرویس جستجوی مکان در دسترس نیست؛ کمی دیگر دوباره تلاش کنید."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        return Response(results)
