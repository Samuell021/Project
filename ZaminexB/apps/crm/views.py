from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import MethodNotAllowed, PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import SalesRange, ScopeMembership, ScopeTransferHistory, User, UserRole
from apps.accounts.permissions import has_permission, require_permission, user_is_general_manager
from apps.accounts.scoping import team_user_ids
from apps.basics.models import DealType, DealTypeFamily, DealTypeVersion, District, PropertyType, PropertyUsage
from apps.listings.models import PropertyFile, PropertyFilePriceHistory
from apps.properties.models import Property
from apps.tasks.models import Task

from . import models, serializers, services
from .services import inquiry_workflow
from .services.stages import pipeline_stage
from .services.access import (
    active_scope_listings_queryset,
    scoped_commission_queryset,
    scoped_contract_queryset,
    scoped_deal_queryset,
    scoped_listing_queryset,
    scoped_payment_queryset,
    scoped_property_file_queryset,
    scoped_property_queryset,
)
from .files import validate_contract_attachment


def convert_errors(func):
    def wrapped(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, "message_dict", {"detail": exc.messages}))
        except DjangoPermissionDenied as exc:
            raise PermissionDenied(str(exc))

    wrapped.__name__ = func.__name__
    return wrapped


def _finite_decimal(value, field_name):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValidationError({field_name: "مقدار عددی معتبر نیست."})
    if not result.is_finite() or result.copy_abs() >= Decimal("1e18"):
        raise ValidationError({field_name: "مقدار باید محدود و در بازهٔ مجاز باشد."})
    return result


def _parse_datetime(value, field_name):
    if value in (None, ""):
        return None
    if isinstance(value, str):
        from django.utils.dateparse import parse_datetime

        parsed = parse_datetime(value)
    elif hasattr(value, "tzinfo"):
        parsed = value
    else:
        parsed = None
    if parsed is None:
        raise ValidationError({field_name: "تاریخ و ساعت معتبر نیست."})
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def _integer(value, field_name, default=None, minimum=None, maximum=None):
    if value in (None, ""):
        return default
    if isinstance(value, bool):
        raise ValidationError({field_name: "عدد معتبر نیست."})
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise ValidationError({field_name: "عدد معتبر نیست."})
    if isinstance(value, (float, Decimal)) and value != parsed:
        raise ValidationError({field_name: "عدد باید صحیح باشد."})
    if minimum is not None and parsed < minimum:
        raise ValidationError({field_name: f"مقدار باید حداقل {minimum} باشد."})
    if maximum is not None and parsed > maximum:
        raise ValidationError({field_name: f"مقدار باید حداکثر {maximum} باشد."})
    return parsed


def _text(value, field_name, default="", max_length=None):
    if value is None:
        value = default
    if not isinstance(value, str):
        raise ValidationError({field_name: "متن معتبر نیست."})
    if max_length is not None and len(value) > max_length:
        raise ValidationError({field_name: f"حداکثر {max_length} نویسه مجاز است."})
    return value


def _foreign_key_id(value, field_name, queryset):
    if value in (None, ""):
        return None
    pk = _integer(value, field_name, minimum=1)
    if not queryset.filter(pk=pk).exists():
        raise ValidationError({field_name: "شناسهٔ انتخاب‌شده یافت نشد."})
    return pk


def _idempotency_payload(data):
    def normalize(value):
        if hasattr(value, "chunks") and hasattr(value, "size"):
            import hashlib

            digest = hashlib.sha256()
            try:
                position = value.tell()
            except (AttributeError, OSError):
                position = 0
            try:
                value.seek(0)
                for chunk in value.chunks():
                    digest.update(chunk)
            finally:
                value.seek(position)
            return {
                "filename": str(getattr(value, "name", "")),
                "size": value.size,
                "sha256": digest.hexdigest(),
            }
        if isinstance(value, (list, tuple)):
            return [normalize(item) for item in value]
        return value

    if hasattr(data, "lists"):
        items = data.lists()
    else:
        items = ((key, [value]) for key, value in data.items())
    return {key: normalize(values[0] if len(values) == 1 else values) for key, values in sorted(items)}


def execute_idempotently(request, action_key, callback):
    if not hasattr(request.data, "get"):
        raise ValidationError({"detail": "دادهٔ درخواست باید یک شیء معتبر باشد."})
    key = str(
        request.headers.get("Idempotency-Key")
        or request.data.get("idempotency_key", "")
        or ""
    ).strip()
    if not key:
        return callback()
    if len(key) > 120:
        raise ValidationError({"idempotency_key": "کلید تکرار امن حداکثر ۱۲۰ نویسه است."})

    payload = {
        "method": request.method.upper(),
        "path": request.path,
        "data": _idempotency_payload(request.data),
    }
    request_hash = services.request_hash(payload)
    with transaction.atomic():
        models.CommandReceipt.objects.filter(
            actor=request.user,
            action=action_key,
            created_at__lt=timezone.now() - timedelta(hours=24),
        ).delete()
        receipt, created = models.CommandReceipt.objects.select_for_update().get_or_create(
            actor=request.user,
            action=action_key,
            idempotency_key=key,
            defaults={"request_hash": request_hash, "result": {"_pending": True}},
        )
        if not created:
            if receipt.request_hash != request_hash:
                raise ValidationError({"idempotency_key": "این کلید قبلاً با درخواست دیگری استفاده شده است."})
            if receipt.result.get("_pending"):
                raise ValidationError({"idempotency_key": "این فرمان هنوز در حال اجرا است؛ کمی بعد دوباره تلاش کنید."})
            return Response(
                receipt.result.get("data"),
                status=receipt.result.get("status", status.HTTP_200_OK),
            )

        response = callback()
        if response.status_code >= 400:
            receipt.delete()
            return response
        services.save_receipt(
            request.user,
            action_key,
            key,
            payload,
            {"status": response.status_code, "data": response.data},
        )
        return response


def idempotent_action(action_key):
    def decorate(func):
        def wrapped(self, request, *args, **kwargs):
            return execute_idempotently(
                request,
                action_key,
                lambda: func(self, request, *args, **kwargs),
            )

        wrapped.__name__ = func.__name__
        return wrapped

    return decorate


class CrmListPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100


