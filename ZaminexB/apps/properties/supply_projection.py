from django.db import models
from django.db.models import OuterRef, Subquery


def supply_price_expression():
    from apps.listings.models import PropertyFile

    values = PropertyFile.objects.filter(property_id=OuterRef("pk"), sale_price__isnull=False).exclude(status="ARCHIVED").values("property_id").annotate(amount=models.Max("sale_price")).values("amount")[:1]
    return Subquery(values, output_field=models.DecimalField(max_digits=18, decimal_places=0))


class PropertyManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().annotate(price=supply_price_expression())


def read_price(prop):
    if "_computed_sale_price" in prop.__dict__:
        return prop.__dict__["_computed_sale_price"]
    if not prop.pk:
        return None
    return prop.property_files.exclude(status="ARCHIVED").aggregate(amount=models.Max("sale_price"))["amount"]


def write_price(prop, value):
    prop.__dict__["_initial_supply_price"] = value


def read_deal_type(prop):
    if not prop.pk:
        return prop.__dict__.get("_initial_deal_type", "")
    families = {item.deal_type.family for item in prop.property_files.all() if item.status != "ARCHIVED" and item.deal_type_id}
    if families & {"SALE", "PRE_SALE", "PARTNERSHIP", "EXCHANGE"}:
        return "SALE"
    return "RENT" if families & {"RENT", "FULL_MORTGAGE"} else ""


def write_deal_type(prop, value):
    prop.__dict__["_initial_deal_type"] = value


def save_initial_supply(prop):
    raw = prop.__dict__.pop("_initial_supply_price", None)
    if raw is None:
        return
    from decimal import Decimal

    from django.core.exceptions import ValidationError

    amount = Decimal(str(raw))
    if not amount.is_finite() or amount < 0 or amount != amount.to_integral_value() or amount >= Decimal("1e18"):
        raise ValidationError({"price": "مبلغ باید تومان صحیح نامنفی و در بازه مجاز باشد."})
    prop.legacy_data = {**prop.legacy_data, "pricing": {"price": str(amount), "deal_type": prop.__dict__.get("_initial_deal_type", "")}, "pricing_review_required": True}
    type(prop).objects.filter(pk=prop.pk).update(legacy_data=prop.legacy_data)
    prop.__dict__.pop("_computed_sale_price", None)
