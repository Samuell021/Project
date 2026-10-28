from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.basics.models import DealType
from apps.listings.models import PropertyFile, PropertyFilePriceHistory
from apps.properties.models import Property


class Command(BaseCommand):
    help = "انتقال صریح مبلغ فروش بایگانی‌شده به فایل عرضه بدون انتشار خودکار"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    @transaction.atomic
    def handle(self, *args, **options):
        changed = skipped = 0
        for prop in Property.objects.select_for_update():
            snapshot = prop.legacy_data.get("pricing", {})
            raw = snapshot.get("price")
            if raw is None:
                continue
            if snapshot.get("deal_type") != "SALE":
                skipped += 1
                continue
            amount = Decimal(str(raw))
            deal_type = DealType.objects.filter(name="sale", family="SALE").first()
            if deal_type is None:
                skipped += 1
                continue
            supply = PropertyFile.objects.select_for_update().filter(property=prop, deal_type=deal_type).exclude(status="ARCHIVED").first()
            if supply and (supply.sale_price is not None or supply.status == "SOLD"):
                skipped += 1
                continue
            if supply is None:
                version = deal_type.versions.filter(status="PUBLISHED").order_by("-version_number").first()
                supply = PropertyFile(property=prop, deal_type=deal_type, deal_type_version=version, title=prop.title, status="DRAFT", publish_channel="WEBSITE", created_by=prop.consultant, assigned_to=prop.consultant)
            supply.sale_price = amount
            supply.version += 1 if supply.pk else 0
            supply.save()
            PropertyFilePriceHistory.objects.create(property_file=supply, sale_price=amount, deposit=supply.deposit, monthly_rent=supply.monthly_rent, price_details=supply.price_details)
            prop.legacy_data = {**prop.legacy_data, "pricing_review_required": False}
            prop.save(update_fields=["legacy_data"])
            changed += 1
        if options["dry_run"]:
            transaction.set_rollback(True)
        self.stdout.write(f"مبالغ فروش منتقل‌شده: {changed}؛ بدون تغییر یا نیازمند تعیین تکلیف: {skipped}")
