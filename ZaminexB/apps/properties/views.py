from decimal import Decimal
import re

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.shortcuts import render, redirect
from django.contrib.auth.decorators import login_required
from django.shortcuts import get_object_or_404
from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Prefetch, Q
from django.http import FileResponse, Http404
from django.middleware.csrf import get_token
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie

from apps.accounts.permissions import has_permission, permission_required, require_permission
from apps.accounts.presentation import build_initial_data
from apps.accounts.scoping import team_user_ids, user_in_scope, user_is_admin
from apps.basics.models import Attribute
from apps.common.attribute_filters import apply_attribute_filters
from apps.common.fuzzy_search import apply_fuzzy_search
from apps.analytics.metrics import annotate_effective_prices, effective_sale_price as _sale_price

from .permissions import consultant_required
from .models import (
    Property,
    PropertyAppraisalReport,
    PropertyAttributeValue,
    PropertyImage,
    _generate_next_internal_code,
)

from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.common.access import can_access_property, can_manage_property
from apps.common.attribute_values import attribute_payload_changed
from apps.common.cache_invalidation import invalidate_property_caches
from apps.notifications.models import Notification
from apps.notifications.services import (
    actor_display_name,
    notify_admins_pending_review,
    notify_users,
)
from .validators import MAX_PROPERTY_IMAGES, validate_appraisal_pdf, validate_property_image

from .serializers import (
    PropertyAppraisalReportSerializer,
    PropertyImageSerializer,
    PropertyListSerializer,
    PropertySerializer,
)
from apps.common.pagination import StandardResultsSetPagination


def _property_draft_is_complete(instance, updates):
    def value(name):
        return updates.get(name, getattr(instance, name))

    area = value("area")
    try:
        has_area = area is not None and int(area) > 0
    except (TypeError, ValueError):
        has_area = False

    district = value("district")
    phone = str(value("owner_phone") or "").strip()
    return bool(
        str(value("title") or "").strip()
        and value("property_type_ref") is not None
        and has_area
        and district is not None
        and str(value("address") or "").strip()
        and str(value("owner_first_name") or "").strip()
        and str(value("owner_last_name") or "").strip()
        and re.fullmatch(r"09\d{9}", phone)
    )


def _property_payload_changed(instance, serializer) -> bool:
    for field, value in serializer.validated_data.items():
        if field == "status":
            continue
        if getattr(instance, field, None) != value:
            return True

    request = serializer.context.get("request")
    payload = request.data.get("attributes") if request is not None else None
    return attribute_payload_changed(
        instance, payload, PropertyAttributeValue, "property"
    )


def _property_review_metadata(property_obj) -> dict:
    return {
        "propertyId": property_obj.pk,
        "internalCode": property_obj.internal_code,
        "title": property_obj.title,
    }


def _notify_property_pending_review(property_obj, actor) -> None:
    notify_admins_pending_review(
        notification_type=Notification.NotificationType.PROPERTY_PENDING_REVIEW,
        title="ملک جدید در انتظار تأیید",
        message=(
            f"ملک «{property_obj.title}» (کد {property_obj.internal_code}) توسط "
            f"{actor_display_name(actor)} برای بررسی به مدیران ارسال شد."
        ),
        metadata=_property_review_metadata(property_obj),
        actor=actor,
        permission_code="property.review",
    )


def _notify_property_decision(property_obj, approved: bool) -> None:
    consultant = property_obj.consultant
    if consultant is None:
        return

    metadata = _property_review_metadata(property_obj)
    if approved:
        notify_users(
            [consultant],
            notification_type=Notification.NotificationType.PROPERTY_APPROVED,
            title="تأیید ملک",
            message=(
                f"ملک «{property_obj.title}» (کد {property_obj.internal_code}) "
                "توسط مدیر تأیید و منتشر شد."
            ),
            metadata=metadata,
        )
    else:
        notify_users(
            [consultant],
            notification_type=Notification.NotificationType.PROPERTY_REJECTED,
            title="بازگرداندن ملک برای اصلاح",
            message=(
                f"ملک «{property_obj.title}» (کد {property_obj.internal_code}) "
                f"برای اصلاح بازگردانده شد: {property_obj.rejection_reason}"
            ),
            metadata=metadata,
        )



