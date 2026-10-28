from django.db import migrations
from django.utils import timezone


FAMILIES = {
    "sale": ("SALE", "فروش", ["sale_price"], ["BUYER", "SELLER"]),
    "sell": ("SALE", "فروش", ["sale_price"], ["BUYER", "SELLER"]),
    "rent": ("RENT", "اجاره", ["deposit", "monthly_rent"], ["TENANT", "LANDLORD"]),
    "lease": ("RENT", "اجاره", ["deposit", "monthly_rent"], ["TENANT", "LANDLORD"]),
    "full_mortgage": ("FULL_MORTGAGE", "رهن کامل", ["deposit"], ["TENANT", "LANDLORD"]),
    "mortgage": ("FULL_MORTGAGE", "رهن کامل", ["deposit"], ["TENANT", "LANDLORD"]),
    "pre_sale": ("PRE_SALE", "پیش‌فروش", ["sale_price"], ["BUYER", "SELLER"]),
    "presale": ("PRE_SALE", "پیش‌فروش", ["sale_price"], ["BUYER", "SELLER"]),
    "partnership": ("PARTNERSHIP", "مشارکت در ساخت", ["sale_price"], ["BUYER", "SELLER"]),
    "exchange": ("EXCHANGE", "معاوضه", ["sale_price"], ["BUYER", "SELLER"]),
    "swap": ("EXCHANGE", "معاوضه", ["sale_price"], ["BUYER", "SELLER"]),
}

DEFAULT_TYPES = [
    ("sale", "فروش"),
    ("rent", "رهن و اجاره"),
    ("full_mortgage", "رهن کامل"),
    ("pre_sale", "پیش‌فروش"),
    ("partnership", "مشارکت در ساخت"),
    ("exchange", "معاوضه"),
]


def forwards(apps, schema_editor):
    DealType = apps.get_model("basics", "DealType")
    DealTypeVersion = apps.get_model("basics", "DealTypeVersion")
    for deal_type in DealType.objects.filter(deleted_at__isnull=True):
        key = (deal_type.name or "").strip().lower()
        family, _, fields, roles = FAMILIES.get(key, ("SALE", "فروش", ["sale_price"], ["BUYER", "SELLER"]))
        if deal_type.family != family:
            deal_type.family = family
            deal_type.save(update_fields=["family"])
        DealTypeVersion.objects.get_or_create(
            deal_type=deal_type,
            version_number=1,
            defaults={"family": family, "financial_fields": fields, "required_roles": roles, "rules": {}, "status": "PUBLISHED", "published_at": timezone.now()},
        )


def backwards(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [("basics", "0005_dealtype_family_dealtypeversion")]
    operations = [migrations.RunPython(forwards, backwards)]
