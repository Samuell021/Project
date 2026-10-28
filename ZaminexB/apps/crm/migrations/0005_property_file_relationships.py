import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("crm", "0004_sales_ranges_and_legacy_review"),
        ("listings", "0012_property_file_names"),
    ]

    operations = [
        migrations.AlterField(
            model_name="introduction",
            name="listing",
            field=models.ForeignKey(
                db_column="listing_id",
                on_delete=django.db.models.deletion.PROTECT,
                related_name="introductions",
                to="listings.propertyfile",
                verbose_name="فایل",
            ),
        ),
        migrations.RenameField(
            model_name="introduction",
            old_name="listing",
            new_name="property_file",
        ),
        migrations.AlterField(
            model_name="deal",
            name="listing",
            field=models.ForeignKey(
                db_column="listing_id",
                on_delete=django.db.models.deletion.PROTECT,
                related_name="deals",
                to="listings.propertyfile",
                verbose_name="فایل",
            ),
        ),
        migrations.RenameField(
            model_name="deal",
            old_name="listing",
            new_name="property_file",
        ),
    ]