class PropertyViewSet(viewsets.ModelViewSet):
    serializer_class = PropertySerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == "list":
            return PropertyListSerializer
        return PropertySerializer

    def get_queryset(self):
        user = self.request.user

        from apps.crm.models import PropertyParty

        qs = Property.objects.prefetch_related(Prefetch("contact_links", queryset=PropertyParty.objects.select_related("contact").prefetch_related("contact__phones"))).select_related(
            "consultant",
            "property_type_ref",
            "property_usage",
            "district",
            "district__city",
            "district__city__province",
            "registration_case",
        )
        if self.action == "list":
            qs = qs.prefetch_related("consultant__groups", "images", "property_files__deal_type")
        else:
            qs = qs.select_related(
                "appraisal_report",
                "appraisal_report__uploaded_by",
            ).prefetch_related(
                "consultant__groups",
                "images",
                "followups",
                "tasks",
                "property_files__deal_type",
                "attribute_values__attribute",
            )

        if not user_is_admin(user):
            qs = qs.filter(consultant_id__in=team_user_ids(user) or set())

        responsibility = (self.request.query_params.get("responsibility") or "").strip().lower()
        if responsibility == "mine":
            qs = qs.filter(consultant_id=user.pk)
        elif responsibility == "range" and user_is_admin(user):
            range_id = self.request.query_params.get("sales_range") or self.request.query_params.get("scope")
            if range_id and str(range_id).isdigit():
                from apps.accounts.models import SalesRange

                sr = SalesRange.objects.filter(pk=int(range_id)).first()
                if sr is not None:
                    member_ids = set(sr.members.values_list("pk", flat=True)) | set(sr.managers.values_list("pk", flat=True))
                    qs = qs.filter(consultant_id__in=member_ids)

        search_query = self.request.query_params.get("q")
        fuzzy_search_active = bool(search_query and search_query.strip())
        if search_query:
            qs = apply_fuzzy_search(
                qs,
                search_query,
                [
                    "title",
                    "internal_code",
                    "address",
                    "neighborhood",
                    "description",
                    "district__display_name",
                    "district__name",
                    "district__city__display_name",
                    "district__city__province__display_name",
                    "consultant__consultant_profile__full_name",
                    "consultant__username",
                    "consultant__first_name",
                    "consultant__last_name",
                ],
            )

        property_type = self.request.query_params.get("type")
        if property_type:
            qs = qs.filter(property_type__iexact=property_type)

        transaction_type = self.request.query_params.get("transactionType")
        if transaction_type:
            if transaction_type.lower() == "sale":
                qs = qs.filter(property_files__deal_type__family__in=["SALE", "PRE_SALE", "PARTNERSHIP", "EXCHANGE"]).distinct()
            elif transaction_type.lower() == "rent":
                qs = qs.filter(property_files__deal_type__family__in=["RENT", "FULL_MORTGAGE"]).distinct()

        city = self.request.query_params.get("city")
        if city:
            if str(city).isdigit():
                qs = qs.filter(district__city_id=city)
            else:
                qs = qs.filter(
                    Q(district__city__display_name__iexact=city)
                    | Q(district__city__name__iexact=city)
                )

        district = self.request.query_params.get("district")
        if district:
            if str(district).isdigit():
                qs = qs.filter(district_id=district)
            else:
                qs = qs.filter(
                    Q(neighborhood__iexact=district)
                    | Q(district__display_name__iexact=district)
                    | Q(district__name__iexact=district)
                )

        property_status = self.request.query_params.get("propertyStatus")
        if property_status:
            qs = qs.filter(status__iexact=property_status.upper())

        price_min = self.request.query_params.get("priceMin")
        price_max = self.request.query_params.get("priceMax")
        if price_min or price_max:
            qs = self._filter_by_price(qs, price_min, price_max)

        consultant_id = self.request.query_params.get("consultantId")
        if consultant_id and user_is_admin(user):
            qs = qs.filter(consultant_id=consultant_id)

        qs = apply_attribute_filters(
            qs,
            self.request.query_params,
            entity=Attribute.Entity.PROPERTY,
            values_relation="attribute_values",
        )

        property_type_ref = self.request.query_params.get("propertyTypeRef")
        if property_type_ref:
            if str(property_type_ref).isdigit():
                qs = qs.filter(property_type_ref_id=property_type_ref)
            else:
                qs = qs.filter(property_type_ref__name=property_type_ref)

        if fuzzy_search_active:
            return qs
        return qs.order_by("-created_at")

    @staticmethod
    def _filter_by_price(queryset, price_min, price_max):
        prices = annotate_effective_prices(list(queryset.values_list("id", flat=True)))

        keep = []
        for row in queryset.values("id", "price"):
            price = prices.get(row["id"])
            if price is None:
                continue
            if price_min and price < Decimal(str(price_min)):
                continue
            if price_max and price > Decimal(str(price_max)):
                continue
            keep.append(row["id"])

        return queryset.filter(id__in=keep)

    def perform_create(self, serializer):
        user = self.request.user
        require_permission(user, "property.create", "شما اجازه ساخت ملک را ندارید.")
        is_admin = user_is_admin(user)

        if is_admin:
            consultant = serializer.validated_data.get("consultant")
            if consultant is None:
                raise ValidationError({"consultant": "انتخاب کارشناس مسئول الزامی است."})
        elif has_permission(user, "property.assign"):
            consultant = serializer.validated_data.get("consultant") or user
            if not user_in_scope(user, consultant.pk):
                raise ValidationError({"consultant": "این کارشناس در رنج شما نیست."})
        else:
            consultant = user

        initial_status = (
            serializer.validated_data.get("status", Property.Status.AVAILABLE)
            if is_admin
            else Property.Status.DRAFT
        )
        review_requested_at = (
            timezone.now() if initial_status == Property.Status.DRAFT else None
        )
        property_obj = serializer.save(
            consultant=consultant,
            is_shared=False,
            status=initial_status,
            rejection_reason="",
            review_requested_at=review_requested_at,
        )
        if not is_admin and property_obj.status == Property.Status.DRAFT:
            _notify_property_pending_review(property_obj, user)

    @transaction.atomic
    def perform_update(self, serializer):
        user = self.request.user
        is_admin = user_is_admin(user)
        instance = Property.objects.select_for_update().get(pk=serializer.instance.pk)
        serializer.instance = instance
        require_permission(user, "property.edit", "شما اجازه ویرایش ملک را ندارید.")
        if not can_manage_property(user, instance):
            raise PermissionDenied("شما اجازه ویرایش این ملک را ندارید.")
        if instance.review_status == Property.ReviewStatus.PENDING:
            raise ValidationError({"review_status": "ملک در صف بررسی مدیر است و تا ثبت تصمیم، اطلاعات آن قفل است."})

        if is_admin:
            consultant = serializer.validated_data.get("consultant", instance.consultant)
            if consultant is None:
                raise ValidationError({"consultant": "انتخاب کارشناس مسئول الزامی است."})
            serializer.save(consultant=consultant, is_shared=False)
            return

        new_status = serializer.validated_data.get("status")
        if new_status is not None and new_status != instance.status:
            if instance.status == Property.Status.DRAFT:
                raise ValidationError(
                    {"status": "ملک پیش‌نویس تا تأیید مدیر قابل تغییر وضعیت نیست."}
                )
            if new_status == Property.Status.DRAFT:
                raise ValidationError(
                    {
                        "status": (
                            "بازگرداندن ملک برای اصلاح فقط از مسیر بازبینی مدیر "
                            "انجام می‌شود."
                        )
                    }
                )

        payload_changed = _property_payload_changed(instance, serializer)
        consultant = serializer.validated_data.get("consultant", instance.consultant)
        if consultant is not None and has_permission(user, "property.assign"):
            if not user_in_scope(user, consultant.pk):
                raise ValidationError({"consultant": "این کارشناس در رنج شما نیست."})
        else:
            consultant = instance.consultant
        save_options = {"consultant": consultant, "is_shared": False}
        resubmitted = False

        if instance.status == Property.Status.DRAFT:
            save_options["status"] = Property.Status.DRAFT
            if payload_changed:
                if instance.rejection_reason:
                    save_options["rejection_reason"] = ""
                if instance.review_requested_at is None:
                    save_options["review_requested_at"] = timezone.now()
                    resubmitted = True
        elif payload_changed:
            save_options["status"] = Property.Status.DRAFT
            save_options["rejection_reason"] = ""
            save_options["review_requested_at"] = timezone.now()
            resubmitted = True

        property_obj = serializer.save(**save_options)
        if resubmitted:
            _notify_property_pending_review(property_obj, user)

    @action(detail=True, methods=["post"], url_path="approve")
    @transaction.atomic
    def approve(self, request, pk=None):
        if not has_permission(request.user, "property.review"):
            return Response(
                {"detail": "شما اجازه تأیید ملک را ندارید."},
                status=status.HTTP_403_FORBIDDEN,
            )

        property_obj = self.get_object()
        property_obj = Property.objects.select_for_update().get(pk=property_obj.pk)
        if property_obj.status != Property.Status.DRAFT:
            raise ValidationError({"detail": "فقط ملک پیش‌نویس قابل تأیید است."})
        if not _property_draft_is_complete(property_obj, {}):
            raise ValidationError(
                {"detail": "پیش از تأیید، اطلاعات الزامی ملک و مشخصات مالک باید کامل شود."}
            )

        serializer = PropertySerializer(
            property_obj,
            data={"status": Property.Status.AVAILABLE},
            partial=True,
            context=self.get_serializer_context(),
        )
        serializer.is_valid(raise_exception=True)
        property_obj = serializer.save(rejection_reason="", review_requested_at=None, review_status=Property.ReviewStatus.APPROVED)
        invalidate_property_caches(property_obj)
        _notify_property_decision(property_obj, approved=True)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="reject")
    @transaction.atomic
    def reject(self, request, pk=None):
        if not has_permission(request.user, "property.review"):
            return Response(
                {"detail": "شما اجازه بازگرداندن ملک را ندارید."},
                status=status.HTTP_403_FORBIDDEN,
            )

        property_obj = self.get_object()
        property_obj = Property.objects.select_for_update().get(pk=property_obj.pk)
        if property_obj.status != Property.Status.DRAFT:
            raise ValidationError({"detail": "فقط ملک پیش‌نویس قابل بازگرداندن است."})
        reason = str(request.data.get("reason") or "").strip()
        if not reason:
            raise ValidationError({"reason": "ذکر دلیل بازگرداندن ملک الزامی است."})
        if len(reason) > 1000:
            raise ValidationError({"reason": "دلیل بازگرداندن نمی‌تواند بیش از ۱۰۰۰ نویسه باشد."})

        property_obj.rejection_reason = reason
        property_obj.review_requested_at = None
        property_obj.review_status = Property.ReviewStatus.CHANGES_REQUIRED
        property_obj.save(
            update_fields=["rejection_reason", "review_requested_at", "review_status", "updated_at"]
        )
        _notify_property_decision(property_obj, approved=False)
        return Response(PropertySerializer(property_obj, context=self.get_serializer_context()).data)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if not has_permission(request.user, "property.delete"):
            return Response(
                {"detail": "شما اجازه حذف ملک را ندارید."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not can_manage_property(request.user, instance):
            return Response(
                {"detail": "شما اجازه حذف این ملک را ندارید."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=["post"], url_path="draft")
    def create_draft(self, request):
        if not has_permission(request.user, "property.create") or not has_permission(
            request.user, "property.assign"
        ):
            return Response(
                {"detail": "شما اجازه ایجاد و واگذاری پیش‌نویس ملک را ندارید."},
                status=status.HTTP_403_FORBIDDEN,
            )
        title = request.data.get("title")
        if not isinstance(title, str) or not title.strip():
            raise ValidationError({"title": "عنوان ملک الزامی است."})

        serializer = PropertySerializer(
            data=request.data,
            partial=True,
            context={**self.get_serializer_context(), "allow_draft": True},
        )
        serializer.is_valid(raise_exception=True)
        consultant = serializer.validated_data.get("consultant")
        if consultant is None:
            raise ValidationError({"consultant": "انتخاب کارشناس مسئول الزامی است."})
        if not user_is_admin(request.user) and not user_in_scope(
            request.user, consultant.pk
        ):
            raise ValidationError({"consultant": "این کارشناس در رنج شما نیست."})

        property_obj = serializer.save(
            consultant=consultant,
            status=Property.Status.DRAFT,
            property_type=serializer.validated_data.get(
                "property_type", Property.PropertyType.OTHER
            ),
            deal_type=serializer.validated_data.get(
                "deal_type", Property.DealType.SALE
            ),
            area=serializer.validated_data.get("area", 0),
            address=serializer.validated_data.get("address", ""),
            is_shared=False,
        )
        output = PropertySerializer(
            property_obj, context=self.get_serializer_context()
        )
        return Response(output.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"], url_path="next-internal-code")
    def next_internal_code(self, request):
        return Response({"internalCode": _generate_next_internal_code()})

    @action(detail=False, methods=["get"], url_path="options")
    def options(self, request):
        rows = list(
            self.get_queryset()
            .prefetch_related(None)
            .values(
                "id",
                "title",
                "internal_code",
                "neighborhood",
                "status",
                "area",
                "latitude",
                "longitude",
                "consultant_id",
                "consultant__first_name",
                "consultant__last_name",
                "consultant__username",
            )
        )

        prices = annotate_effective_prices([row["id"] for row in rows])

        options = []
        for row in rows:
            price = prices.get(row["id"])
            full_name = " ".join(
                part
                for part in (
                    row["consultant__first_name"],
                    row["consultant__last_name"],
                )
                if part
            ).strip()
            options.append(
                {
                    "id": row["id"],
                    "title": row["title"],
                    "internalCode": row["internal_code"],
                    "district": row["neighborhood"],
                    "price": str(price) if price is not None else None,
                    "propertyStatus": (row["status"] or "").lower(),
                    "area": row["area"],
                    "latitude": row["latitude"],
                    "longitude": row["longitude"],
                    "isShared": False,
                    "consultantId": row["consultant_id"],
                    "consultantName": (
                        (full_name or row["consultant__username"] or "نامشخص")
                        if row["consultant_id"]
                        else "نامشخص"
                    ),
                }
            )
        return Response(options)

    @action(detail=True, methods=["post"], url_path="toggle-shared")
    def toggle_shared(self, request, pk=None):
        return Response(
            {"detail": "اشتراک‌گذاری ملک بین کارشناسان غیرفعال است."},
            status=status.HTTP_410_GONE,
        )

    @action(detail=True, methods=["post"], url_path="images")
    def upload_images(self, request, pk=None):
        # Reuse the CRM command receipt so a retry after a lost response cannot
        # attach the same image twice. Import locally to keep app imports acyclic.
        from apps.crm.views import execute_idempotently

        return execute_idempotently(
            request,
            "properties.images.upload",
            lambda: self._upload_images_once(request, pk),
        )

    def _upload_images_once(self, request, pk=None):
        property_obj = self.get_object()
        if not has_permission(request.user, "property.edit"):
            return Response(
                {"detail": "شما اجازه ویرایش ملک را ندارید."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not can_manage_property(request.user, property_obj):
            return Response(
                {"detail": "فقط مالک ملک یا مدیر می‌تواند تصویر اضافه کند."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if property_obj.review_status == Property.ReviewStatus.PENDING:
            return Response({"detail": "تصاویر ملک در زمان بررسی مدیر قفل هستند."}, status=status.HTTP_409_CONFLICT)
        files = request.FILES.getlist("images")
        if not files:
            return Response(
                {"detail": "هیچ فایلی ارسال نشده است."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(files) > 10:
            return Response(
                {"detail": "حداکثر ۱۰ تصویر در هر درخواست مجاز است."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if property_obj.images.count() + len(files) > MAX_PROPERTY_IMAGES:
            return Response(
                {"detail": f"حداکثر {MAX_PROPERTY_IMAGES} تصویر برای هر ملک مجاز است."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        for uploaded_file in files:
            try:
                validate_property_image(uploaded_file)
            except Exception as exc:
                detail = "; ".join(exc.messages) if hasattr(exc, "messages") else str(exc)
                return Response({"detail": detail}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            property_obj = Property.objects.select_for_update().get(pk=property_obj.pk)
            if property_obj.review_status == Property.ReviewStatus.PENDING:
                return Response({"detail": "تصاویر ملک در زمان بررسی مدیر قفل هستند."}, status=status.HTTP_409_CONFLICT)
            if property_obj.images.count() + len(files) > MAX_PROPERTY_IMAGES:
                return Response(
                    {"detail": f"حداکثر {MAX_PROPERTY_IMAGES} تصویر برای هر ملک مجاز است."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            created = [
                PropertyImage.objects.create(property=property_obj, image=uploaded_file)
                for uploaded_file in files
            ]

        created_images = PropertyImageSerializer(
            created, many=True, context={"request": request}
        ).data
        invalidate_property_caches(property_obj)
        return Response(created_images, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["delete"], url_path=r"images/(?P<image_id>\d+)")
    def delete_image(self, request, pk=None, image_id=None):
        property_obj = self.get_object()
        if not has_permission(request.user, "property.edit"):
            return Response(
                {"detail": "شما اجازه ویرایش ملک را ندارید."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not can_manage_property(request.user, property_obj):
            return Response(
                {"detail": "فقط مالک ملک یا مدیر می‌تواند تصویر را حذف کند."},
                status=status.HTTP_403_FORBIDDEN,
            )
        with transaction.atomic():
            property_obj = Property.objects.select_for_update().get(pk=property_obj.pk)
            if property_obj.review_status == Property.ReviewStatus.PENDING:
                return Response({"detail": "تصاویر ملک در زمان بررسی مدیر قفل هستند."}, status=status.HTTP_409_CONFLICT)
            try:
                image = PropertyImage.objects.select_for_update().get(pk=image_id, property=property_obj)
            except PropertyImage.DoesNotExist:
                return Response(
                    {"detail": "تصویر مورد نظر یافت نشد."},
                    status=404,
                )
            image.image.delete(save=False)
            image.delete()
        invalidate_property_caches(property_obj)
        return Response(status=204)

    @action(detail=True, methods=["patch"], url_path="images-reorder")
    def reorder_images(self, request, pk=None):
        property_obj = self.get_object()
        if not has_permission(request.user, "property.edit"):
            return Response(
                {"detail": "شما اجازه ویرایش ملک را ندارید."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not can_manage_property(request.user, property_obj):
            return Response(
                {"detail": "فقط مالک ملک یا مدیر می‌تواند ترتیب تصاویر را تغییر دهد."},
                status=status.HTTP_403_FORBIDDEN,
            )
        order_data = request.data if isinstance(request.data, list) else request.data.get("order", [])
        if not isinstance(order_data, list):
            return Response(
                {"detail": "فرمت ورودی نامعتبر است. لیستی از {id, sort_order} انتظار می‌رود."},
                status=400,
            )
        changed = 0
        with transaction.atomic():
            property_obj = Property.objects.select_for_update().get(pk=property_obj.pk)
            if property_obj.review_status == Property.ReviewStatus.PENDING:
                return Response({"detail": "ترتیب تصاویر ملک در زمان بررسی مدیر قفل است."}, status=status.HTTP_409_CONFLICT)
            for item in order_data:
                if not isinstance(item, dict):
                    continue
                img_id = item.get("id")
                sort_order = item.get("sort_order")
                if img_id is None or sort_order is None:
                    continue
                changed += PropertyImage.objects.filter(
                    pk=img_id, property=property_obj
                ).update(sort_order=sort_order)

        if changed:
            invalidate_property_caches(property_obj)
        images = PropertyImage.objects.filter(
            property=property_obj
        ).order_by("sort_order", "id")
        return Response(
            PropertyImageSerializer(images, many=True, context={"request": request}).data
        )

    @action(detail=True, methods=["post", "delete"], url_path="appraisal-report")
    def appraisal_report(self, request, pk=None):
        if request.method == "POST":
            return self._upload_appraisal_report(request, pk)
        return self._delete_appraisal_report(request, pk)

    def _upload_appraisal_report(self, request, pk):
        property_obj = self.get_object()
        if not has_permission(request.user, "property.appraisal"):
            return Response(
                {"detail": "شما اجازه بارگذاری گزارش کارشناسی را ندارید."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not can_manage_property(request.user, property_obj):
            return Response(
                {"detail": "فقط مالک ملک یا مدیر می‌تواند گزارش کارشناسی را بارگذاری کند."},
                status=status.HTTP_403_FORBIDDEN,
            )
        f = request.FILES.get("file")
        if f is None:
            return Response(
                {"detail": "هیچ فایلی ارسال نشده است."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            validate_appraisal_pdf(f)
        except Exception as exc:
            detail = "; ".join(exc.messages) if hasattr(exc, "messages") else str(exc)
            return Response({"detail": detail}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            existing = PropertyAppraisalReport.objects.filter(
                property=property_obj
            ).first()
            if existing is not None:
                existing.delete()
            report = PropertyAppraisalReport.objects.create(
                property=property_obj,
                file=f,
                original_filename=f.name,
                file_size=f.size,
                uploaded_by=request.user,
            )
        return Response(
            PropertyAppraisalReportSerializer(report, context={"request": request}).data,
            status=201,
        )

    def _delete_appraisal_report(self, request, pk):
        property_obj = self.get_object()
        if not has_permission(request.user, "property.appraisal"):
            return Response(
                {"detail": "شما اجازه حذف گزارش کارشناسی را ندارید."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not can_manage_property(request.user, property_obj):
            return Response(
                {"detail": "فقط مالک ملک یا مدیر می‌تواند گزارش کارشناسی را حذف کند."},
                status=status.HTTP_403_FORBIDDEN,
            )
        report = PropertyAppraisalReport.objects.filter(
            property=property_obj
        ).first()
        if report is None:
            return Response(
                {"detail": "گزارش کارشناسی برای این ملک ثبت نشده است."},
                status=404,
            )

        report.delete()
        return Response(status=204)

    @action(
        detail=True,
        methods=["get"],
        url_path="appraisal-report/download",
        url_name="appraisal-report-download",
    )
    def download_appraisal_report(self, request, pk=None):
        property_obj = self.get_object()
        if not can_access_property(request.user, property_obj):
            return Response(
                {"detail": "شما به این فایل دسترسی ندارید."},
                status=status.HTTP_403_FORBIDDEN,
            )
        report = (
            PropertyAppraisalReport.objects.filter(property=property_obj).first()
        )
        if report is None or not report.file:
            return Response(
                {"detail": "گزارش کارشناسی برای این ملک ثبت نشده است."},
                status=404,
            )
        inline = request.query_params.get("inline") in ("1", "true")
        return FileResponse(
            report.file.open("rb"),
            content_type="application/pdf",
            as_attachment=not inline,
            filename=report.original_filename or "appraisal-report.pdf",
        )



@permission_required("property.archive")
def property_archive(request, pk):

    property_obj = get_object_or_404(Property, pk=pk)

    if not user_is_admin(request.user) and not user_in_scope(
        request.user, property_obj.consultant_id
    ):
        raise DjangoPermissionDenied("شما به این ملک دسترسی ندارید.")

    if property_obj.status == Property.Status.DRAFT:
        raise DjangoPermissionDenied("ملک پیش‌نویس تا تأیید مدیر قابل بایگانی نیست.")

    property_obj.status = Property.Status.INACTIVE
    property_obj.save()

    return redirect("properties:property-list")


@ensure_csrf_cookie
@login_required
def property_list(request):
    user = request.user

    if user_is_admin(user):
        properties_qs = Property.objects.all()
    else:
        properties_qs = Property.objects.filter(
            consultant_id__in=team_user_ids(user) or set()
        )

    search_query = request.GET.get("q")

    fuzzy_search_active = bool(search_query and search_query.strip())
    if search_query:
        properties_qs = apply_fuzzy_search(
            properties_qs,
            search_query,
            [
                "title",
                "internal_code",
                "address",
                "neighborhood",
                "description",
                "district__display_name",
                "district__name",
                "district__city__display_name",
                "district__city__province__display_name",
                "consultant__consultant_profile__full_name",
                "consultant__username",
                "consultant__first_name",
                "consultant__last_name",
            ],
        )

    properties_qs = properties_qs.prefetch_related("property_files__deal_type")

    if fuzzy_search_active:
        paginator = Paginator(properties_qs, 12)
    else:
        paginator = Paginator(properties_qs.order_by("-created_at"), 12)
    page_number = request.GET.get("page", 1)
    page_obj = paginator.get_page(page_number)

    properties_list = []
    for p in page_obj.object_list:
        is_archived = (p.status == Property.Status.INACTIVE)

        properties_list.append({
            "id": str(p.id),
            "internalCode": p.internal_code or "",
            "title": p.title or "",
            "type": (p.property_type or "apartment").lower(),
            "transactionType": "sale" if p.deal_type == "SALE" else "rent",
            "floor": p.floor or 0,
            "constructionYear": p.built_year or 0,
            "fullAddress": p.address or "",
            "propertyStatus": (p.status or "active").lower(),
            "archived": is_archived,
            "price": float(_sale_price(p) or 0),
            "area": p.area or 0,
            "beds": p.rooms or 0,
            "district": p.neighborhood or "",
            "consultant": (p.consultant.get_full_name() or p.consultant.username) if p.consultant else "نامشخص",
            "consultantId": str(p.consultant.id) if p.consultant else "",
            "date": p.created_at.strftime("%Y-%m-%d") if p.created_at else "",
            "ownerFirstName": p.owner_first_name or "",
            "ownerLastName": p.owner_last_name or "",
            "ownerPhone": p.owner_phone or "",
            "views": 0,
            "listed": not is_archived,
            "roi": 0,
            "gradient": "from-emerald-500 to-teal-600"
        })

    initial_data = build_initial_data(
        request,
        "properties"
        if getattr(user, "role", "") in {"ADMIN", "RANGE_MANAGER"}
        else "my-properties",
    )
    initial_data["pageProps"] = {
        "properties": properties_list,
        "items": properties_list,
        "pagination": {
            "currentPage": page_obj.number,
            "totalPages": paginator.num_pages,
            "totalItems": paginator.count,
            "hasNext": page_obj.has_next(),
            "hasPrevious": page_obj.has_previous(),
        },
    }

    return render(request, "dashboard.html", {"initial_data": initial_data})



@permission_required("property.edit")
def property_image_manage(request, pk):
    property_obj = get_object_or_404(Property, pk=pk)

    if not can_manage_property(request.user, property_obj):
        raise DjangoPermissionDenied("شما به این ملک دسترسی ندارید.")

    if request.method == "POST":
        formset = PropertyImageFormSet(
            request.POST,
            request.FILES,
            instance=property_obj,
        )
        if formset.is_valid():
            formset.save()
            return redirect("properties:property-update", pk=property_obj.pk)
    else:
        formset = PropertyImageFormSet(instance=property_obj)

    return render(
        request,
        "properties/property_image_form.html",
        {
            "property": property_obj,
            "formset": formset,
        },
    )



def get_common_initial_data(request, page_name):
    return build_initial_data(request, page_name)

@ensure_csrf_cookie
@permission_required("property.create")
def property_create_view(request):
    data = get_common_initial_data(request, "add-property")

    return render(request, "dashboard.html", {"initial_data": data})

@ensure_csrf_cookie
@login_required
def property_edit_view(request, pk):
    property_obj = get_object_or_404(Property, pk=pk)

    if not can_manage_property(request.user, property_obj):
        return redirect("dashboard")

    data = get_common_initial_data(request, "edit-property")

    data["pageProps"] = {
        "propertyData": {
            "id": str(property_obj.id),
            "title": property_obj.title,
            "price": float(_sale_price(property_obj) or 0),
            "area": property_obj.area,
            "rooms": property_obj.rooms,
            "description": property_obj.description,
        }
    }

    return render(request, "dashboard.html", {"initial_data": data})

@ensure_csrf_cookie
@login_required
def property_detail(request, pk):
    user = request.user

    property_obj = Property.objects.prefetch_related("images").filter(pk=pk).first()
    if property_obj is None or not can_access_property(user, property_obj):
        raise Http404

    appraisal = (
        PropertyAppraisalReport.objects.select_related("uploaded_by")
        .filter(property=property_obj)
        .first()
    )

    property_data = {
        "id": str(property_obj.id),
        "internalCode": property_obj.internal_code or "",
        "title": property_obj.title or "",
        "type": (property_obj.property_type or "").lower(),
        "transactionType": "sale" if property_obj.deal_type == "SALE" else "rent",
        "floor": property_obj.floor or 0,
        "constructionYear": property_obj.built_year or 0,
        "fullAddress": property_obj.address or "",
        "propertyStatus": (property_obj.status or "").lower(),
        "archived": property_obj.status == Property.Status.INACTIVE,
        "price": float(_sale_price(property_obj) or 0),
        "area": property_obj.area or 0,
        "beds": property_obj.rooms or 0,
        "district": property_obj.neighborhood or "",
        "consultant": (
            (property_obj.consultant.get_full_name() or property_obj.consultant.username)
            if property_obj.consultant else ""
        ),
        "consultantId": str(property_obj.consultant.id) if property_obj.consultant else "",
        "date": property_obj.created_at.strftime("%Y-%m-%d") if property_obj.created_at else "",
        "ownerFirstName": property_obj.owner_first_name or "",
        "ownerLastName": property_obj.owner_last_name or "",
        "ownerPhone": property_obj.owner_phone or "",
        "views": 0,
        "listed": property_obj.status != Property.Status.INACTIVE,
        "roi": 0,
        "gradient": "from-emerald-500 to-teal-600",

        "description": property_obj.description or "",
        "images": [
            {
                "id": str(image.id),
                "url": image.image.url,
                "alt": property_obj.title or "property-image"
            }
            for image in property_obj.images.all()
        ],

        "appraisalReport": (
            PropertyAppraisalReportSerializer(
                appraisal, context={"request": request}
            ).data
            if appraisal
            else None
        ),
    }

    initial_data = build_initial_data(request, "property-detail")
    initial_data["next"] = ""
    initial_data["pageProps"] = {"property": property_data}

    return render(request, "dashboard.html", {"initial_data": initial_data})
