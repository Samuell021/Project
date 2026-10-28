from django.urls import path, include
from django.contrib.auth import views as auth_views
from rest_framework.routers import DefaultRouter

from .views import (
    AdminProfileViewSet,
    ConsultantProfileViewSet,
    CustomLoginView,
    LoginOptionsView,
    MePermissionsView,
    RangeUserOptionsView,
    RolePermissionMatrixView,
    SalesRangeViewSet,
    SmsLoginRequestView,
    SmsLoginVerifyView,
)

app_name = "accounts"

router = DefaultRouter()
router.register(r"consultants", ConsultantProfileViewSet, basename="consultant")
router.register(r"admins", AdminProfileViewSet, basename="admin-profile")
router.register(r"ranges", SalesRangeViewSet, basename="sales-range")

urlpatterns = [
    path("login/", CustomLoginView.as_view(), name="login"),
    path("logout/", auth_views.LogoutView.as_view(), name="logout"),
    path("login-options/", LoginOptionsView.as_view(), name="login-options"),
    path(
        "me/permissions/",
        MePermissionsView.as_view(),
        name="me-permissions",
    ),
    path(
        "role-permissions/",
        RolePermissionMatrixView.as_view(),
        name="role-permissions",
    ),
    path(
        "range-users/",
        RangeUserOptionsView.as_view(),
        name="range-users",
    ),
    path("sms-login/request/", SmsLoginRequestView.as_view(), name="sms-login-request"),
    path("sms-login/verify/", SmsLoginVerifyView.as_view(), name="sms-login-verify"),
    path("", include(router.urls)),
]
