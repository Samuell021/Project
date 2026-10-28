from rest_framework import serializers

from .models import CompanySettings, District


class DistrictSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source="display_name", max_length=255)
    needs_location_review = serializers.BooleanField(read_only=True)
    class Meta:
        model = District
        fields = ["id", "name", "is_active", "created_at", "updated_at", "needs_location_review"]


class CompanySettingsSerializer(serializers.ModelSerializer):
    companyName = serializers.CharField(source="company_name")
    licenseNumber = serializers.CharField(
        source="license_number", required=False, allow_blank=True
    )
    brandTheme = serializers.ChoiceField(
        source="brand_theme",
        choices=CompanySettings.BrandTheme.choices,
        required=False,
    )

    class Meta:
        model = CompanySettings
        fields = ["companyName", "licenseNumber", "email", "phone", "address", "brandTheme", "updated_at"]
        read_only_fields = ["updated_at"]
