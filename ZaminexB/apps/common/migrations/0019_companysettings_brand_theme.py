from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("common", "0018_companysettings_ai_last_test"),
    ]

    operations = [
        migrations.AddField(
            model_name="companysettings",
            name="brand_theme",
            field=models.CharField(
                choices=[
                    ("green", "سبز فردا"),
                    ("petroleum", "آبی نفتی"),
                    ("midnight", "آبی نیمه‌شب"),
                    ("plum", "آلویی"),
                    ("copper", "مسی"),
                    ("slate", "خاکستری‌آبی"),
                ],
                default="green",
                max_length=16,
                verbose_name="رنگ سازمانی",
            ),
        ),
    ]