class CrmBase(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    pagination_class = CrmListPagination
    search_fields = ()
    list_filter_fields = {}
    allow_create = False
    allow_update = False
    allow_destroy = False
    ordering_fields = ("id",)

    def apply_list_query(self, queryset):
        params = self.request.query_params
        search = str(params.get("search", "")).strip()[:120]
        if search and self.search_fields:
            search_query = Q()
            for field in self.search_fields:
                search_query |= Q(**{f"{field}__icontains": search})
            queryset = queryset.filter(search_query).distinct()
        for parameter, field in self.list_filter_fields.items():
            value = str(params.get(parameter, "")).strip()
            if value and len(value) <= 80:
                if field == "is_active":
                    if value not in {"true", "false", "1", "0"}:
                        raise ValidationError({parameter: "وضعیت فعال معتبر نیست."})
                    value = value in {"true", "1"}
                elif field.endswith("_id") or field.endswith("__id"):
                    value = _integer(value, parameter, minimum=1)
                queryset = queryset.filter(**{field: value})
        ordering = params.get("ordering", "")
        if ordering and ordering.lstrip("-") in self.ordering_fields:
            queryset = queryset.order_by(ordering, "pk")
        return queryset

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        if getattr(self, "action", None) == "list":
            queryset = self.apply_list_query(queryset)
        return queryset

    def create(self, request, *args, **kwargs):
        if not self.allow_create:
            raise MethodNotAllowed(request.method)
        action_key = f"crm.{getattr(self, 'basename', self.__class__.__name__.lower())}.create"
        return execute_idempotently(
            request,
            action_key,
            lambda: super(CrmBase, self).create(request, *args, **kwargs),
        )

    def update(self, request, *args, **kwargs):
        if not self.allow_update:
            raise MethodNotAllowed(request.method)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        if not self.allow_update:
            raise MethodNotAllowed(request.method)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if not self.allow_destroy:
            raise MethodNotAllowed(request.method)
        return super().destroy(request, *args, **kwargs)

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["request"] = self.request
        return ctx


def add_deal_participant(deal, payload, user):
    if not isinstance(payload, dict):
        raise ValidationError({"participants": "ساختار طرف مذاکره معتبر نیست."})
    contact = get_object_or_404(models.Contact, pk=payload.get("contact"))
    allowed_contact_ids = {deal.inquiry.contact_id}
    allowed_contact_ids.update(
        models.PropertyContact.objects.filter(property_id=deal.property_file.property_id)
        .values_list("contact_id", flat=True)
    )
    if not user_is_general_manager(user) and contact.pk not in allowed_contact_ids:
        raise PermissionDenied("طرف مذاکره باید با پرونده متقاضی یا اشخاص مرتبط با ملک مرتبط باشد.")
    role = payload.get("participant_role")
    if role not in models.DealParticipant.Role.values:
        raise ValidationError({"participant_role": "نقش طرف مذاکره معتبر نیست."})
    is_primary = payload.get("is_primary", False)
    if not isinstance(is_primary, bool):
        raise ValidationError({"is_primary": "مقدار طرف اصلی باید درست یا نادرست باشد."})
    if is_primary and models.DealParticipant.objects.filter(
        deal=deal, participant_role=role, is_primary=True
    ).exclude(contact=contact).exists():
        raise ValidationError({"is_primary": "برای این نقش، طرف اصلی دیگری ثبت شده است."})
    participant, _ = models.DealParticipant.objects.get_or_create(
        deal=deal,
        contact=contact,
        participant_role=role,
        defaults={"is_primary": is_primary},
    )
    if is_primary and not participant.is_primary:
        participant.is_primary = True
        participant.save(update_fields=["is_primary"])
    return participant


class ContactViewSet(CrmBase):
    def get_serializer_context(self):
        return {**super().get_serializer_context(), "visible_contact_ids": self.get_queryset().values_list("pk", flat=True)}

    allow_create = True
    allow_update = True
    search_fields = ("full_name", "national_code", "email", "phones__phone", "property_cases__code", "inquiries__code")
    serializer_class = serializers.ContactSerializer
    queryset = models.Contact.objects.all().prefetch_related("phones")

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user_is_general_manager(user) or has_permission(user, "contact.view"):
            ids = services.scope_team_ids(user)
            if ids is None:
                return qs
            return qs.filter(
                Q(created_by_id__in=ids)
                | Q(property_cases__assigned_to_id__in=ids)
                | Q(inquiries__assigned_to_id__in=ids)
                | Q(property_links__property__consultant_id__in=ids)
            ).distinct()
        return qs.none()

    def perform_create(self, serializer):
        require_permission(self.request.user, "contact.manage")
        serializer.save(created_by=self.request.user)

    @transaction.atomic
    def perform_update(self, serializer):
        from .services.foundation import require_version

        require_permission(self.request.user, "contact.manage")
        locked = models.Contact.objects.select_for_update().get(pk=serializer.instance.pk)
        require_version(locked, self.request.data)
        serializer.instance = locked
        serializer.save(version=locked.version + 1)

    @idempotent_action("crm.contact.update")
    def update(self, request, *args, **kwargs):
        return super().update(request, *args, **kwargs)

    @action(detail=True, methods=["get"])
    def related(self, request, pk=None):
        contact = self.get_object()
        property_cases = models.PropertyRegistrationRequest.objects.filter(contact=contact).select_related("contact", "sales_range", "assigned_to")
        inquiries = models.Inquiry.objects.filter(contact=contact).select_related("contact", "sales_range", "assigned_to")
        visible_properties = scoped_property_queryset(request.user).values_list("pk", flat=True)
        parties = models.PropertyParty.objects.filter(contact=contact, property_id__in=visible_properties).select_related("property")
        return Response({
            "properties": [{"id": party.property_id, "title": party.property.title, "internal_code": party.property.internal_code, "role": party.role, "share_percent": party.share_percent, "is_primary": party.is_primary, "ended_at": party.ended_at} for party in parties],
            "property_cases": [
                {"id": item.pk, "type": "PROPERTY_CASE", "code": item.code, "status": item.status, "stage": pipeline_stage(item), "assigned_to": item.assigned_to.get_full_name() or item.assigned_to.username if item.assigned_to else "", "created_at": item.created_at}
                for item in property_cases if services.can_view_case(request.user, item)
            ],
            "inquiries": [
                {"id": item.pk, "type": "INQUIRY", "code": item.code, "status": item.status, "stage": pipeline_stage(item), "assigned_to": item.assigned_to.get_full_name() or item.assigned_to.username if item.assigned_to else "", "created_at": item.created_at}
                for item in inquiries if services.can_view_case(request.user, item)
            ],
        })

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.contact.review_legacy")
    def review_legacy(self, request, pk=None):
        require_permission(request.user, "contact.manage")
        contact = self.get_object()
        if not contact.is_legacy_placeholder:
            raise ValidationError({"legacy_review_status": "این شخص به‌عنوان جایگزین داده قدیمی نشان‌گذاری نشده است."})
        review_status = request.data.get("legacy_review_status", models.LegacyReviewStatus.REVIEWED)
        if review_status not in (models.LegacyReviewStatus.NEEDS_REVIEW, models.LegacyReviewStatus.REVIEWED):
            raise ValidationError({"legacy_review_status": "وضعیت بازبینی معتبر نیست."})
        notes = _text(request.data.get("notes", contact.legacy_review_notes), "notes", max_length=5000)
        contact.legacy_review_status = review_status
        contact.legacy_review_notes = notes
        contact.legacy_reviewed_by = request.user if review_status == models.LegacyReviewStatus.REVIEWED else None
        contact.legacy_reviewed_at = timezone.now() if review_status == models.LegacyReviewStatus.REVIEWED else None
        contact.save(update_fields=["legacy_review_status", "legacy_review_notes", "legacy_reviewed_by", "legacy_reviewed_at", "updated_at"])
        return Response(self.get_serializer(contact).data)


class ManagementScopeViewSet(CrmBase):
    ordering_fields = ("id", "name", "created_at")
    search_fields = ("name",)
    list_filter_fields = {"active": "is_active"}
    serializer_class = serializers.ManagementScopeSerializer
    queryset = SalesRange.objects.all()

    def get_queryset(self):
        ids = services.user_sales_range_ids(self.request.user)
        if ids is None:
            return super().get_queryset()
        if not ids:
            # The panel decides which range a case belongs to from this very list, so a missing
            # history row must be repaired before the user is told they have no range at all.
            if services.repair_user_sales_ranges(self.request.user):
                ids = services.user_sales_range_ids(self.request.user) or set()
        return super().get_queryset().filter(pk__in=ids)


class ScopeMembershipViewSet(CrmBase):
    search_fields = ("sales_range__name", "user__username", "user__first_name", "user__last_name")
    list_filter_fields = {"sales_range": "sales_range_id", "role": "membership_role"}
    serializer_class = serializers.ScopeMembershipSerializer
    queryset = ScopeMembership.objects.all().select_related("user", "sales_range")

    def get_queryset(self):
        ids = services.user_sales_range_ids(self.request.user)
        qs = super().get_queryset()
        if ids is None:
            return qs
        return qs.filter(sales_range_id__in=ids)


class DealTypeVersionViewSet(CrmBase):
    allow_create = True
    search_fields = ("deal_type__name", "deal_type__display_name", "status", "family")
    list_filter_fields = {"status": "status", "deal_type": "deal_type_id"}
    serializer_class = serializers.DealTypeVersionSerializer
    queryset = DealTypeVersion.objects.all().select_related("deal_type")

    @action(detail=False, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.deal_types.create")
    def create_deal_type(self, request):
        require_permission(request.user, "dealtype.manage")
        name = str(request.data.get("name") or "").strip()
        display = str(request.data.get("display_name") or "").strip()
        family = request.data.get("family", DealTypeFamily.SALE)
        if not name or not display:
            raise ValidationError({"name": "نام سیستمی و نام نمایشی الزامی است."})
        if family not in DealTypeFamily.values:
            raise ValidationError({"family": "خانواده نوع معامله معتبر نیست."})
        if DealType.objects.filter(name=name).exists():
            raise ValidationError({"name": "این نام سیستمی قبلاً ثبت شده است."})
        financial_fields = request.data.get("financial_fields", [])
        required_roles = request.data.get("required_roles", [])
        rules = request.data.get("rules", {})
        if not isinstance(financial_fields, list) or not isinstance(required_roles, list) or not isinstance(rules, dict):
            raise ValidationError({"rules": "ساختار قواعد و فهرست فیلدها معتبر نیست."})
        deal_type = DealType.objects.create(name=name, display_name=display, family=family)
        version = DealTypeVersion.objects.create(
            deal_type=deal_type,
            version_number=1,
            family=family,
            financial_fields=financial_fields,
            required_roles=required_roles,
            rules=rules,
            created_by=request.user,
        )
        return Response(serializers.DealTypeVersionSerializer(version).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.deal_type_version.publish")
    def publish(self, request, pk=None):
        require_permission(request.user, "dealtype.manage")
        version = DealTypeVersion.objects.select_for_update().get(pk=self.get_object().pk)
        if version.status == DealTypeVersion.Status.PUBLISHED:
            return Response(serializers.DealTypeVersionSerializer(version).data)
        if version.status != DealTypeVersion.Status.DRAFT:
            raise ValidationError({"status": "نسخه بایگانی‌شده قابل انتشار نیست."})
        version.status = DealTypeVersion.Status.PUBLISHED
        version.published_at = timezone.now()
        version.save(update_fields=["status", "published_at", "updated_at"])
        return Response(serializers.DealTypeVersionSerializer(version).data)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.deal_type_version.archive")
    def archive(self, request, pk=None):
        require_permission(request.user, "dealtype.manage")
        version = DealTypeVersion.objects.select_for_update().get(pk=self.get_object().pk)
        if version.status == DealTypeVersion.Status.ARCHIVED:
            return Response(serializers.DealTypeVersionSerializer(version).data)
        if version.status != DealTypeVersion.Status.DRAFT:
            raise ValidationError({"status": "نسخه منتشرشده قابل بایگانی نیست؛ نسخه تازه ایجاد کنید."})
        version.status = DealTypeVersion.Status.ARCHIVED
        version.save(update_fields=["status", "updated_at"])
        return Response(serializers.DealTypeVersionSerializer(version).data)

    def perform_create(self, serializer):
        require_permission(self.request.user, "dealtype.manage")
        serializer.save(
            created_by=self.request.user,
            status=DealTypeVersion.Status.DRAFT,
            published_at=None,
        )

    def perform_update(self, serializer):
        require_permission(self.request.user, "dealtype.manage")
        if serializer.instance.status == DealTypeVersion.Status.PUBLISHED:
            raise ValidationError({"status": "نسخه منتشرشده قابل ویرایش نیست."})
        serializer.save()


class CaseMixin:
    def scoped_queryset(self, qs, permission_code="case.view"):
        user = self.request.user
        if user_is_general_manager(user):
            return qs
        if not has_permission(user, permission_code):
            return qs.none()
        ids = services.scope_team_ids(user)
        managed_ids = services.managed_sales_range_ids(user)
        q = Q(created_by=user) | Q(assigned_to=user)
        if managed_ids:
            q |= Q(sales_range_id__in=managed_ids)
        if ids:
            q |= Q(created_by_id__in=ids) | Q(assigned_to_id__in=ids)
        return qs.filter(q).distinct()

    def check_view(self, obj):
        if not services.can_view_case(self.request.user, obj):
            raise PermissionDenied("شما به این پرونده دسترسی ندارید.")

    @action(detail=True, methods=["get"], url_path="assignable-staff")
    def assignable_staff(self, request, pk=None):
        """Staff the server would accept as the responsible consultant of this case.

        A viewer who may open the case but may not assign it gets an empty list instead of a 403:
        the page loads its detail and its candidates together, and ``assign`` is still refused by
        the workflow itself, so an error here would only break the screen for a read-only viewer.
        """
        obj = self.get_object()
        self.check_view(obj)
        if not (
            user_is_general_manager(request.user)
            or services.can_manage_sales_range(request.user, obj.sales_range_id)
        ):
            return Response([])
        users = services.assignable_staff_users(obj.sales_range_id)
        return Response(serializers.AssignableStaffSerializer(users, many=True).data)

    def _locked_subject(self):
        model = models.PropertyRegistrationRequest if self.basename == "property-cases" else models.Inquiry
        return model.objects.select_for_update().get(pk=self.get_object().pk)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.case.accept_lead")
    def accept_lead(self, request, pk=None):
        obj = self._locked_subject()
        self.check_view(obj)
        services.accept_lead(obj, request.user, request.data)
        return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.case.assign")
    def assign(self, request, pk=None):
        obj = self._locked_subject()
        self.check_view(obj)
        assignee = get_object_or_404(User, pk=request.data.get("assigned_to"))
        due_at = _parse_datetime(request.data.get("due_at"), "due_at")
        if due_at is None:
            raise ValidationError({"due_at": "انتخاب موعد انجام برای ارجاع الزامی است."})
        services.assign_case(
            obj,
            request.user,
            assignee,
            due_at,
            request.data.get("reason", ""),
            payload=request.data,
            require_explicit_due=True,
        )
        return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=["post"], url_path="assign_case")
    def assign_case_alias(self, request, pk=None):
        return self.assign(request, pk=pk)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.case.accept_assignment")
    def accept_assignment(self, request, pk=None):
        obj = self._locked_subject()
        services.accept_assignment(obj, request.user, request.data)
        return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.case.reject_assignment")
    def reject_assignment(self, request, pk=None):
        obj = self._locked_subject()
        services.reject_assignment(obj, request.user, request.data.get("reason", ""), payload=request.data)
        return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.case.change_assignee")
    def change_assignee(self, request, pk=None):
        obj = self._locked_subject()
        self.check_view(obj)
        assignee = get_object_or_404(User, pk=request.data.get("assigned_to"))
        due_at = _parse_datetime(request.data.get("due_at"), "due_at")
        services.change_assignee(
            obj,
            request.user,
            assignee,
            due_at,
            request.data.get("reason", ""),
            payload=request.data,
        )
        return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.case.withdrawal")
    def request_withdrawal(self, request, pk=None):
        obj = self._locked_subject()
        self.check_view(obj)
        req = services.request_withdrawal(obj, request.user, request.data.get("reason", ""), payload=request.data)
        return Response(serializers.WithdrawalSerializer(req).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.case.decide_withdrawal")
    def decide_withdrawal(self, request, pk=None):
        obj = self._locked_subject()
        self.check_view(obj)
        req_id = request.data.get("request_id")
        qs = obj.withdrawal_requests.select_for_update()
        req = get_object_or_404(qs, pk=req_id) if req_id else qs.filter(status=models.ConsultantWithdrawalRequest.Status.PENDING).order_by("-requested_at").first()
        if req is None:
            raise ValidationError({"request_id": "درخواست انصراف در انتظار تصمیم یافت نشد."})
        approve_val = bool(request.data.get("approve"))
        decided = services.decide_withdrawal(req, request.user, approve_val, request.data.get("reason", ""))
        return Response(serializers.WithdrawalSerializer(decided).data)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.case.extension")
    def request_extension(self, request, pk=None):
        obj = self._locked_subject()
        self.check_view(obj)
        due = _parse_datetime(request.data.get("requested_due_at"), "requested_due_at")
        req = services.request_extension(
            obj, request.user, due, request.data.get("reason", ""), payload=request.data
        )
        return Response(serializers.RescheduleSerializer(req).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.case.decide_extension")
    def decide_extension(self, request, pk=None):
        obj = self._locked_subject()
        self.check_view(obj)
        req_id = request.data.get("request_id")
        qs = obj.reschedule_requests.select_for_update()
        req = get_object_or_404(qs, pk=req_id) if req_id else qs.filter(status=models.AssignmentRescheduleRequest.Status.PENDING).order_by("-requested_at").first()
        if req is None:
            raise ValidationError({"request_id": "درخواست تمدید در انتظار تصمیم یافت نشد."})
        approve_val = bool(request.data.get("approve"))
        decided = services.decide_extension(
            req,
            request.user,
            approve_val,
            request.data.get("reason", ""),
            new_due_at=request.data.get("new_due_at"),
        )
        return Response(serializers.RescheduleSerializer(decided).data)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.case.transfer_scope")
    def transfer_scope(self, request, pk=None):
        obj = self._locked_subject()
        services.check_version(obj, request.data)
        requested_range_id = request.data.get("sales_range", request.data.get("scope"))
        sales_range = get_object_or_404(SalesRange, pk=requested_range_id)
        services.transfer_sales_range(obj, request.user, sales_range, request.data.get("reason", ""), payload=request.data)
        return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.case.mark_duplicate")
    def mark_duplicate(self, request, pk=None):
        obj = self._locked_subject()
        services.check_version(obj, request.data)
        dup_id = request.data.get("duplicate_of") or request.data.get("original_id")
        if not dup_id:
            raise ValidationError({"duplicate_of": "انتخاب پرونده اصلی الزامی است."})
        duplicate = get_object_or_404(self.get_queryset(), pk=dup_id)
        reason = request.data.get("closure_reason") or request.data.get("reason") or ""
        services.mark_duplicate(obj, request.user, duplicate, reason, payload=request.data)
        return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.case.change_status")
    def change_status(self, request, pk=None):
        obj = self._locked_subject()
        services.check_version(obj, request.data)
        duplicate = None
        dup_id = request.data.get("duplicate_of") or request.data.get("original_id")
        if dup_id:
            duplicate = get_object_or_404(self.get_queryset(), pk=dup_id)
        services.change_case_status(
            obj,
            request.user,
            request.data.get("status"),
            request.data.get("closure_reason", "") or request.data.get("reason", ""),
            duplicate,
            due_at=request.data.get("due_at"),
            payload=request.data,
        )
        return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=["post"], url_path="change_case_status")
    def change_case_status_alias(self, request, pk=None):
        return self.change_status(request, pk=pk)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        obj = self.get_object()
        self.check_view(obj)
        kind = services.subject_kind(obj)
        transitions = models.StageTransitionHistory.objects.select_related("changed_by").filter(
            subject_type=kind, subject_id=obj.pk
        )
        assignments = obj.assignment_history.select_related("actor", "from_user", "to_user").all()
        reschedules = obj.reschedule_requests.select_related("requested_by", "decided_by").all()
        withdrawals = obj.withdrawal_requests.select_related("requested_by", "decided_by").all()
        reviews = []
        archived_appraisals = []
        if isinstance(obj, models.PropertyRegistrationRequest):
            reviews = serializers.PropertyReviewSerializer(
                obj.property_reviews.select_related("submitted_by", "reviewed_by", "property", "registration_request").all(),
                many=True,
            ).data
            appraisal = getattr(obj, "appraisal", None)
            if appraisal is not None:
                archived_appraisals = list(appraisal.archived_reports or [])
        return Response(
            {
                "assignments": serializers.AssignmentHistorySerializer(assignments, many=True).data,
                "transitions": [
                    {
                        "id": item.pk,
                        "from_stage": item.from_stage,
                        "to_stage": item.to_stage,
                        "reason": item.reason,
                        "actor_name": (item.changed_by.get_full_name() or item.changed_by.username)
                        if item.changed_by
                        else "سامانه",
                        "changed_at": item.changed_at,
                    }
                    for item in transitions
                ],
                "reviews": reviews,
                "reschedules": serializers.RescheduleSerializer(reschedules, many=True).data,
                "withdrawals": serializers.WithdrawalSerializer(withdrawals, many=True).data,
                "archived_appraisals": archived_appraisals,
            }
        )

    @action(detail=True, methods=["get"])
    def timeline(self, request, pk=None):
        obj = self.get_object()
        self.check_view(obj)
        is_property_case = isinstance(obj, models.PropertyRegistrationRequest)
        kind = services.subject_kind(obj)
        events = []

        def add(event_id, event_type, title, at, detail="", **extra):
            if at is None:
                return
            events.append({
                "id": str(event_id),
                "type": event_type,
                "title": title,
                "at": at,
                "detail": detail or "",
                **extra,
            })

        add(
            f"case-created-{obj.pk}",
            "case.created",
            "پرونده ایجاد شد",
            obj.created_at,
            obj.code,
        )
        for transition in models.StageTransitionHistory.objects.filter(
            subject_type=kind, subject_id=obj.pk
        ).select_related("changed_by"):
            add(
                f"stage-{transition.pk}",
                "stage.changed",
                "مرحله تغییر کرد",
                transition.changed_at,
                f"{transition.from_stage or '—'} ← {transition.to_stage or '—'} · {transition.reason}",
                actor=(transition.changed_by.get_full_name().strip() or transition.changed_by.username)
                if transition.changed_by else "",
            )

        assignment_filter = {"property_case": obj} if is_property_case else {"inquiry": obj}
        for history in models.AssignmentHistory.objects.filter(**assignment_filter).select_related(
            "actor", "from_user", "to_user"
        ):
            people = []
            if history.from_user:
                people.append(f"از: {history.from_user.get_full_name().strip() or history.from_user.username}")
            if history.to_user:
                people.append(f"به: {history.to_user.get_full_name().strip() or history.to_user.username}")
            if history.reason:
                people.append(history.reason)
            add(
                f"assignment-{history.pk}",
                "assignment." + history.action.lower(),
                history.get_action_display(),
                history.created_at,
                " · ".join(people),
                actor=(history.actor.get_full_name().strip() or history.actor.username)
                if history.actor else "",
            )

        if is_property_case:
            reviews = models.PropertyReview.objects.filter(
                registration_request=obj
            ).select_related("submitted_by", "reviewed_by")
            for review in reviews:
                add(
                    f"review-submitted-{review.pk}",
                    "review.submitted",
                    "نسخه برای بررسی ارسال شد",
                    review.submitted_at,
                    f"نسخه {review.version}",
                    actor=(review.submitted_by.get_full_name().strip() or review.submitted_by.username)
                    if review.submitted_by else "",
                )
                if review.reviewed_at:
                    add(
                        f"review-decided-{review.pk}",
                        "review.decided",
                        review.get_decision_display(),
                        review.reviewed_at,
                        review.reason,
                        actor=(review.reviewed_by.get_full_name().strip() or review.reviewed_by.username)
                        if review.reviewed_by else "",
                    )

        task_filter = {"property_case": obj} if is_property_case else {"inquiry": obj}
        for task in Task.objects.filter(**task_filter).select_related("assigned_to"):
            add(
                f"task-{task.pk}",
                "task",
                task.title,
                task.updated_at,
                task.description or task.note,
                status=task.get_status_display(),
                due=task.due_date,
                assigned_to=(task.assigned_to.get_full_name().strip() or task.assigned_to.username)
                if task.assigned_to else "",
            )

        from apps.followups.models import FollowUp
        for followup in FollowUp.objects.filter(**task_filter).select_related("consultant"):
            add(
                f"followup-{followup.pk}",
                "followup",
                followup.title,
                followup.updated_at,
                followup.outcome or followup.notes or "",
                status=followup.get_status_display(),
                due=followup.scheduled_at,
                assigned_to=followup.consultant_name,
            )

        if not is_property_case:
            for introduction in models.Introduction.objects.filter(inquiry=obj).select_related("property_file"):
                add(
                    f"introduction-{introduction.pk}",
                    "introduction",
                    f"فایل معرفی شد: {introduction.property_file.title}",
                    introduction.created_at,
                    introduction.feedback,
                    status=introduction.get_status_display(),
                )
                for viewing in introduction.viewings.all().select_related("assigned_to"):
                    add(
                        f"viewing-{viewing.pk}",
                        "viewing",
                        "بازدید برنامه‌ریزی شد",
                        viewing.completed_at or viewing.scheduled_at,
                        viewing.notes,
                        status=viewing.get_result_display(),
                        due=viewing.scheduled_at,
                        assigned_to=(viewing.assigned_to.get_full_name().strip() or viewing.assigned_to.username)
                        if viewing.assigned_to else "",
                    )
            for deal in models.Deal.objects.filter(inquiry=obj).select_related("contract"):
                add(
                    f"deal-{deal.pk}",
                    "deal",
                    "مذاکره",
                    deal.closed_at or deal.started_at,
                    deal.closure_reason or deal.result_notes,
                    status=deal.get_stage_display(),
                )
                contract = getattr(deal, "contract", None)
                if contract:
                    add(
                        f"contract-{contract.pk}",
                        "contract",
                        f"قرارداد {contract.contract_number}",
                        contract.finalized_at or contract.created_at,
                        "",
                        status=contract.get_status_display(),
                    )

        events.sort(key=lambda item: item["at"], reverse=True)
        page = self.paginate_queryset(events)
        return self.get_paginated_response(page) if page is not None else Response(events)

    @action(detail=False, methods=["get"])
    def inbox(self, request):
        user = request.user
        qs = self.apply_list_query(self.get_queryset())
        items = []
        for obj in qs:
            if obj.status in (
                models.CaseStatus.CLOSED,
                models.CaseStatus.CANCELLED,
                models.CaseStatus.DUPLICATE,
            ):
                continue
            kind = None
            if obj.lead_status == models.LeadStatus.PENDING and (user_is_general_manager(user) or services.can_manage_sales_range(user, obj.sales_range_id)):
                kind = "LEAD_ACCEPTANCE"
            elif obj.acceptance_status == models.AcceptanceStatus.PENDING and obj.assigned_to_id == user.pk:
                kind = "ASSIGNMENT_ACCEPTANCE"
            elif obj.acceptance_status == models.AcceptanceStatus.WITHDRAWAL_PENDING and (user_is_general_manager(user) or services.can_manage_sales_range(user, obj.sales_range_id)):
                kind = "WITHDRAWAL_REVIEW"
            elif obj.reschedule_requests.filter(status=models.AssignmentRescheduleRequest.Status.PENDING).exists() and (user_is_general_manager(user) or services.can_manage_sales_range(user, obj.sales_range_id)):
                kind = "EXTENSION_REVIEW"
            if kind:
                data = self.get_serializer(obj).data
                data["inbox_kind"] = kind
                if kind == "WITHDRAWAL_REVIEW":
                    pending_request = obj.withdrawal_requests.filter(
                        status=models.ConsultantWithdrawalRequest.Status.PENDING
                    ).order_by("requested_at").first()
                    if pending_request:
                        data["workflow_request_id"] = pending_request.pk
                        data["request_reason"] = pending_request.reason
                elif kind == "EXTENSION_REVIEW":
                    pending_request = obj.reschedule_requests.filter(
                        status=models.AssignmentRescheduleRequest.Status.PENDING
                    ).order_by("requested_at").first()
                    if pending_request:
                        data["workflow_request_id"] = pending_request.pk
                        data["request_reason"] = pending_request.reason
                        data["requested_due_at"] = pending_request.requested_due_at
                items.append(data)
        page = self.paginate_queryset(items)
        return self.get_paginated_response(page) if page is not None else Response(items)

    @action(detail=False, methods=["get"])
    def pipeline(self, request):
        queryset = self.apply_list_query(self.get_queryset())
        page = self.paginate_queryset(queryset)
        subjects = page if page is not None else queryset
        data = []
        for obj in subjects:
            stage = pipeline_stage(obj)
            item = self.get_serializer(obj).data
            item["pipeline_stage"] = stage
            data.append(item)
        return self.get_paginated_response(data) if page is not None else Response(data)


class PropertyCaseViewSet(CaseMixin, CrmBase):
    allow_create = True
    search_fields = (
        "code",
        "contact__full_name",
        "contact__national_code",
        "contact__phones__phone",
        "property_title",
        "description",
        "assigned_to__username",
        "assigned_to__first_name",
        "assigned_to__last_name",
    )
    list_filter_fields = {
        "status": "status",
        "lead_status": "lead_status",
        "acceptance_status": "acceptance_status",
        "sales_range": "sales_range_id",
        "scope": "sales_range_id",
        "assigned_to": "assigned_to_id",
        "lead_source": "lead_source",
    }
    serializer_class = serializers.PropertyCaseSerializer
    queryset = (
        models.PropertyRegistrationRequest.objects.all()
        .select_related(
            "contact",
            "sales_range",
            "created_by",
            "lead_accepted_by",
            "assigned_to",
            "resulting_property",
            "resulting_property__district",
            "resulting_property__district__city",
            "resulting_property__property_type_ref",
            "resulting_property__property_usage",
            "appraisal",
        )
        .prefetch_related(
            "contact__phones",
            "desired_deal_types",
            "reschedule_requests",
            "withdrawal_requests",
            "resulting_property__property_files__deal_type",
            "resulting_property__contact_links__contact__phones",
        )
    )

    def get_queryset(self):
        qs = self.scoped_queryset(super().get_queryset())
        stage = (self.request.query_params.get("stage") or "").strip().lower()
        closed_q = Q(
            status__in=(
                models.CaseStatus.CLOSED,
                models.CaseStatus.CANCELLED,
                models.CaseStatus.DUPLICATE,
            )
        )
        if stage == "closed":
            qs = qs.filter(closed_q)
        elif stage == "reception":
            qs = qs.exclude(closed_q).filter(lead_status=models.LeadStatus.PENDING)
        elif stage == "assignment":
            qs = qs.exclude(closed_q).filter(lead_status=models.LeadStatus.ACCEPTED).filter(
                Q(acceptance_status__in=(models.AcceptanceStatus.UNASSIGNED, models.AcceptanceStatus.REJECTED))
                | Q(assigned_to__isnull=True)
            )
        elif stage == "acceptance":
            qs = qs.exclude(closed_q).filter(
                lead_status=models.LeadStatus.ACCEPTED,
                acceptance_status=models.AcceptanceStatus.PENDING,
                assigned_to__isnull=False,
            )
        elif stage == "review":
            qs = qs.exclude(closed_q).filter(
                lead_status=models.LeadStatus.ACCEPTED,
                acceptance_status__in=(models.AcceptanceStatus.ACCEPTED, models.AcceptanceStatus.WITHDRAWAL_PENDING),
                resulting_property__review_status=Property.ReviewStatus.PENDING,
            )
        elif stage == "listing":
            qs = qs.exclude(closed_q).filter(
                lead_status=models.LeadStatus.ACCEPTED,
                acceptance_status__in=(models.AcceptanceStatus.ACCEPTED, models.AcceptanceStatus.WITHDRAWAL_PENDING),
                resulting_property__review_status=Property.ReviewStatus.APPROVED,
            )
        elif stage == "appraisal":
            qs = qs.exclude(closed_q).filter(
                lead_status=models.LeadStatus.ACCEPTED,
                acceptance_status__in=(models.AcceptanceStatus.ACCEPTED, models.AcceptanceStatus.WITHDRAWAL_PENDING),
            ).filter(
                Q(resulting_property__isnull=True)
                | ~Q(resulting_property__review_status__in=(Property.ReviewStatus.PENDING, Property.ReviewStatus.APPROVED))
            )
        return qs

    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.property_case.create")
    def create(self, request, *args, **kwargs):
        case = services.create_property_case(request.user, request.data)
        refreshed = self.get_queryset().get(pk=case.pk)
        return Response(self.get_serializer(refreshed).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.property_case.review_legacy")
    def review_legacy(self, request, pk=None):
        require_permission(request.user, "case.assign")
        obj = self.get_object()
        self.check_view(obj)
        if not obj.is_legacy:
            raise ValidationError({"legacy_review_status": "این پرونده از داده‌های قدیمی انتقال نیافته است."})
        review_status = request.data.get("legacy_review_status", models.LegacyReviewStatus.REVIEWED)
        if review_status not in (models.LegacyReviewStatus.NEEDS_REVIEW, models.LegacyReviewStatus.REVIEWED):
            raise ValidationError({"legacy_review_status": "وضعیت بازبینی معتبر نیست."})
        notes = _text(request.data.get("notes", obj.legacy_review_notes), "notes", max_length=5000)
        obj.legacy_review_status = review_status
        obj.legacy_review_notes = notes
        obj.legacy_reviewed_by = request.user if review_status == models.LegacyReviewStatus.REVIEWED else None
        obj.legacy_reviewed_at = timezone.now() if review_status == models.LegacyReviewStatus.REVIEWED else None
        obj.save(update_fields=["legacy_review_status", "legacy_review_notes", "legacy_reviewed_by", "legacy_reviewed_at", "updated_at"])
        return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.property_case.set_title")
    def set_title(self, request, pk=None):
        obj = models.PropertyRegistrationRequest.objects.select_for_update().get(pk=self.get_object().pk)
        self.check_view(obj)
        services.set_property_title(
            obj,
            request.user,
            request.data.get("property_title"),
            reason=request.data.get("reason", ""),
            payload=request.data,
        )
        refreshed = self.get_queryset().get(pk=obj.pk)
        return Response(self.get_serializer(refreshed).data)

    @action(detail=True, methods=["post"], url_path="set_property_title")
    def set_property_title_alias(self, request, pk=None):
        return self.set_title(request, pk=pk)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.property_case.save_workspace")
    def save_workspace(self, request, pk=None):
        require_permission(request.user, "case.appraise")
        obj = models.PropertyRegistrationRequest.objects.select_for_update().get(pk=self.get_object().pk)
        self.check_view(obj)
        services.save_workspace(obj, request.user, request.data)
        refreshed = self.get_queryset().get(pk=obj.pk)
        case_data = self.get_serializer(refreshed).data
        appraisal_data = (
            serializers.PropertyAppraisalSerializer(refreshed.appraisal).data
            if getattr(refreshed, "appraisal", None)
            else None
        )
        return Response(
            {
                **case_data,
                "case": case_data,
                "property_id": refreshed.resulting_property_id,
                "appraisal": appraisal_data,
            }
        )

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.property_case.submit_review")
    def submit_review(self, request, pk=None):
        obj = models.PropertyRegistrationRequest.objects.select_for_update(of=("self",)).select_related("resulting_property", "appraisal").get(pk=self.get_object().pk)
        self.check_view(obj)
        review = services.submit_property_for_review(obj, request.user, payload=request.data)
        return Response(serializers.PropertyReviewSerializer(review).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="submit_property_for_review")
    def submit_property_for_review_alias(self, request, pk=None):
        return self.submit_review(request, pk=pk)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.property_case.review")
    def review(self, request, pk=None):
        obj = models.PropertyRegistrationRequest.objects.select_for_update(of=("self",)).select_related("resulting_property").get(pk=self.get_object().pk)
        self.check_view(obj)
        review_obj = services.review_property(obj, request.user, request.data)
        return Response(serializers.PropertyReviewSerializer(review_obj).data)

    @action(detail=True, methods=["post"], url_path="review_property")
    def review_property_alias(self, request, pk=None):
        return self.review(request, pk=pk)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.property_case.reopen_appraisal")
    def reopen_appraisal(self, request, pk=None):
        obj = models.PropertyRegistrationRequest.objects.select_for_update().get(pk=self.get_object().pk)
        self.check_view(obj)
        services.reopen_appraisal(
            obj,
            request.user,
            request.data.get("reason", ""),
            payload=request.data,
        )
        refreshed = self.get_queryset().get(pk=obj.pk)
        return Response(self.get_serializer(refreshed).data)


class InquiryViewSet(CaseMixin, CrmBase):
    allow_create = True
    search_fields = ("code", "contact__full_name", "contact__national_code", "contact__phones__phone", "description", "assigned_to__username")
    list_filter_fields = {"status": "status", "lead_status": "lead_status", "acceptance_status": "acceptance_status", "sales_range": "sales_range_id", "assigned_to": "assigned_to_id"}
    serializer_class = serializers.InquirySerializer
    queryset = models.Inquiry.objects.all().select_related("contact", "sales_range", "assigned_to").prefetch_related("preferences")

    def get_queryset(self):
        return self.scoped_queryset(super().get_queryset(), "inquiry.view")

    def apply_list_query(self, queryset):
        queryset = super().apply_list_query(queryset)
        params = self.request.query_params
        deal_type = str(params.get("deal_type", "")).strip()
        if deal_type:
            if not deal_type.isdigit():
                raise ValidationError({"deal_type": "نوع معامله انتخاب‌شده معتبر نیست."})
            queryset = queryset.filter(preferences__deal_type_id=int(deal_type)).distinct()
        for parameter, lookup in (("created_after", "created_at__date__gte"), ("created_before", "created_at__date__lte")):
            raw = str(params.get(parameter, "")).strip()
            if not raw:
                continue
            try:
                date.fromisoformat(raw)
            except ValueError:
                raise ValidationError({parameter: "تاریخ فیلتر معتبر نیست."})
            queryset = queryset.filter(**{lookup: raw})
        return queryset

    def create(self, request, *args, **kwargs):
        def run():
            inquiry = inquiry_workflow.create_inquiry(request.user, request.data)
            return Response(serializers.InquirySerializer(inquiry, context=self.get_serializer_context()).data, status=status.HTTP_201_CREATED)

        return execute_idempotently(request, "crm.inquiry.create", run)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.inquiry.save_needs")
    def save_needs(self, request, pk=None):
        require_permission(request.user, "inquiry.manage")
        inquiry = inquiry_workflow.save_inquiry_needs(self.get_object().pk, request.user, request.data)
        return Response(serializers.InquirySerializer(inquiry, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["get"])
    def matches(self, request, pk=None):
        inquiry = self.get_object()
        self.check_view(inquiry)
        return Response(inquiry_workflow.match_listings(inquiry.pk, user=request.user))

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.inquiry.introduce")
    def introduce(self, request, pk=None):
        require_permission(request.user, "introduction.manage")
        intro, created = inquiry_workflow.introduce_listing(self.get_object().pk, request.user, request.data)
        return Response(
            serializers.IntroductionSerializer(intro).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class WithdrawalViewSet(CrmBase):
    search_fields = ("property_case__code", "inquiry__code", "requested_by__username", "reason", "status")
    list_filter_fields = {"status": "status"}
    serializer_class = serializers.WithdrawalSerializer
    queryset = models.ConsultantWithdrawalRequest.objects.all()

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if user_is_general_manager(user):
            return qs
        return qs.filter(Q(requested_by=user) | Q(property_case__sales_range_id__in=services.managed_sales_range_ids(user) or set()) | Q(inquiry__sales_range_id__in=services.managed_sales_range_ids(user) or set()))

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.withdrawal.decide")
    def decide(self, request, pk=None):
        visible_req = self.get_object()
        subject_model = models.PropertyRegistrationRequest if visible_req.property_case_id else models.Inquiry
        subject_id = visible_req.property_case_id or visible_req.inquiry_id
        subject_model.objects.select_for_update().get(pk=subject_id)
        req = models.ConsultantWithdrawalRequest.objects.select_for_update().get(pk=visible_req.pk)
        approve = request.data.get("approve")
        if not isinstance(approve, bool):
            raise ValidationError({"approve": "تصمیم باید درست یا نادرست باشد."})
        services.review_withdrawal(req, request.user, approve, request.data.get("reason", ""))
        return Response(serializers.WithdrawalSerializer(req).data)


class RescheduleViewSet(CrmBase):
    search_fields = ("property_case__code", "inquiry__code", "requested_by__username", "reason", "status")
    list_filter_fields = {"status": "status"}
    serializer_class = serializers.RescheduleSerializer
    queryset = models.AssignmentRescheduleRequest.objects.all()

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if user_is_general_manager(user):
            return qs
        return qs.filter(Q(requested_by=user) | Q(property_case__sales_range_id__in=services.managed_sales_range_ids(user) or set()) | Q(inquiry__sales_range_id__in=services.managed_sales_range_ids(user) or set()))

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.reschedule.decide")
    def decide(self, request, pk=None):
        visible_req = self.get_object()
        subject_model = models.PropertyRegistrationRequest if visible_req.property_case_id else models.Inquiry
        subject_id = visible_req.property_case_id or visible_req.inquiry_id
        subject_model.objects.select_for_update().get(pk=subject_id)
        req = models.AssignmentRescheduleRequest.objects.select_for_update().get(pk=visible_req.pk)
        approve = request.data.get("approve")
        if not isinstance(approve, bool):
            raise ValidationError({"approve": "تصمیم باید درست یا نادرست باشد."})
        services.review_extension(req, request.user, approve, request.data.get("reason", ""))
        return Response(serializers.RescheduleSerializer(req).data)


class IntroductionViewSet(CrmBase):
    search_fields = ("property_file__title", "inquiry__code", "inquiry__contact__full_name", "feedback", "status")
    list_filter_fields = {"status": "status", "inquiry": "inquiry_id", "property_file": "property_file_id"}
    serializer_class = serializers.IntroductionSerializer
    queryset = models.Introduction.objects.all().select_related("inquiry", "property_file")

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if user_is_general_manager(user):
            return qs
        if not has_permission(user, "introduction.manage"):
            return qs.none()
        ids = services.scope_team_ids(user) or set()
        sales_range_ids = services.user_sales_range_ids(user) or set()
        scope = (
            Q(inquiry__assigned_to_id__in=ids)
            | Q(buyer_consultant_id__in=ids)
            | Q(seller_consultant_id__in=ids)
            | Q(introduced_by_id__in=ids)
        )
        if sales_range_ids:
            scope |= Q(inquiry__sales_range_id__in=sales_range_ids)
        return qs.filter(scope).distinct()

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.introduction.feedback")
    def feedback(self, request, pk=None):
        require_permission(request.user, "introduction.manage")
        intro = inquiry_workflow.update_introduction(self.get_object().pk, request.user, request.data)
        return Response(serializers.IntroductionSerializer(intro).data)


class ViewingViewSet(CrmBase):
    allow_create = True
    search_fields = ("introduction__inquiry__code", "introduction__property_file__title", "notes", "result")
    list_filter_fields = {"result": "result", "assigned_to": "assigned_to_id", "inquiry": "introduction__inquiry_id"}
    serializer_class = serializers.ViewingSerializer
    queryset = models.Viewing.objects.all().select_related("introduction")

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if user_is_general_manager(user):
            return qs
        if not has_permission(user, "viewing.manage"):
            return qs.none()
        ids = services.scope_team_ids(user) or set()
        sales_range_ids = services.user_sales_range_ids(user) or set()
        scope = (
            Q(assigned_to_id__in=ids)
            | Q(introduction__buyer_consultant_id__in=ids)
            | Q(introduction__seller_consultant_id__in=ids)
            | Q(introduction__introduced_by_id__in=ids)
        )
        if sales_range_ids:
            scope |= Q(introduction__inquiry__sales_range_id__in=sales_range_ids)
        return qs.filter(scope).distinct()

    def create(self, request, *args, **kwargs):
        def run():
            viewing, created = inquiry_workflow.schedule_viewing(request.user, request.data)
            return Response(
                serializers.ViewingSerializer(viewing, context=self.get_serializer_context()).data,
                status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
            )

        return execute_idempotently(request, "crm.viewing.create", run)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.viewing.complete")
    def complete(self, request, pk=None):
        require_permission(request.user, "viewing.manage")
        viewing, _ = inquiry_workflow.complete_viewing(self.get_object().pk, request.user, request.data)
        return Response(serializers.ViewingSerializer(viewing).data)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.viewing.start_deal")
    def start_deal(self, request, pk=None):
        require_permission(request.user, "deal.manage")
        payload = request.data.copy()
        payload["viewing"] = self.get_object().pk
        deal, created = inquiry_workflow.create_deal(request.user, payload)
        return Response(
            serializers.DealSerializer(deal, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class DealViewSet(CrmBase):
    allow_create = True
    search_fields = ("inquiry__code", "inquiry__contact__full_name", "property_file__title", "assigned_to__username", "stage")
    list_filter_fields = {"stage": "stage", "assigned_to": "assigned_to_id", "inquiry": "inquiry_id"}
    serializer_class = serializers.DealSerializer
    queryset = models.Deal.objects.all().select_related("introduction", "property_file", "inquiry").prefetch_related("participants__contact")

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if user_is_general_manager(user):
            return qs
        if not (has_permission(user, "deal.manage") or has_permission(user, "pipeline.view")):
            return qs.none()
        ids = services.scope_team_ids(user)
        if ids is None:
            return qs
        return qs.filter(Q(assigned_to_id__in=ids) | Q(introduction__buyer_consultant_id__in=ids) | Q(introduction__seller_consultant_id__in=ids)).distinct()

    def create(self, request, *args, **kwargs):
        def run():
            deal, created = inquiry_workflow.create_deal(request.user, request.data)
            return Response(
                serializers.DealSerializer(deal, context=self.get_serializer_context()).data,
                status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
            )

        return execute_idempotently(request, "crm.deal.create", run)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.deal.succeed")
    def succeed(self, request, pk=None):
        require_permission(request.user, "deal.manage")
        deal, _ = inquiry_workflow.succeed_deal(self.get_object().pk, request.user, request.data)
        return Response(serializers.DealSerializer(deal).data)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.deal.close")
    def close(self, request, pk=None):
        require_permission(request.user, "deal.manage")
        deal, _ = inquiry_workflow.close_deal(self.get_object().pk, request.user, request.data)
        return Response(serializers.DealSerializer(deal).data)

    @action(detail=True, methods=["get", "post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.deal.participants")
    def participants(self, request, pk=None):
        deal = self.get_object()
        if request.method == "POST":
            require_permission(request.user, "deal.manage")
            participant = add_deal_participant(deal, request.data, request.user)
            return Response(serializers.DealParticipantSerializer(participant).data, status=status.HTTP_201_CREATED)
        return Response(serializers.DealParticipantSerializer(deal.participants.all(), many=True).data)


def require_general_manager(user):
    if not user_is_general_manager(user):
        raise PermissionDenied("دسترسی قرارداد فقط برای مدیر کل است.")


class ContractViewSet(CrmBase):
    allow_create = True
    search_fields = ("contract_number", "deal__inquiry__code", "deal__inquiry__contact__full_name", "status")
    list_filter_fields = {"status": "status", "deal": "deal_id", "inquiry": "deal__inquiry_id"}
    serializer_class = serializers.ContractSerializer
    queryset = (
        models.Contract.objects.all()
        .select_related("deal__inquiry__contact", "deal__property_file__property", "deal_type_version__deal_type")
        .prefetch_related("parties__signature", "parties__contact", "attachments", "amendments")
    )

    def get_serializer_class(self):
        if not user_is_general_manager(self.request.user):
            return serializers.FinanceContractSerializer
        return super().get_serializer_class()

    def list(self, request, *args, **kwargs):
        if not (user_is_general_manager(request.user) or has_permission(request.user, "finance.view")):
            raise PermissionDenied("شما اجازه مشاهده قراردادها را ندارید.")
        return super().list(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        if not (user_is_general_manager(request.user) or has_permission(request.user, "finance.view")):
            raise PermissionDenied("شما اجازه مشاهده قراردادها را ندارید.")
        return super().retrieve(request, *args, **kwargs)

    def get_queryset(self):
        if user_is_general_manager(self.request.user):
            return super().get_queryset()
        if has_permission(self.request.user, "finance.view"):
            return super().get_queryset().filter(pk__in=scoped_contract_queryset(self.request.user).values("pk"))
        return super().get_queryset().none()

    def create(self, request, *args, **kwargs):
        require_general_manager(request.user)
        deal_id = request.data.get("deal") or request.data.get("deal_id")

        def run():
            contract, created = inquiry_workflow.create_contract(deal_id, request.user, request.data)
            return Response(
                serializers.ContractSerializer(contract, context=self.get_serializer_context()).data,
                status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
            )

        return execute_idempotently(request, "crm.contract.create", run)

    @action(detail=True, methods=["get", "post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.contract.parties")
    def parties(self, request, pk=None):
        contract = self.get_object()
        if request.method == "GET":
            require_general_manager(request.user)
            return Response(serializers.ContractPartySerializer(contract.parties.select_related("contact"), many=True).data)
        require_general_manager(request.user)
        if contract.status == models.Contract.Status.FINALIZED:
            raise ValidationError({"status": "پس از قطعی‌شدن قرارداد، طرف جدید افزوده نمی‌شود."})
        contact = get_object_or_404(models.Contact, pk=request.data.get("contact"))
        party_role = str(request.data.get("party_role") or "").strip()
        if party_role not in models.DealParticipant.Role.values:
            raise ValidationError({"party_role": "نقش طرف قرارداد معتبر نیست."})
        party, _ = models.ContractParty.objects.get_or_create(
            contract=contract,
            contact=contact,
            party_role=party_role,
            defaults={"identity_snapshot": {"full_name": contact.full_name, "national_code": contact.national_code}},
        )
        models.ContractSignature.objects.get_or_create(contract_party=party)
        contract.version += 1
        contract.save(update_fields=["version", "updated_at"])
        return Response(serializers.ContractPartySerializer(party).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get", "post"], url_path="signatures")
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.contract.signatures")
    def signatures(self, request, pk=None):
        contract = self.get_object()
        require_general_manager(request.user)
        if request.method == "GET":
            rows = [
                {
                    "id": signature.pk,
                    "contract_party": signature.contract_party_id,
                    "contact_name": signature.contract_party.contact.full_name,
                    "party_role": signature.contract_party.party_role,
                    "status": signature.status,
                    "signed_at": signature.signed_at,
                    "recorded_by": signature.recorded_by_id,
                }
                for signature in models.ContractSignature.objects.filter(contract_party__contract=contract).select_related("contract_party__contact")
            ]
            return Response(rows)
        contract = inquiry_workflow.sign_contract(contract.pk, request.user, request.data)
        return Response(serializers.ContractSerializer(contract).data)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.contract.save_terms")
    def save_terms(self, request, pk=None):
        require_general_manager(request.user)
        contract = inquiry_workflow.save_contract_terms(self.get_object().pk, request.user, request.data)
        return Response(serializers.ContractSerializer(contract).data)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.contract.manual_sign")
    def sign(self, request, pk=None):
        require_general_manager(request.user)
        contract = inquiry_workflow.sign_contract(self.get_object().pk, request.user, request.data)
        return Response(serializers.ContractSerializer(contract).data)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.contract.add_attachment")
    def add_attachment(self, request, pk=None):
        require_general_manager(request.user)
        contract = self.get_object()
        upload = validate_contract_attachment(request.FILES.get("file"))
        document_type = str(request.data.get("document_type") or "").strip()
        if len(document_type) > 80:
            raise ValidationError({"document_type": "نوع مدرک حداکثر ۸۰ نویسه است."})
        attachment = models.ContractAttachment.objects.create(
            contract=contract,
            document_type=document_type,
            file=upload,
            filename=upload.name,
            uploaded_by=request.user,
        )
        return Response(serializers.ContractAttachmentSerializer(attachment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get", "post"], url_path="amendments")
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.contract.amendments")
    def amendments(self, request, pk=None):
        contract = self.get_object()
        require_general_manager(request.user)
        if request.method == "GET":
            return Response(serializers.ContractAmendmentSerializer(contract.amendments.all(), many=True).data)
        amendment = inquiry_workflow.create_amendment(contract.pk, request.user, request.data)
        return Response(serializers.ContractAmendmentSerializer(amendment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.contract.add_amendment")
    def add_amendment(self, request, pk=None):
        require_general_manager(request.user)
        amendment = inquiry_workflow.create_amendment(self.get_object().pk, request.user, request.data)
        return Response(serializers.ContractAmendmentSerializer(amendment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.contract.finalize")
    def finalize(self, request, pk=None):
        require_general_manager(request.user)
        contract, _ = inquiry_workflow.finalize_contract(self.get_object().pk, request.user)
        return Response(serializers.ContractSerializer(contract).data)


class CommissionPolicyViewSet(CrmBase):
    allow_create = True
    search_fields = ("name", "deal_type__display_name", "status")
    list_filter_fields = {"status": "status", "deal_type": "deal_type_id"}
    serializer_class = serializers.CommissionPolicySerializer
    queryset = models.CommissionPolicyVersion.objects.all()

    def get_queryset(self):
        if not (
            has_permission(self.request.user, "finance.view")
            or has_permission(self.request.user, "finance.policy")
            or user_is_general_manager(self.request.user)
        ):
            return super().get_queryset().none()
        return super().get_queryset()

    def perform_create(self, serializer):
        require_permission(self.request.user, "finance.policy")
        serializer.save(
            created_by=self.request.user,
            status=models.CommissionPolicyVersion.Status.DRAFT,
            effective_from=None,
        )

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.commission_policy.publish")
    def publish(self, request, pk=None):
        require_permission(request.user, "finance.policy")
        policy = models.CommissionPolicyVersion.objects.select_for_update().get(
            pk=self.get_object().pk
        )
        if policy.status == models.CommissionPolicyVersion.Status.PUBLISHED:
            return Response(serializers.CommissionPolicySerializer(policy).data)
        if policy.status != models.CommissionPolicyVersion.Status.DRAFT:
            raise ValidationError({"status": "سیاست بایگانی‌شده قابل انتشار نیست."})
        parameters = policy.parameters
        if not isinstance(parameters, dict):
            raise ValidationError({"parameters": "پارامترهای سیاست باید یک شیء معتبر باشند."})
        if policy.calculation_method == models.CommissionPolicyVersion.CalculationMethod.PERCENT:
            percent = _finite_decimal(parameters.get("percent", "0"), "parameters")
            if percent <= 0 or percent > 100:
                raise ValidationError({"parameters": "درصد سیاست باید بیشتر از صفر و حداکثر ۱۰۰ باشد."})
        elif policy.calculation_method == models.CommissionPolicyVersion.CalculationMethod.FLAT:
            flat_amount = _finite_decimal(parameters.get("flat_amount", "0"), "parameters")
            if flat_amount <= 0:
                raise ValidationError({"parameters": "مبلغ ثابت سیاست باید مثبت باشد."})
        else:
            raise ValidationError({"calculation_method": "روش محاسبه سیاست معتبر نیست."})
        policy.status = models.CommissionPolicyVersion.Status.PUBLISHED
        policy.effective_from = policy.effective_from or timezone.now()
        policy.save(update_fields=["status", "effective_from"])
        return Response(serializers.CommissionPolicySerializer(policy).data)


class CommissionViewSet(CrmBase):
    search_fields = ("contract__contract_number", "debtor_contact__full_name", "status")
    list_filter_fields = {"status": "status"}
    serializer_class = serializers.CommissionSerializer
    queryset = models.Commission.objects.all().prefetch_related("shares", "allocations")

    def get_queryset(self):
        if not (
            has_permission(self.request.user, "finance.view")
            or user_is_general_manager(self.request.user)
        ):
            return super().get_queryset().none()
        return super().get_queryset().filter(
            pk__in=scoped_commission_queryset(self.request.user).values("pk")
        )

    @action(detail=False, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.commission.create")
    def create_from_contract(self, request):
        contract = get_object_or_404(
            scoped_contract_queryset(request.user)
            .select_for_update(of=("self",))
            .select_related("deal__property_file"),
            pk=request.data.get("contract"),
            status=models.Contract.Status.FINALIZED,
        )
        debtor = get_object_or_404(
            models.Contact.objects.filter(contract_parties__contract=contract),
            pk=request.data.get("debtor_contact"),
        )
        created = services.finance_workflow.create_commission(
            contract,
            debtor,
            request.user,
            {
                "policy_version": request.data.get("policy_version"),
                "base_amount": request.data.get("base_amount"),
                "final_amount": request.data.get("final_amount"),
                "due_at": _parse_datetime(request.data.get("due_at"), "due_at"),
                "shares": request.data.get("shares") or [],
            },
        )
        return Response(serializers.CommissionSerializer(created).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.commission.approve")
    def approve(self, request, pk=None):
        commission = scoped_commission_queryset(request.user).select_for_update().filter(
            pk=self.get_object().pk
        ).first()
        if commission is None:
            raise PermissionDenied("شما به این مطالبه دسترسی ندارید.")
        services.finance_workflow.approve_commission(commission, request.user, request.data)
        return Response(serializers.CommissionSerializer(commission).data)


class PaymentViewSet(CrmBase):
    allow_create = True
    search_fields = ("contact__full_name", "user__username", "status", "direction")
    list_filter_fields = {"status": "status", "direction": "direction"}
    serializer_class = serializers.PaymentSerializer
    queryset = models.Payment.objects.all().prefetch_related("allocations")

    def get_queryset(self):
        if not (
            has_permission(self.request.user, "finance.view")
            or user_is_general_manager(self.request.user)
        ):
            return super().get_queryset().none()
        return super().get_queryset().filter(
            pk__in=scoped_payment_queryset(self.request.user).values("pk")
        )

    @convert_errors
    @transaction.atomic
    def perform_create(self, serializer):
        payment = services.finance_workflow.record_payment(self.request.user, serializer.validated_data)
        serializer.instance = payment

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.payment.reverse")
    def reverse(self, request, pk=None):
        original = models.Payment.objects.select_for_update().get(pk=self.get_object().pk)
        reversal = services.finance_workflow.reverse_payment(original, request.user)
        return Response(serializers.PaymentSerializer(reversal).data, status=status.HTTP_201_CREATED)


class PropertyCrmViewSet(CrmBase):
    search_fields = ("title", "internal_code", "address", "neighborhood", "description")
    list_filter_fields = {
        "status": "status",
        "review_status": "review_status",
        "district": "district_id",
        "property_type": "property_type",
        "consultant": "consultant_id",
    }
    queryset = Property.objects.all()

    def get_serializer_class(self):
        from apps.properties.serializers import PropertyListSerializer, PropertySerializer

        return PropertyListSerializer if self.action == "list" else PropertySerializer

    def get_queryset(self):
        from django.db.models import Prefetch

        qs = (
            scoped_property_queryset(self.request.user)
            .select_related(
                "consultant",
                "property_type_ref",
                "property_usage",
                "district",
                "district__city",
                "district__city__province",
                "registration_case",
                "registration_case__appraisal",
            )
            .prefetch_related(
                Prefetch(
                    "contact_links",
                    queryset=models.PropertyParty.objects.select_related("contact").prefetch_related("contact__phones"),
                ),
                "images",
                "property_files__deal_type",
                "consultant__groups",
            )
        )
        responsibility = (self.request.query_params.get("responsibility") or "").strip().lower()
        if responsibility == "mine":
            qs = qs.filter(consultant_id=self.request.user.pk)
        return qs

    @action(detail=True, methods=["get", "post"], url_path="listings")
    @convert_errors
    def listings(self, request, pk=None):
        prop = self.get_object()
        from apps.listings.serializers import PropertyFileSerializer

        if request.method == "GET":
            items = prop.property_files.exclude(status=PropertyFile.Status.ARCHIVED).select_related("deal_type", "deal_type_version")
            return Response(PropertyFileSerializer(items, many=True, context=self.get_serializer_context()).data)
        with transaction.atomic():
            listing = services.save_listing(request.user, request.data, property_obj=prop)
        return Response(
            PropertyFileSerializer(listing, context=self.get_serializer_context()).data,
            status=status.HTTP_200_OK,
        )


class PropertyFileCrmViewSet(CrmBase):
    allow_create = True
    allow_update = True
    search_fields = ("title", "description", "property__title", "property__neighborhood", "property__internal_code")
    list_filter_fields = {"status": "status", "deal_type": "deal_type_id", "property": "property_id"}
    queryset = PropertyFile.objects.all().select_related("property", "deal_type", "deal_type_version")

    def get_serializer_class(self):
        from apps.listings.serializers import PropertyFileSerializer

        return PropertyFileSerializer

    def get_queryset(self):
        user = self.request.user
        if not (
            user_is_general_manager(user)
            or has_permission(user, "pipeline.view")
            or has_permission(user, "property_file.view")
            or has_permission(user, "property_file.create")
        ):
            return super().get_queryset().none()
        qs = scoped_property_file_queryset(user).select_related("property", "deal_type", "deal_type_version")
        responsibility = (self.request.query_params.get("responsibility") or "").strip().lower()
        if responsibility == "mine":
            qs = qs.filter(assigned_to_id=user.pk)
        return qs

    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.listing.create")
    def create(self, request, *args, **kwargs):
        from apps.listings.serializers import PropertyFileSerializer

        listing = services.save_listing(request.user, request.data)
        return Response(
            PropertyFileSerializer(listing, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.listing.update")
    def partial_update(self, request, *args, **kwargs):
        from apps.listings.serializers import PropertyFileSerializer

        instance = self.get_object()
        listing = services.save_listing(request.user, request.data, listing_instance=instance)
        return Response(PropertyFileSerializer(listing, context=self.get_serializer_context()).data)

    def update(self, request, *args, **kwargs):
        return self.partial_update(request, *args, **kwargs)

    @action(detail=True, methods=["get"], url_path="price-history")
    def price_history(self, request, pk=None):
        instance = self.get_object()
        items = instance.price_history.select_related("changed_by").order_by("-created_at", "-pk")
        return Response(
            [
                {
                    "id": row.pk,
                    "sale_price": str(row.sale_price) if row.sale_price is not None else None,
                    "deposit": str(row.deposit) if row.deposit is not None else None,
                    "monthly_rent": str(row.monthly_rent) if row.monthly_rent is not None else None,
                    "price_details": row.price_details or {},
                    "changed_by": row.changed_by_id,
                    "changed_by_name": (row.changed_by.get_full_name() or row.changed_by.username)
                    if row.changed_by
                    else "سامانه",
                    "changed_at": row.created_at,
                    "created_at": row.created_at,
                }
                for row in items
            ]
        )

    @action(detail=False, methods=["post"], url_path="save-property-file")
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.property_file.save")
    def save_property_file(self, request):
        from apps.listings.serializers import PropertyFileSerializer

        listing = services.save_listing(request.user, request.data)
        return Response(PropertyFileSerializer(listing, context=self.get_serializer_context()).data)

    @action(detail=False, methods=["post"], url_path="save_property_file")
    def save_property_file_underscore(self, request):
        return self.save_property_file(request)

    @action(detail=False, methods=["post"], url_path="save-listing")
    def save_listing_hyphen(self, request):
        return self.save_property_file(request)

    @action(detail=False, methods=["post"], url_path="save_listing")
    def save_listing_underscore(self, request):
        return self.save_property_file(request)

    @action(detail=False, methods=["get"], permission_classes=[])
    @convert_errors
    def explore(self, request):
        qs = services.explore_listings_queryset(request.query_params)
        page = self.paginate_queryset(qs)
        items = page if page is not None else qs[:200]
        data = serializers.ExploreListingSerializer(items, many=True, context=self.get_serializer_context()).data
        return self.get_paginated_response(data) if page is not None else Response(data)


class ExploreCrmViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = []
    authentication_classes = []
    serializer_class = serializers.ExploreListingSerializer
    pagination_class = CrmListPagination

    def get_queryset(self):
        return services.explore_listings_queryset(self.request.query_params)

    @convert_errors
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)


class PropertyReviewQueueViewSet(CrmBase):
    permission_map = {
        "list": "crm.property.review",
        "retrieve": "crm.property.review",
        "decide": "crm.property.review",
    }
    search_fields = (
        "property__title",
        "property__internal_code",
        "registration_request__code",
        "registration_request__property_title",
        "submitted_by__username",
    )
    list_filter_fields = {"decision": "decision", "property": "property_id"}
    serializer_class = serializers.PropertyReviewSerializer
    queryset = models.PropertyReview.objects.all().select_related(
        "property",
        "property__district",
        "property__district__city",
        "property__property_type_ref",
        "property__consultant",
        "registration_request",
        "registration_request__sales_range",
        "registration_request__assigned_to",
        "registration_request__appraisal",
        "submitted_by",
        "reviewed_by",
    )

    def get_queryset(self):
        user = self.request.user
        managed_ids = services.managed_sales_range_ids(user)
        if not user_is_general_manager(user) and not managed_ids:
            raise PermissionDenied("فقط مدیر رنج یا مدیر ارشد به صف تأیید ملک دسترسی دارد.")
        qs = super().get_queryset()
        if not user_is_general_manager(user):
            qs = qs.filter(registration_request__sales_range_id__in=managed_ids)
        decision = (self.request.query_params.get("decision") or "").strip().upper()
        if decision == "ALL":
            return qs
        if decision:
            return qs.filter(decision=decision)
        return qs.filter(decision=models.PropertyReview.Decision.PENDING)

    @action(detail=True, methods=["post"])
    @convert_errors
    @transaction.atomic
    @idempotent_action("crm.review.decide")
    def decide(self, request, pk=None):
        review_item = self.get_object()
        if not review_item.registration_request_id:
            raise ValidationError({"review": "این رکورد بررسی به پرونده ثبت ملک متصل نیست."})
        case = (
            models.PropertyRegistrationRequest.objects.select_for_update(of=("self",))
            .select_related("resulting_property")
            .get(pk=review_item.registration_request_id)
        )
        payload = dict(request.data)
        if "version" not in payload:
            payload["version"] = review_item.version
        decided = services.review_property(case, request.user, payload)
        return Response(serializers.PropertyReviewSerializer(decided).data)


class DashboardViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=["get"])
    @convert_errors
    def summary(self, request):
        return Response(services.pipeline_board.dashboard_summary(request.user, request.query_params))

    @action(detail=False, methods=["get"])
    @convert_errors
    def reports(self, request):
        return Response(services.pipeline_board.reports_bundle(request.user, request.query_params))


class ReportsViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    @convert_errors
    def list(self, request):
        return Response(services.pipeline_board.reports_bundle(request.user, request.query_params))


class PipelinesViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def list(self, request):
        return Response({"available": services.pipeline_board.pipeline_definitions(request.user)})

    @action(detail=False, methods=["get"], url_path=r"(?P<kind>[a-z]+)")
    @convert_errors
    def board(self, request, kind=None):
        filters = {
            "assignee": request.query_params.get("assignee", ""),
            "scope": request.query_params.get("scope", ""),
            "deal_type": request.query_params.get("deal_type", ""),
            "priority": request.query_params.get("priority", ""),
            "search": request.query_params.get("search", ""),
            "mine": request.query_params.get("mine", ""),
            "unassigned": request.query_params.get("unassigned", ""),
            "overdue": request.query_params.get("overdue", ""),
        }
        return Response(services.pipeline_board.pipeline_board(request.user, kind, filters))


class FinanceViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def _guard(self, request):
        if not (
            has_permission(request.user, "finance.view")
            or user_is_general_manager(request.user)
        ):
            raise PermissionDenied("شما به بخش مالی دسترسی ندارید.")

    @action(detail=False, methods=["get"])
    @convert_errors
    def overview(self, request):
        self._guard(request)
        return Response(services.finance_workflow.finance_overview(request.user))

    @action(detail=False, methods=["get"], url_path=r"contracts/(?P<contract_id>[0-9]+)")
    @convert_errors
    def contract(self, request, contract_id=None):
        self._guard(request)
        contract = get_object_or_404(scoped_contract_queryset(request.user), pk=contract_id)
        return Response(services.finance_workflow.finance_contract_detail(contract, request.user))


class WorkflowSettingsViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=["get", "patch", "put"])
    def current(self, request):
        require_general_manager(request.user)
        instance = models.WorkflowSettings.load()
        if request.method == "GET":
            return Response(serializers.WorkflowSettingsSerializer(instance).data)
        serializer = serializers.WorkflowSettingsSerializer(instance, data=request.data, partial=request.method == "PATCH")
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        return Response(serializer.data)
