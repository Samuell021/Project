from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("properties", "0019_disable_shared_property_access"),
    ]

    operations = [
        migrations.AlterField(
            model_name="property",
            name="status",
            field=models.CharField(
                choices=[
                    ("AVAILABLE", "آماده واگذاری"),
                    ("RESERVED", "رزرو شده"),
                    ("SOLD", "فروخته/واگذارشده"),
                    ("INACTIVE", "بایگانی‌شده"),
                    ("DRAFT", "پیش‌نویس"),
                ],
                default="AVAILABLE",
                max_length=20,
                verbose_name="وضعیت",
            ),
        ),
    ]
