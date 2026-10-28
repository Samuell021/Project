import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


OPEN_STATUSES = ("ACTIVE", "PAUSED", "DRAFT")
BATCH_SIZE = 500


def archive_duplicate_listings(apps, schema_editor):
    Listing = apps.get_model("listings", "Listing")
    keepers = {}
    duplicates = []
    queryset = (
        Listing.objects.filter(deal_type__isnull=False)
        .exclude(status="ARCHIVED")
        .order_by("property_id", "deal_type_id", "-created_at", "-id")
    )
    for listing in queryset.iterator(chunk_size=2000):
        key = (listing.property_id, listing.deal_type_id)
        keeper = keepers.get(key)
        if keeper is None:
            keepers[key] = listing
        elif keeper.status not in OPEN_STATUSES and listing.status in OPEN_STATUSES:
            duplicates.append(keeper.pk)
            keepers[key] = listing
        else:
            duplicates.append(listing.pk)
    for start in range(0, len(duplicates), BATCH_SIZE):
        Listing.objects.filter(
            pk__in=duplicates[start : start + BATCH_SIZE]
        ).update(status="ARCHIVED")


class Migration(migrations.Migration):

    dependencies = [
        ('basics', '0005_dealtype_family_dealtypeversion'),
        ('listings', '0010_listing_review_requested_at'),
        ('properties', '0025_property_review_status_property_review_version_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RunPython(archive_duplicate_listings, migrations.RunPython.noop),
        migrations.CreateModel(
            name='ListingPriceHistory',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('sale_price', models.DecimalField(blank=True, decimal_places=0, max_digits=18, null=True, verbose_name='قیمت فروش')),
                ('deposit', models.DecimalField(blank=True, decimal_places=0, max_digits=18, null=True, verbose_name='مبلغ ودیعه')),
                ('monthly_rent', models.DecimalField(blank=True, decimal_places=0, max_digits=18, null=True, verbose_name='اجاره ماهانه')),
                ('price_details', models.JSONField(blank=True, default=dict, verbose_name='جزئیات قیمت')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='زمان ثبت')),
            ],
            options={
                'verbose_name': 'سابقه قیمت فایل عرضه',
                'verbose_name_plural': 'سوابق قیمت فایل عرضه',
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddField(
            model_name='listing',
            name='deal_type_version',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='listings', to='basics.dealtypeversion', verbose_name='نسخه نوع معامله'),
        ),
        migrations.AddField(
            model_name='listing',
            name='version',
            field=models.PositiveIntegerField(default=1, verbose_name='نسخه شرایط'),
        ),
        migrations.AddConstraint(
            model_name='listing',
            constraint=models.UniqueConstraint(condition=models.Q(('deal_type__isnull', False)) & ~models.Q(('status', 'ARCHIVED')), fields=('property', 'deal_type'), name='uq_listing_property_deal_type'),
        ),
        migrations.AddField(
            model_name='listingpricehistory',
            name='changed_by',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='listing_price_changes', to=settings.AUTH_USER_MODEL, verbose_name='تغییر دهنده'),
        ),
        migrations.AddField(
            model_name='listingpricehistory',
            name='listing',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='price_history', to='listings.listing', verbose_name='فایل عرضه'),
        ),
    ]
