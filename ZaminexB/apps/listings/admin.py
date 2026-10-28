from django.contrib import admin
from .models import PropertyFile, PropertyFilePriceHistory


@admin.register(PropertyFile)
class PropertyFileAdmin(admin.ModelAdmin):
    list_display = ("title", "property", "status", "publish_channel", "priority", "is_featured", "rejection_reason")
    list_filter = ("status", "publish_channel", "priority", "is_featured")
    search_fields = ("title", "property__title", "rejection_reason")


class PropertyFilePriceHistoryInline(admin.TabularInline):
    model = PropertyFilePriceHistory
    extra = 0
    fields = ("sale_price", "deposit", "monthly_rent", "price_details", "changed_by", "created_at")
    readonly_fields = fields
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


PropertyFileAdmin.inlines = [PropertyFilePriceHistoryInline]
PropertyFileAdmin.list_display = PropertyFileAdmin.list_display + ("deal_type", "assigned_to")
PropertyFileAdmin.list_filter = PropertyFileAdmin.list_filter + ("deal_type",)
PropertyFileAdmin.autocomplete_fields = ("property", "deal_type", "deal_type_version", "created_by", "assigned_to")


@admin.register(PropertyFilePriceHistory)
class PropertyFilePriceHistoryAdmin(admin.ModelAdmin):
    list_display = ("property_file", "sale_price", "deposit", "monthly_rent", "changed_by", "created_at")
    list_filter = ("created_at",)
    search_fields = ("property_file__title",)
    autocomplete_fields = ("property_file", "changed_by")
    readonly_fields = ("property_file", "sale_price", "deposit", "monthly_rent", "price_details", "changed_by", "created_at")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
