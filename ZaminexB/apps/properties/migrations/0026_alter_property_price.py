from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('properties', '0025_property_review_status_property_review_version_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='property',
            name='price',
            field=models.DecimalField(blank=True, decimal_places=0, max_digits=18, null=True, verbose_name='قیمت (منسوخ — در فایل ثبت می\u200cشود)'),
        ),
    ]
