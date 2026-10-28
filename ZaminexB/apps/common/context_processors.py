from .models import CompanySettings


def company_brand_theme(request):
    """Expose the allowlisted organization palette to every app shell."""
    theme = (
        CompanySettings.objects.filter(pk=1)
        .values_list("brand_theme", flat=True)
        .first()
    )
    valid_themes = {value for value, _label in CompanySettings.BrandTheme.choices}
    if theme not in valid_themes:
        theme = CompanySettings.BrandTheme.GREEN
    return {"company_brand_theme": theme}
