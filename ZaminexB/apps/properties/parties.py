from django.db import transaction
from django.utils import timezone


def primary_owner(prop):
    if "_primary_owner_contact" not in prop.__dict__:
        contact = None
        if prop.pk:
            prefetched = getattr(prop, "_prefetched_objects_cache", {}).get("contact_links")
            if prefetched is not None:
                parties = sorted((item for item in prefetched if item.role == "OWNER" and item.ended_at is None), key=lambda item: (not item.is_primary, item.pk))
                party = parties[0] if parties else None
            else:
                party = prop.contact_links.select_related("contact").filter(role="OWNER", ended_at__isnull=True).order_by("-is_primary", "pk").first()
            contact = party.contact if party else None
        prop.__dict__["_primary_owner_contact"] = contact
    return prop.__dict__["_primary_owner_contact"]


def owner_value(prop, field):
    pending = prop.__dict__.get("_owner_updates", {})
    if field in pending:
        return pending[field]
    contact = primary_owner(prop)
    if contact is None:
        return ""
    if field == "owner_phone":
        phones = sorted(contact.phones.all(), key=lambda item: (not item.is_primary, item.pk))
        return phones[0].phone if phones else ""
    parts = contact.full_name.split(maxsplit=1)
    return parts[0] if field == "owner_first_name" else parts[1] if len(parts) > 1 else ""


def owner_field(field):
    def read(instance):
        return owner_value(instance, field)

    def write(instance, value):
        instance.__dict__.setdefault("_owner_updates", {})[field] = str(value or "").strip()

    return property(read, write)


@transaction.atomic
def save_owner_updates(prop):
    if not prop.__dict__.get("_owner_updates"):
        return
    from apps.crm.models import Contact, ContactPhone, PropertyParty
    from apps.crm.phones import normalize_phone

    values = {field: owner_value(prop, field) for field in ("owner_first_name", "owner_last_name", "owner_phone")}
    full_name = f"{values['owner_first_name']} {values['owner_last_name']}".strip()
    phone = values["owner_phone"]
    current = primary_owner(prop)
    current_phone = current.phones.order_by("-is_primary", "pk").first() if current else None
    if current and current.full_name == full_name and (current_phone.phone if current_phone else "") == phone:
        prop.__dict__.pop("_owner_updates", None)
        return
    if not full_name and not phone:
        PropertyParty.objects.filter(property=prop, role="OWNER", ended_at__isnull=True).update(ended_at=timezone.now(), is_primary=False)
        prop.__dict__.pop("_owner_updates", None)
        prop.__dict__["_primary_owner_contact"] = None
        return
    normalized = normalize_phone(phone) if phone else ""
    if phone and not normalized:
        from django.core.exceptions import ValidationError

        raise ValidationError({"owner_phone": "شماره تماس معتبر نیست."})
    contact = Contact.objects.create(full_name=full_name or phone, created_by_id=prop.consultant_id, is_legacy_placeholder=not bool(full_name), legacy_review_status="NEEDS_REVIEW" if not full_name else "NOT_REQUIRED")
    if phone:
        normalized = normalize_phone(phone)
        if normalized:
            ContactPhone.objects.create(contact=contact, phone=phone, is_primary=True)
    now = timezone.now()
    PropertyParty.objects.filter(property=prop, role="OWNER", ended_at__isnull=True).update(ended_at=now, is_primary=False)
    PropertyParty.objects.create(property=prop, contact=contact, role="OWNER", is_primary=True)
    prop.__dict__.pop("_owner_updates", None)
    prop.__dict__["_primary_owner_contact"] = contact
