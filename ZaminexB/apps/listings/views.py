from django.http import Http404
from django.shortcuts import render, get_object_or_404, redirect
from django.middleware.csrf import get_token
from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import generics, viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.accounts.permissions import has_permission, require_permission
from apps.accounts.scoping import team_user_ids, user_in_scope, user_is_admin
from apps.common.attribute_values import attribute_payload_changed
from apps.common.fuzzy_search import apply_fuzzy_search
from apps.common.pagination import StandardResultsSetPagination
from apps.notifications.models import Notification
from apps.notifications.services import (
    actor_display_name,
    notify_admins_pending_review,
    notify_users,
)
from apps.properties.models import Property
from apps.tickets.access import active_recipient_queryset
from .models import PropertyFile, PropertyFileAttributeValue
from .serializers import (
    PropertyFileListSerializer,
    PropertyFileSerializer,
    PublicPropertyFileSerializer,
    PublicPropertyFileDetailSerializer,
    StaffPropertyFileCardSerializer,
    StaffPropertyFileDetailSerializer,
)


def _sync_property_status_from_property_files(property_file):
    property_id = getattr(property_file, "property_id", None)
    if not property_id:
        return

    with transaction.atomic():
        prop = (
            Property.objects.select_for_update().filter(pk=property_id).first()
        )
        if prop is None or prop.status == Property.Status.DRAFT:
            return

        other_sold = PropertyFile.objects.filter(
            property_id=property_id,
            status=PropertyFile.Status.SOLD,
        ).exclude(pk=property_file.pk).exists()

        if property_file.status == PropertyFile.Status.SOLD:
            new_status = Property.Status.SOLD
        elif other_sold:
            new_status = Property.Status.SOLD
        else:
            new_status = Property.Status.AVAILABLE

        if prop.status != new_status:
            prop.status = new_status
            prop.save(update_fields=["status", "updated_at"])



def _property_file_payload_changed(instance, serializer) -> bool:
    for field, value in serializer.validated_data.items():
        if field == "status":
            continue
        if getattr(instance, field, None) != value:
            return True

    request = serializer.context.get("request")
    payload = request.data.get("attributes") if request is not None else None
    return attribute_payload_changed(
        instance, payload, PropertyFileAttributeValue, "property_file"
    )


def _property_file_review_metadata(property_file) -> dict:
    return {
        "propertyFileId": property_file.pk,
        "listingId": property_file.pk,
        "propertyId": property_file.property_id,
        "title": property_file.title,
    }


def _notify_property_file_pending_review(property_file, actor) -> None:
    notify_admins_pending_review(
        notification_type=Notification.NotificationType.PROPERTY_FILE_PENDING_REVIEW,
        title="فایل جدید در انتظار تأیید",
        message=(
            f"فایل «{property_file.title}» توسط {actor_display_name(actor)} "
            "برای بررسی به مدیران ارسال شد."
        ),
        metadata=_property_file_review_metadata(property_file),
        actor=actor,
        permission_code="property_file.review",
    )


def _notify_property_file_decision(actor, property_file, approved: bool) -> None:
    recipient = property_file.assigned_to or property_file.created_by
    if recipient is None or recipient.pk == getattr(actor, "pk", None):
        return

    metadata = _property_file_review_metadata(property_file)
    if approved:
        notify_users(
            [recipient],
            notification_type=Notification.NotificationType.PROPERTY_FILE_APPROVED,
            title="تأیید فایل",
            message=f"فایل «{property_file.title}» تأیید و منتشر شد.",
            metadata=metadata,
        )
    else:
        notify_users(
            [recipient],
            notification_type=Notification.NotificationType.PROPERTY_FILE_REJECTED,
            title="بازگرداندن فایل برای اصلاح",
            message=(
                f"فایل «{property_file.title}» برای اصلاح بازگردانده شد: "
                f"{property_file.rejection_reason}"
            ),
            metadata=metadata,
        )


