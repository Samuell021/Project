from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('common', '0017_aiconfiguration'),
    ]

    operations = [
        migrations.AddField(
            model_name='companysettings',
            name='ai_last_test',
            field=models.JSONField(blank=True, editable=False, null=True, verbose_name='نتیجه آخرین آزمون اتصال هوش مصنوعی'),
        ),
    ]
