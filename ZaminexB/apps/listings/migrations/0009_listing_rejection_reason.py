from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("listings", "0008_fuzzy_search_trgm_indexes"),
    ]

    operations = [
        migrations.AddField(
            model_name="listing",
            name="rejection_reason",
            field=models.TextField(blank=True, default="", verbose_name="دلیل بازگرداندن برای اصلاح"),
        ),
    ]
