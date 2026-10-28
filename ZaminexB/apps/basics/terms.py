import re
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError


FIELD_DEFINITIONS = {
    "sale_price": ("ثمن معامله", "integer", "تومان"),
    "deposit": ("ودیعه", "integer", "تومان"),
    "monthly_rent": ("اجاره ماهانه", "integer", "تومان"),
    "down_payment": ("پیش‌پرداخت", "integer", "تومان"),
    "installments": ("شرح اقساط", "text", ""),
    "owner_share": ("سهم مالک", "decimal", "درصد"),
    "contribution": ("آورده", "text", ""),
    "exchange_asset": ("عوض معامله", "text", ""),
    "cash_difference": ("مابه‌التفاوت", "integer", "تومان"),
}
BEHAVIOR_FIELDS = {
    "SALE": ["sale_price"],
    "RENT": ["deposit", "monthly_rent"],
    "FULL_MORTGAGE": ["deposit"],
    "PRE_SALE": ["down_payment", "installments"],
    "PARTNERSHIP": ["owner_share", "contribution"],
    "EXCHANGE": ["exchange_asset", "cash_difference"],
}


def default_terms_schema(behavior):
    fields = []
    for key in BEHAVIOR_FIELDS.get(behavior, []):
        label, field_type, unit = FIELD_DEFINITIONS[key]
        fields.append({"key": key, "label": label, "type": field_type, "unit": unit, "required": True})
    return {"fields": fields}


def validate_terms_schema(schema):
    if not isinstance(schema, dict) or not isinstance(schema.get("fields"), list) or not schema["fields"]:
        raise ValidationError({"terms_schema": "تعریف حداقل یک فیلد شرایط الزامی است."})
    keys = set()
    for field in schema["fields"]:
        if not isinstance(field, dict):
            raise ValidationError({"terms_schema": "ساختار فیلد شرایط معتبر نیست."})
        key = field.get("key")
        if not isinstance(key, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", key) or key in keys:
            raise ValidationError({"terms_schema": "کلید فیلد باید معتبر و غیرتکراری باشد."})
        keys.add(key)
        if field.get("type") not in {"integer", "decimal", "text", "boolean", "date"}:
            raise ValidationError({"terms_schema": "نوع داده فیلد پشتیبانی نمی‌شود."})
        if not isinstance(field.get("required"), bool) or not isinstance(field.get("label"), str) or not field["label"].strip() or not isinstance(field.get("unit", ""), str):
            raise ValidationError({"terms_schema": "برچسب، واحد و الزام فیلد معتبر نیست."})
    return schema


def validate_terms(schema, terms):
    validate_terms_schema(schema)
    if not isinstance(terms, dict):
        raise ValidationError({"terms": "شرایط معامله باید یک شیء باشد."})
    allowed = {field["key"] for field in schema["fields"]}
    errors = {str(key): "این فیلد در تعریف شرایط معامله وجود ندارد." for key in set(terms) - allowed}
    for field in schema["fields"]:
        value = terms.get(field["key"])
        if value in (None, ""):
            if field["required"]:
                errors[field["key"]] = f"وارد کردن {field['label']} الزامی است."
            continue
        field_type = field["type"]
        if field_type in {"integer", "decimal"}:
            try:
                amount = Decimal(str(value))
                valid = not isinstance(value, bool) and amount.is_finite() and amount >= 0 and amount < Decimal("1e18")
                if field.get("unit") == "درصد":
                    valid = valid and amount <= 100
                if field_type == "integer":
                    valid = valid and amount == amount.to_integral_value()
                if not valid:
                    raise ValueError()
            except (InvalidOperation, TypeError, ValueError):
                errors[field["key"]] = "مقدار عددی در بازه مجاز وارد کنید."
        elif field_type == "boolean" and not isinstance(value, bool):
            errors[field["key"]] = "مقدار بله یا خیر معتبر نیست."
        elif field_type == "text" and not isinstance(value, str):
            errors[field["key"]] = "مقدار متنی معتبر نیست."
        elif field_type == "date":
            from datetime import date
            try:
                date.fromisoformat(value)
            except (TypeError, ValueError):
                errors[field["key"]] = "تاریخ معتبر نیست."
    if errors:
        raise ValidationError(errors)
    return terms
