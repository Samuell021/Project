from django.contrib import admin

from .models import (
    Attribute,
    AttributeCategory,
    City,
    District,
    Province,
    AttributeOption,
    DealType,
    DealTypeVersion,
    DealTypeAttribute,
    DealTypeSearchAttribute,
    PropertyType,
    PropertyTypeAttribute,
    PropertyTypeSearchAttribute,
    PropertyUsage,
)


class SoftDeleteAdmin(admin.ModelAdmin):
    def get_queryset(self, request):
        return self.model.all_objects.all()

    @admin.action(description="بازگردانی موارد انتخاب‌شده")
    def restore_selected(self, request, queryset):
        restored = 0
        for obj in queryset:
            if obj.deleted_at is not None:
                obj.restore()
                restored += 1
        self.message_user(request, f"{restored} مورد بازگردانی شد.")

    actions = ["restore_selected"]


class AttributeOptionInline(admin.TabularInline):
    model = AttributeOption
    extra = 0
    fields = ("value", "display_name", "sort_order", "is_active")


class PropertyTypeAttributeInline(admin.TabularInline):
    model = PropertyTypeAttribute
    extra = 0
    autocomplete_fields = ("attribute",)
    fields = ("attribute", "is_required", "sort_order", "is_active")


class PropertyTypeSearchAttributeInline(admin.TabularInline):
    model = PropertyTypeSearchAttribute
    extra = 0
    autocomplete_fields = ("attribute",)
    fields = ("attribute", "sort_order", "is_active")


class DealTypeVersionInline(admin.TabularInline):
    model = DealTypeVersion
    extra = 0
    fields = ("version_number", "family", "status", "published_at")
    readonly_fields = ("published_at",)


class DealTypeAttributeInline(admin.TabularInline):
    model = DealTypeAttribute
    extra = 0
    autocomplete_fields = ("attribute",)
    fields = ("attribute", "is_required", "sort_order", "is_active")


class DealTypeSearchAttributeInline(admin.TabularInline):
    model = DealTypeSearchAttribute
    extra = 0
    autocomplete_fields = ("attribute",)
    fields = ("attribute", "sort_order", "is_active")


@admin.register(PropertyUsage)
class PropertyUsageAdmin(SoftDeleteAdmin):
    list_display = ("display_name", "name", "sort_order", "is_active", "deleted_at")
    list_filter = ("is_active",)
    search_fields = ("name", "display_name")
    ordering = ("sort_order",)


@admin.register(PropertyType)
class PropertyTypeAdmin(SoftDeleteAdmin):
    list_display = (
        "display_name", "name", "property_usage", "sort_order", "is_active", "deleted_at",
    )
    list_filter = ("property_usage", "is_active")
    search_fields = ("name", "display_name")
    ordering = ("property_usage", "sort_order")
    inlines = [PropertyTypeAttributeInline, PropertyTypeSearchAttributeInline]


@admin.register(DealType)
class DealTypeAdmin(SoftDeleteAdmin):
    list_display = ("display_name", "name", "sort_order", "is_active", "deleted_at")
    list_filter = ("is_active",)
    search_fields = ("name", "display_name")
    ordering = ("sort_order",)
    inlines = [DealTypeVersionInline, DealTypeAttributeInline, DealTypeSearchAttributeInline]


@admin.register(AttributeCategory)
class AttributeCategoryAdmin(SoftDeleteAdmin):
    list_display = (
        "display_name", "name", "sort_order", "is_active", "deleted_at",
    )
    list_filter = ("is_active",)
    search_fields = ("name", "display_name")
    ordering = ("sort_order",)


@admin.register(Attribute)
class AttributeAdmin(SoftDeleteAdmin):
    list_display = (
        "display_name", "name", "entity", "data_type", "filter_type",
        "is_core", "is_facility", "is_active",
    )
    list_filter = ("entity", "data_type", "is_core", "is_facility", "is_active")
    search_fields = ("name", "display_name")
    ordering = ("entity", "sort_order")
    inlines = [AttributeOptionInline]
    readonly_fields = ("is_core", "core_field")


@admin.register(Province)
class ProvinceAdmin(SoftDeleteAdmin):
    list_display = ("display_name", "name", "sort_order", "is_active", "deleted_at")
    list_filter = ("is_active",)
    search_fields = ("name", "display_name")
    ordering = ("sort_order",)


@admin.register(City)
class CityAdmin(SoftDeleteAdmin):
    list_display = ("display_name", "province", "name", "sort_order", "is_active")
    list_filter = ("province", "is_active")
    search_fields = ("name", "display_name")
    ordering = ("province", "sort_order")
    autocomplete_fields = ("province",)


@admin.register(District)
class DistrictAdmin(SoftDeleteAdmin):
    list_display = ("display_name", "city", "name", "sort_order", "is_active")
    list_filter = ("city__province", "city", "is_active")
    search_fields = ("name", "display_name")
    ordering = ("city", "sort_order")
    autocomplete_fields = ("city",)


@admin.register(DealTypeVersion)
class DealTypeVersionAdmin(admin.ModelAdmin):
    list_display = ("deal_type", "version_number", "family", "status", "published_at", "created_by")
    list_filter = ("family", "status", "deal_type")
    search_fields = ("deal_type__name", "deal_type__display_name")
    autocomplete_fields = ("deal_type", "created_by")
    readonly_fields = ("created_at", "updated_at")

    def get_readonly_fields(self, request, obj=None):
        readonly = list(self.readonly_fields)
        if obj is not None and obj.status == DealTypeVersion.Status.PUBLISHED:
            readonly += [field.name for field in self.model._meta.fields if field.name not in readonly]
        return readonly

    def has_delete_permission(self, request, obj=None):
        if obj is not None and obj.status == DealTypeVersion.Status.PUBLISHED:
            return False
        return super().has_delete_permission(request, obj)
