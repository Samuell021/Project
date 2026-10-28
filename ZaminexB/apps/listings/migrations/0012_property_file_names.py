import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("listings", "0011_listingpricehistory_listing_deal_type_version_and_more"),
        ("tickets", "0004_ticketparticipant_visible_reply_count"),
        ("crm", "0004_sales_ranges_and_legacy_review"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterModelTable(
            name="listing",
            table="listings_listing",
        ),
        migrations.AlterModelTable(
            name="listingpricehistory",
            table="listings_listingpricehistory",
        ),
        migrations.RenameModel(
            old_name="Listing",
            new_name="PropertyFile",
        ),
        migrations.RenameModel(
            old_name="ListingAttributeValue",
            new_name="PropertyFileAttributeValue",
        ),
        migrations.RenameModel(
            old_name="ListingPriceHistory",
            new_name="PropertyFilePriceHistory",
        ),
        migrations.AlterField(
            model_name="propertyfileattributevalue",
            name="listing",
            field=models.ForeignKey(
                db_column="listing_id",
                on_delete=django.db.models.deletion.CASCADE,
                related_name="attribute_values",
                to="listings.propertyfile",
                verbose_name="فایل",
            ),
        ),
        migrations.RenameField(
            model_name="propertyfileattributevalue",
            old_name="listing",
            new_name="property_file",
        ),
        migrations.AlterField(
            model_name="propertyfilepricehistory",
            name="listing",
            field=models.ForeignKey(
                db_column="listing_id",
                on_delete=django.db.models.deletion.CASCADE,
                related_name="price_history",
                to="listings.propertyfile",
                verbose_name="فایل",
            ),
        ),
        migrations.RenameField(
            model_name="propertyfilepricehistory",
            old_name="listing",
            new_name="property_file",
        ),
        migrations.AlterField(
            model_name="propertyfile",
            name="property",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="property_files",
                to="properties.property",
                verbose_name="ملک",
            ),
        ),
        migrations.AlterField(
            model_name="propertyfile",
            name="deal_type",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="property_files",
                to="basics.dealtype",
                verbose_name="نوع معامله",
            ),
        ),
        migrations.AlterField(
            model_name="propertyfile",
            name="deal_type_version",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="property_files",
                to="basics.dealtypeversion",
                verbose_name="نسخه نوع معامله",
            ),
        ),
        migrations.AlterField(
            model_name="propertyfile",
            name="assigned_to",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="assigned_property_files",
                to=settings.AUTH_USER_MODEL,
                verbose_name="مسئول فایل",
            ),
        ),
        migrations.AlterField(
            model_name="propertyfile",
            name="created_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="created_property_files",
                to=settings.AUTH_USER_MODEL,
                verbose_name="ایجاد کننده",
            ),
        ),
        migrations.AlterField(
            model_name="propertyfile",
            name="title",
            field=models.CharField(max_length=255, verbose_name="عنوان فایل"),
        ),
        migrations.AlterField(
            model_name="propertyfilepricehistory",
            name="changed_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="property_file_price_changes",
                to=settings.AUTH_USER_MODEL,
                verbose_name="تغییر دهنده",
            ),
        ),
        migrations.AlterModelOptions(
            name="propertyfile",
            options={
                "ordering": ["-created_at"],
                "verbose_name": "فایل",
                "verbose_name_plural": "فایل‌ها",
            },
        ),
        migrations.AlterModelOptions(
            name="propertyfileattributevalue",
            options={
                "verbose_name": "مقدار ویژگی فایل",
                "verbose_name_plural": "مقادیر ویژگی فایل",
            },
        ),
        migrations.AlterModelOptions(
            name="propertyfilepricehistory",
            options={
                "ordering": ["-created_at"],
                "verbose_name": "سابقه قیمت فایل عرضه",
                "verbose_name_plural": "سوابق قیمت فایل عرضه",
            },
        ),
    ]
