from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("properties", "0020_property_draft_status"),
    ]

    operations = [
        migrations.AddField(
            model_name="property",
            name="rejection_reason",
            field=models.TextField(blank=True, default="", verbose_name="دلیل بازگرداندن برای اصلاح"),
        ),
    ]