PRICE_CEILINGS = (("saleMax", "sale_price"), ("depositMax", "deposit"), ("rentMax", "monthly_rent"))


def _apply_property_file_search_filters(queryset, params):
    search = (params.get("q") or "").strip()
    if search:
        queryset = queryset.filter(
            Q(title__icontains=search)
            | Q(description__icontains=search)
            | Q(property__title__icontains=search)
            | Q(property__neighborhood__icontains=search)
            | Q(property__district__display_name__icontains=search)
            | Q(property__district__city__display_name__icontains=search)
            | Q(deal_type__display_name__icontains=search)
        )

    deal_type = (params.get("dealType") or params.get("deal_type") or "").strip()
    if deal_type:
        if deal_type.isdigit():
            queryset = queryset.filter(deal_type_id=deal_type)
        else:
            queryset = queryset.filter(
                Q(deal_type__name__iexact=deal_type)
                | Q(deal_type__display_name__iexact=deal_type)
            )

    city = (params.get("city") or "").strip()
    if city:
        if city.isdigit():
            queryset = queryset.filter(property__district__city_id=city)
        else:
            queryset = queryset.filter(
                Q(property__district__city__display_name__icontains=city)
                | Q(property__district__city__name__icontains=city)
            )

    district = (params.get("district") or "").strip()
    if district:
        if district.isdigit():
            queryset = queryset.filter(property__district_id=district)
        else:
            queryset = queryset.filter(
                Q(property__neighborhood__icontains=district)
                | Q(property__district__display_name__icontains=district)
                | Q(property__district__name__icontains=district)
            )

    property_type = (params.get("propertyTypeRef") or "").strip()
    if property_type:
        if property_type.isdigit():
            queryset = queryset.filter(property__property_type_ref_id=property_type)
        else:
            queryset = queryset.filter(
                Q(property__property_type_ref__name__iexact=property_type)
                | Q(property__property_type_ref__display_name__icontains=property_type)
            )

    channel = (params.get("channel") or "").strip()
    if channel and channel.lower() != "all":
        queryset = queryset.filter(publish_channel__iexact=channel)

    for parameter, operator in (("areaMin", "gte"), ("areaMax", "lte")):
        raw_value = (params.get(parameter) or "").strip()
        if not raw_value:
            continue
        try:
            area = int(raw_value)
        except (TypeError, ValueError):
            raise ValidationError({parameter: "مساحت باید عدد صحیح باشد."})
        if area < 0:
            raise ValidationError({parameter: "مساحت نمی‌تواند منفی باشد."})
        queryset = queryset.filter(**{f"property__area__{operator}": area})

    for parameter, field in PRICE_CEILINGS:
        raw_value = (params.get(parameter) or "").strip()
        if not raw_value:
            continue
        try:
            ceiling = int(raw_value)
        except (TypeError, ValueError):
            raise ValidationError({parameter: "سقف قیمت باید عدد صحیح باشد."})
        if ceiling < 0:
            raise ValidationError({parameter: "سقف قیمت نمی‌تواند منفی باشد."})
        queryset = queryset.filter(
            Q(**{f"{field}__isnull": True}) | Q(**{f"{field}__lte": ceiling})
        )

    return queryset


def _active_property_file_queryset(user=None, params=None):
    queryset = PropertyFile.objects.filter(
        status=PropertyFile.Status.ACTIVE,
        property__status__in=(Property.Status.AVAILABLE, Property.Status.RESERVED),
        property__review_status=Property.ReviewStatus.APPROVED,
    )
    active_owners = active_recipient_queryset().order_by().values("pk")
    queryset = queryset.filter(
        Q(assigned_to_id__in=active_owners)
        | Q(assigned_to__isnull=True, property__consultant_id__in=active_owners)
    )
    scope = ((params or {}).get("scope") or "").strip().lower()
    if user is not None and scope == "mine":
        queryset = queryset.filter(assigned_to_id__in=team_user_ids(user) or {user.pk})
    return queryset.select_related(
        "deal_type",
        "property",
        "property__property_type_ref",
        "property__district__city",
        "property__consultant",
        "property__consultant__consultant_profile",
        "assigned_to",
        "assigned_to__consultant_profile",
    ).prefetch_related("property__images", "property__consultant__groups", "assigned_to__groups")


