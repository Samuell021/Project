from django.db import migrations


def forwards(apps, schema_editor):
    Property = apps.get_model("properties", "Property")
    Listing = apps.get_model("listings", "Listing")
    Contact = apps.get_model("crm", "Contact")
    ContactPhone = apps.get_model("crm", "ContactPhone")
    PropertyContact = apps.get_model("crm", "PropertyContact")
    Case = apps.get_model("crm", "PropertyRegistrationRequest")
    ManagementScope = apps.get_model("accounts", "ManagementScope")
    ScopeMembership = apps.get_model("accounts", "ScopeMembership")
    for prop in Property.objects.all().iterator():
        approved = prop.status in ("AVAILABLE", "RESERVED", "SOLD") or Listing.objects.filter(property_id=prop.pk, status="ACTIVE").exists()
        prop.review_status = "APPROVED" if approved else "NOT_SUBMITTED"
        if approved and not prop.review_version:
            prop.review_version = 1
            prop.submitted_review_version = 1
        prop.save(update_fields=["review_status", "review_version", "submitted_review_version"])
        if Case.objects.filter(resulting_property_id=prop.pk).exists():
            continue
        owner_name = f"{prop.owner_first_name or ''} {prop.owner_last_name or ''}".strip() or "مالک"
        contact = Contact.objects.create(full_name=owner_name)
        if prop.owner_phone:
            digits = "".join(ch for ch in str(prop.owner_phone) if ch.isdigit())
            ContactPhone.objects.create(contact=contact, phone=prop.owner_phone, normalized_phone=digits, is_primary=True)
        PropertyContact.objects.get_or_create(property_id=prop.pk, contact=contact, role="OWNER", defaults={"is_primary": True})
        scope = None
        membership = ScopeMembership.objects.filter(user_id=prop.consultant_id, ended_at__isnull=True).order_by("started_at").first()
        if membership:
            scope = membership.scope
        case = Case.objects.create(
            code=f"R-LEGACY-{prop.pk}",
            contact=contact,
            description=prop.description or "",
            property_title=prop.title or "",
            scope=scope,
            created_by_id=prop.consultant_id,
            lead_status="ACCEPTED",
            acceptance_status="ACCEPTED" if prop.consultant_id else "UNASSIGNED",
            assigned_to_id=prop.consultant_id,
            resulting_property_id=prop.pk,
            status="COMPLETED" if approved else "ACTIVE",
        )
        Listing.objects.filter(property_id=prop.pk).update(assigned_to_id=prop.consultant_id)


def backwards(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [("crm", "0001_initial"), ("accounts", "0016_groups_scopes_seed")]
    operations = [migrations.RunPython(forwards, backwards)]
