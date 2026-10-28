from django.contrib import admin
from .models import Property, PropertyAppraisalReport, PropertyImage
from apps.crm.models import PropertyParty


class PropertyImageInline(admin.TabularInline):
    model = PropertyImage
    extra = 1


class PropertyPartyInline(admin.TabularInline):
    model = PropertyParty
    extra = 0
    autocomplete_fields = ("contact",)


@admin.register(Property)
class PropertyAdmin(admin.ModelAdmin):
    readonly_fields = ("legacy_data", "internal_code", "review_version", "submitted_review_version", "review_requested_at")
    exclude = ("is_shared",)
    list_display = (
        "title",
        "internal_code",
        "consultant",
        "owner_first_name",
        "owner_last_name",
        "owner_phone",
        "property_type",
        "deal_type",
        "price",
        "status",
        "rejection_reason",
        "review_status",
        "review_requested_at",
        "created_at",
    )
    list_filter = (
        "property_type",
        "property_files__deal_type",
        "status",
        "review_status",
        "created_at",
    )
    search_fields = (
        "title",
        "internal_code",
        "address",
        "neighborhood",
        "contact_links__contact__full_name",
        "contact_links__contact__phones__phone",
        "rejection_reason",
        "consultant__username",
    )
    ordering = ("-created_at",)

    inlines = [PropertyImageInline, PropertyPartyInline]


@admin.register(PropertyImage)
class PropertyImageAdmin(admin.ModelAdmin):
    list_display = ["property", "sort_order", "id"]
    list_filter = ["property"]


@admin.register(PropertyAppraisalReport)
class PropertyAppraisalReportAdmin(admin.ModelAdmin):
    list_display = [
        "property",
        "original_filename",
        "file_size",
        "uploaded_by",
        "created_at",
    ]
    search_fields = [
        "property__title",
        "property__internal_code",
        "original_filename",
    ]
    list_filter = ["created_at"]
    ordering = ["-created_at"]
