"""Keep the two homes of the physical property features in agreement.

Before the type-specific attribute migration (``0031``) the values of ``rooms``,
``floor`` and ``built_year`` lived in dedicated ``Property`` columns. They are
now dynamic attributes of the property type, and the columns are only searchable
mirrors that the legacy readers still query: the ``beds`` serializer field, the
analytics metrics, the CRM snapshots and the inquiry matcher.

Writing one home without the other is what made the same property report a
different room count in the registration form, the ``beds`` field and the
attribute list. Every write path therefore funnels through these helpers so both
homes are always updated together.
"""
from __future__ import annotations

LEGACY_FEATURE_FIELDS: dict[str, str] = {
    "rooms": "rooms",
    "floor": "floor",
    "built_year": "built_year",
}

_ROOMS = "rooms"


def _empty_column_value(name: str):
    """The column value that means "this feature is not set"."""
    return 0 if name == _ROOMS else None


def _as_integer(raw):
    if raw is None or raw == "":
        return None
    try:
        return int(str(raw).strip().replace(",", ""))
    except (TypeError, ValueError):
        return None


def linked_feature_names(property_type) -> set[str]:
    """The legacy features the given property type may store dynamically."""
    if property_type is None:
        return set()

    from apps.basics.models import Attribute

    return set(
        property_type.attribute_links.filter(
            is_active=True,
            attribute__is_active=True,
            attribute__deleted_at__isnull=True,
            attribute__entity=Attribute.Entity.PROPERTY,
            attribute__is_core=False,
            attribute__name__in=LEGACY_FEATURE_FIELDS,
        ).values_list("attribute__name", flat=True)
    )


def stored_feature_values(prop, names=None) -> dict[str, object]:
    """The dynamic values of the legacy features, keyed by attribute name."""
    from apps.basics.models import Attribute
    from apps.properties.models import PropertyAttributeValue

    wanted = list(LEGACY_FEATURE_FIELDS if names is None else names)
    if not wanted:
        return {}

    rows = PropertyAttributeValue.objects.filter(
        property=prop,
        attribute__entity=Attribute.Entity.PROPERTY,
        attribute__is_core=False,
        attribute__deleted_at__isnull=True,
        attribute__name__in=wanted,
    ).select_related("attribute")
    return {row.attribute.name: row.value for row in rows}


def mirror_feature_columns(prop, names=None) -> list[str]:
    """Copy the dynamic feature values into the legacy searchable columns."""
    wanted = [name for name in LEGACY_FEATURE_FIELDS if names is None or name in names]
    if not wanted:
        return []

    stored = stored_feature_values(prop, wanted)
    changed: list[str] = []
    for name in wanted:
        field = LEGACY_FEATURE_FIELDS[name]
        value = _as_integer(stored.get(name))
        if value is None:
            value = _empty_column_value(name)
        if getattr(prop, field) != value:
            setattr(prop, field, value)
            changed.append(field)

    if changed:
        prop.save(update_fields=[*changed, "updated_at"])
    return changed


def store_feature_value(prop, name: str, raw) -> bool:
    """Store a value that arrived through a legacy column as the dynamic one."""
    if name not in LEGACY_FEATURE_FIELDS:
        return False

    from apps.basics.models import Attribute
    from apps.properties.models import PropertyAttributeValue

    attribute = Attribute.objects.filter(
        name=name,
        entity=Attribute.Entity.PROPERTY,
        is_core=False,
        deleted_at__isnull=True,
    ).first()
    if attribute is None:
        return False

    row = PropertyAttributeValue.objects.filter(property=prop, attribute=attribute).first()
    if raw is None or raw == "":
        if row is not None:
            row.delete()
        return True

    if row is not None and _as_integer(row.value) == _as_integer(raw):
        return True

    if row is None:
        row = PropertyAttributeValue(property=prop, attribute=attribute)
    row.set_value(raw)
    row.save()
    return True