class PublicPropertyFileExploreView(generics.ListAPIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    serializer_class = PublicPropertyFileSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        queryset = (
            PropertyFile.objects.filter(
                status=PropertyFile.Status.ACTIVE,
                publish_channel=PropertyFile.PublishChannel.WEBSITE,
                property__status__in=(Property.Status.AVAILABLE, Property.Status.RESERVED),
                property__review_status=Property.ReviewStatus.APPROVED,
            )
            .select_related(
                "deal_type",
                "property",
                "property__property_type_ref",
                "property__district__city",
            )
            .prefetch_related("property__images")
        )
        return _apply_property_file_search_filters(queryset, self.request.query_params).order_by(
            "-created_at", "-id"
        )


class PublicPropertyFileDetailView(generics.RetrieveAPIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    serializer_class = PublicPropertyFileDetailSerializer

    def get_queryset(self):
        return (
            PropertyFile.objects.filter(
                status=PropertyFile.Status.ACTIVE,
                publish_channel=PropertyFile.PublishChannel.WEBSITE,
                property__status__in=(Property.Status.AVAILABLE, Property.Status.RESERVED),
                property__review_status=Property.ReviewStatus.APPROVED,
            )
            .select_related(
                "deal_type",
                "property",
                "property__property_type_ref",
                "property__district__city",
            )
            .prefetch_related("property__images")
        )


def public_property_file_explorer(request):
    return render(request, "listings/explore.html")


def public_property_file_detail(request, pk):
    property_file = get_object_or_404(
        PropertyFile.objects.filter(
            status=PropertyFile.Status.ACTIVE,
            publish_channel=PropertyFile.PublishChannel.WEBSITE,
            property__status__in=(Property.Status.AVAILABLE, Property.Status.RESERVED),
            property__review_status=Property.ReviewStatus.APPROVED,
        ).select_related("property"),
        pk=pk,
    )
    user = request.user
    initial_data = {
        "isAuthenticated": bool(user.is_authenticated),
        "csrfToken": get_token(request),
    }
    return render(
        request,
        "listings/detail.html",
        {"property_file": property_file, "initial_data": initial_data},
    )


class PropertyFileViewSet(viewsets.ModelViewSet):
    serializer_class = PropertyFileSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == "list":
            return PropertyFileListSerializer
        return PropertyFileSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if self.action == "list":
            from apps.analytics.metrics import annotate_effective_prices

            property_ids = set(
                self.filter_queryset(self.get_queryset())
                .values_list("property_id", flat=True)
            )
            context["effective_price_map"] = annotate_effective_prices(property_ids)
        return context

    def get_queryset(self):
        user = self.request.user
        if user_is_admin(user):
            qs = PropertyFile.objects.all().select_related(
                'property', 'created_by', 'assigned_to', 'deal_type'
            )
        else:
            qs = PropertyFile.objects.filter(
                assigned_to_id__in=team_user_ids(user) or set()
            ).select_related(
                'property', 'created_by', 'assigned_to', 'deal_type'
            )

        responsibility = (self.request.query_params.get("responsibility") or "").strip().lower()
        if responsibility == "mine":
            qs = qs.filter(assigned_to_id=user.pk)
        elif responsibility == "range" and user_is_admin(user):
            range_id = self.request.query_params.get("sales_range") or self.request.query_params.get("scope")
            if range_id and str(range_id).isdigit():
                from apps.accounts.models import SalesRange

                sr = SalesRange.objects.filter(pk=int(range_id)).first()
                if sr is not None:
                    member_ids = set(sr.members.values_list("pk", flat=True)) | set(sr.managers.values_list("pk", flat=True))
                    qs = qs.filter(assigned_to_id__in=member_ids)

        qs = qs.prefetch_related("created_by__groups", "assigned_to__groups")
        if self.action == "list":
            qs = qs.select_related(
                'assigned_to__consultant_profile',
                'created_by__consultant_profile',
            ).prefetch_related(
                'property__images',
                'property__followups',
                'property__tasks',
            )
        else:
            qs = qs.prefetch_related('property__images')

        if getattr(self, "action", None) != "list":
            return qs.order_by("-created_at")

        q = self.request.query_params.get("q")
        fuzzy_search_active = bool(q and q.strip())
        if q:
            qs = apply_fuzzy_search(
                qs,
                q,
                [
                    "title",
                    "description",
                    "id",
                    "property__title",
                    "property__internal_code",
                    "property__address",
                    "property__neighborhood",
                    "property__district__display_name",
                    "property__district__name",
                    "assigned_to__consultant_profile__full_name",
                    "assigned_to__username",
                    "assigned_to__first_name",
                    "assigned_to__last_name",
                ],
            )

        status_param = self.request.query_params.get("status")
        show_sold = self.request.query_params.get("show_sold") or self.request.query_params.get("showSold")
        include_sold = self.request.query_params.get("include_sold") or self.request.query_params.get("includeSold")

        if status_param:
            qs = qs.filter(status__iexact=status_param)
        elif str(show_sold).lower() in ("true", "1"):
            qs = qs.filter(status=PropertyFile.Status.SOLD)
        elif str(include_sold).lower() in ("true", "1"):
            pass
        else:
            qs = qs.exclude(status=PropertyFile.Status.SOLD)

        consultant = self.request.query_params.get("consultant") or self.request.query_params.get("assigned_to")
        if consultant and user_is_admin(user):
            if str(consultant).isdigit():
                qs = qs.filter(assigned_to_id=consultant)
            else:
                qs = apply_fuzzy_search(qs, consultant, ["assigned_to__username"])

        prop = self.request.query_params.get("property")
        if prop:
            if str(prop).isdigit():
                qs = qs.filter(property_id=prop)
            else:
                qs = apply_fuzzy_search(qs, prop, ["property__title"])

        deal_type = self.request.query_params.get("dealType") or self.request.query_params.get("deal_type")
        if deal_type:
            if str(deal_type).isdigit():
                qs = qs.filter(deal_type_id=deal_type)
            else:
                qs = apply_fuzzy_search(
                    qs, deal_type, ["deal_type__display_name", "deal_type__name"]
                )

        rent_min = self.request.query_params.get("rentMin")
        rent_max = self.request.query_params.get("rentMax")
        if rent_min:
            qs = qs.filter(monthly_rent__gte=rent_min)
        if rent_max:
            qs = qs.filter(monthly_rent__lte=rent_max)

        deposit_min = self.request.query_params.get("depositMin")
        deposit_max = self.request.query_params.get("depositMax")
        if deposit_min:
            qs = qs.filter(deposit__gte=deposit_min)
        if deposit_max:
            qs = qs.filter(deposit__lte=deposit_max)

        sale_min = self.request.query_params.get("saleMin")
        sale_max = self.request.query_params.get("saleMax")
        if sale_min or sale_max:
            if sale_min and sale_max:
                qs = qs.filter(
                    Q(sale_price__gte=sale_min, sale_price__lte=sale_max) |
                    Q(deposit__gte=sale_min, deposit__lte=sale_max)
                )
            elif sale_min:
                qs = qs.filter(
                    Q(sale_price__gte=sale_min) |
                    Q(deposit__gte=sale_min)
                )
            elif sale_max:
                qs = qs.filter(
                    Q(sale_price__lte=sale_max) |
                    Q(deposit__lte=sale_max)
                )

        if fuzzy_search_active:
            return qs
        return qs.order_by("-created_at")

    @action(detail=False, methods=["get"], url_path="explore")
    def explore(self, request):
        queryset = _apply_property_file_search_filters(
            _active_property_file_queryset(), request.query_params
        ).order_by("-created_at", "-id")
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = StaffPropertyFileCardSerializer(
                page, many=True, context=self.get_serializer_context()
            )
            return self.get_paginated_response(serializer.data)
        serializer = StaffPropertyFileCardSerializer(
            queryset, many=True, context=self.get_serializer_context()
        )
        return Response(serializer.data)

    @action(detail=False, methods=["get"], url_path=r"explore/(?P<pk>[^/.]+)")
    def explore_detail(self, request, pk=None):
        if not str(pk).isdigit():
            raise Http404
        property_file = get_object_or_404(_active_property_file_queryset(), pk=pk)
        serializer = StaffPropertyFileDetailSerializer(
            property_file, context=self.get_serializer_context()
        )
        return Response(serializer.data)

    @action(detail=False, methods=["get"], url_path="recommendations")
    def recommendations(self, request):
        queryset = _apply_property_file_search_filters(
            _active_property_file_queryset(request.user, request.query_params),
            request.query_params,
        ).order_by("-created_at", "-id")
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = StaffPropertyFileCardSerializer(
                page, many=True, context=self.get_serializer_context()
            )
            return self.get_paginated_response(serializer.data)
        serializer = StaffPropertyFileCardSerializer(
            queryset, many=True, context=self.get_serializer_context()
        )
        return Response(serializer.data)

    @action(detail=True, methods=["get"])
    def versions(self, request, pk=None):
        property_file = self.get_object()
        return Response([
            {"version": item.version_number, "snapshot": item.snapshot, "changed_by": item.changed_by_id, "created_at": item.created_at}
            for item in property_file.versions.all()
        ])

    @action(detail=True, methods=["post"])
    def transition(self, request, pk=None):
        property_file = self.get_object()
        if not has_permission(request.user, "property_file.status"):
            return Response({"detail": "شما اجازه تغییر وضعیت فایل را ندارید."}, status=status.HTTP_403_FORBIDDEN)
        if not user_is_admin(request.user) and not user_in_scope(request.user, property_file.assigned_to_id):
            return Response({"detail": "شما اجازه انجام این عملیات را ندارید."}, status=status.HTTP_403_FORBIDDEN)
        expected_version = request.data.get("version")
        if expected_version is not None and str(expected_version) != str(property_file.version):
            return Response({"detail": "نسخه فایل تغییر کرده است؛ صفحه را تازه کنید.", "code": "version_conflict"}, status=status.HTTP_409_CONFLICT)
        target = str(request.data.get("status") or "").upper()
        factory = getattr(PropertyFile, "transition_to", None)
        values = dict(PropertyFile.Status.choices)
        if target not in values:
            raise ValidationError({"status": "وضعیت مقصد معتبر نیست."})
        property_file.transition_to(target, str(request.data.get("reason") or ""))
        property_file.save(update_fields=["status", "rejection_reason", "updated_at"])
        return Response(PropertyFileSerializer(property_file, context=self.get_serializer_context()).data)

    def perform_create(self, serializer):
        user = self.request.user
        require_permission(user, "property_file.create", "شما اجازه ساخت فایل را ندارید.")
        property_obj = serializer.validated_data.get("property")
        if property_obj and property_obj.review_status != Property.ReviewStatus.APPROVED:
            raise ValidationError({"property": "فایل عرضه فقط برای ملک تأییدشده ساخته می‌شود."})
        if user_is_admin(user):
            serializer.save(
                created_by=user,
                status=PropertyFile.Status.ACTIVE,
                rejection_reason="",
            )
            return

        assigned_to = serializer.validated_data.get("assigned_to") or user
        if not has_permission(user, "property_file.assign") or not user_in_scope(
            user, assigned_to.pk
        ):
            assigned_to = user

        property_file = serializer.save(
            created_by=user,
            assigned_to=assigned_to,
            status=PropertyFile.Status.ACTIVE,
            rejection_reason="",
            review_requested_at=None,
        )

    def perform_update(self, serializer):
        user = self.request.user
        instance = serializer.instance
        require_permission(user, "property_file.edit", "شما اجازه ویرایش فایل را ندارید.")
        if not user_is_admin(user) and not user_in_scope(
            user, instance.assigned_to_id
        ):
            raise PermissionDenied("شما اجازه ویرایش این فایل را ندارید.")
        updated_property = serializer.validated_data.get("property", instance.property)
        if updated_property.review_status != Property.ReviewStatus.APPROVED:
            raise PermissionDenied("فایل عرضه فقط برای ملک تأییدشده قابل ویرایش است.")
        if user_is_admin(user):
            serializer.save()
            return

        payload_changed = _property_file_payload_changed(instance, serializer)
        assigned_to = serializer.validated_data.get("assigned_to") or instance.assigned_to
        if not has_permission(user, "property_file.assign") or not user_in_scope(
            user, assigned_to.pk if assigned_to else None
        ):
            assigned_to = instance.assigned_to
        save_options = {"assigned_to": assigned_to}
        resubmitted = False

        property_file = serializer.save(**save_options)

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        return Response({"detail": "تأیید مستقل فایل حذف شده است؛ بررسی روی خود ملک انجام می‌شود."}, status=status.HTTP_410_GONE)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        return Response({"detail": "تأیید مستقل فایل حذف شده است؛ بررسی روی خود ملک انجام می‌شود."}, status=status.HTTP_410_GONE)

    @action(detail=True, methods=['post'])
    def pause(self, request, pk=None):
        property_file = self.get_object()
        if not has_permission(request.user, "property_file.status"):
            return Response({"detail": "شما اجازه تغییر وضعیت فایل را ندارید."}, status=status.HTTP_403_FORBIDDEN)
        if not user_is_admin(request.user) and not user_in_scope(request.user, property_file.assigned_to_id):
            return Response({"detail": "شما اجازه انجام این عملیات را ندارید."}, status=status.HTTP_403_FORBIDDEN)

        if property_file.status == PropertyFile.Status.ACTIVE:
            property_file.status = PropertyFile.Status.PAUSED
        elif property_file.status == PropertyFile.Status.PAUSED:
            property_file.status = PropertyFile.Status.ACTIVE
        else:
            return Response({"detail": "فایل باید فعال یا متوقف‌شده باشد."}, status=status.HTTP_400_BAD_REQUEST)

        property_file.save(update_fields=['status', 'updated_at'])
        return Response(PropertyFileSerializer(property_file).data)

    @action(detail=True, methods=['post'])
    def archive(self, request, pk=None):
        property_file = self.get_object()
        if not has_permission(request.user, "property_file.status"):
            return Response({"detail": "شما اجازه تغییر وضعیت فایل را ندارید."}, status=status.HTTP_403_FORBIDDEN)
        if not user_is_admin(request.user) and not user_in_scope(request.user, property_file.assigned_to_id):
            return Response({"detail": "شما اجازه انجام این عملیات را ندارید."}, status=status.HTTP_403_FORBIDDEN)
        if property_file.status == PropertyFile.Status.DRAFT:
            raise ValidationError({"detail": "پیش‌نویس را نمی‌توان بایگانی کرد."})
        property_file.status = PropertyFile.Status.ARCHIVED
        property_file.save(update_fields=['status', 'updated_at'])
        return Response(PropertyFileSerializer(property_file).data)

    @action(detail=True, methods=['post'])
    def unarchive(self, request, pk=None):
        property_file = self.get_object()
        if not has_permission(request.user, "property_file.status"):
            return Response({"detail": "شما اجازه تغییر وضعیت فایل را ندارید."}, status=status.HTTP_403_FORBIDDEN)
        if not user_is_admin(request.user) and not user_in_scope(request.user, property_file.assigned_to_id):
            return Response({"detail": "شما اجازه انجام این عملیات را ندارید."}, status=status.HTTP_403_FORBIDDEN)
        if property_file.status != PropertyFile.Status.ARCHIVED:
            return Response({"detail": "فایل باید بایگانی‌شده باشد."}, status=status.HTTP_400_BAD_REQUEST)
        if property_file.property.status not in (Property.Status.AVAILABLE, Property.Status.RESERVED):
            raise ValidationError({"property": "ابتدا باید ملک مربوطه توسط مدیر تأیید شود."})
        if (
            property_file.deal_type_id is not None
            and PropertyFile.objects.filter(
                property_id=property_file.property_id, deal_type_id=property_file.deal_type_id
            )
            .exclude(status=PropertyFile.Status.ARCHIVED)
            .exclude(pk=property_file.pk)
            .exists()
        ):
            raise ValidationError({"detail": "برای این ملک با این نوع معامله فایل فعال دیگری وجود دارد."})
        property_file.status = PropertyFile.Status.ACTIVE
        property_file.save(update_fields=['status', 'updated_at'])
        return Response(PropertyFileSerializer(property_file).data)

    def destroy(self, request, *args, **kwargs):
        property_file = self.get_object()
        if not has_permission(request.user, "property_file.edit"):
            return Response({"detail": "شما اجازه حذف فایل را ندارید."}, status=status.HTTP_403_FORBIDDEN)
        if not user_is_admin(request.user) and not user_in_scope(request.user, property_file.assigned_to_id):
            return Response({"detail": "شما اجازه حذف این فایل را ندارید."}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['post'])
    def sold(self, request, pk=None):
        property_file = self.get_object()
        if not has_permission(request.user, "property_file.status"):
            return Response({"detail": "شما اجازه تغییر وضعیت فایل را ندارید."}, status=status.HTTP_403_FORBIDDEN)
        if not user_is_admin(request.user) and not user_in_scope(request.user, property_file.assigned_to_id):
            return Response({"detail": "شما اجازه انجام این عملیات را ندارید."}, status=status.HTTP_403_FORBIDDEN)
        if property_file.status == PropertyFile.Status.DRAFT:
            raise ValidationError({"detail": "پیش‌نویس تا زمان تأیید مدیر قابل واگذاری نیست."})
        property_file.status = PropertyFile.Status.SOLD
        property_file.save(update_fields=['status', 'updated_at'])
        _sync_property_status_from_property_files(property_file)
        return Response(PropertyFileSerializer(property_file).data)

    @action(detail=True, methods=['post'])
    def set_status(self, request, pk=None):
        property_file = self.get_object()
        user = request.user
        if not has_permission(user, "property_file.status"):
            return Response({"detail": "شما اجازه تغییر وضعیت فایل را ندارید."}, status=status.HTTP_403_FORBIDDEN)
        if not user_is_admin(user) and not user_in_scope(user, property_file.assigned_to_id):
            return Response({"detail": "شما اجازه انجام این عملیات را ندارید."}, status=status.HTTP_403_FORBIDDEN)

        new_status = request.data.get("status") or request.query_params.get("status")
        valid_statuses = [choice.value for choice in PropertyFile.Status]
        if not new_status or str(new_status) not in valid_statuses:
            return Response({"detail": "وضعیت نامعتبر است."}, status=status.HTTP_400_BAD_REQUEST)

        if str(new_status) == PropertyFile.Status.ACTIVE and property_file.status == PropertyFile.Status.DRAFT and property_file.property.review_status != Property.ReviewStatus.APPROVED:
            raise ValidationError({"property": "فایل عرضه فقط برای ملک تأییدشده فعال می‌شود."})

        property_file.status = str(new_status)
        property_file.save(update_fields=['status', 'updated_at'])
        _sync_property_status_from_property_files(property_file)

        return Response(PropertyFileSerializer(property_file).data)


@login_required
def property_file_list(request):
    return render(request, "listings/property_file_list.html", {"listing_props": {}})
