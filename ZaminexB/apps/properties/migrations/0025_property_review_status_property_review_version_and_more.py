from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('properties', '0024_alter_property_is_shared'),
    ]

    operations = [
        migrations.AddField(
            model_name='property',
            name='review_status',
            field=models.CharField(choices=[('NOT_SUBMITTED', 'ارسال\u200cنشده'), ('PENDING', 'در انتظار بررسی'), ('APPROVED', 'تأیید شده'), ('CHANGES_REQUIRED', 'نیازمند اصلاح')], db_index=True, default='NOT_SUBMITTED', max_length=20, verbose_name='وضعیت بررسی ملک'),
        ),
        migrations.AddField(
            model_name='property',
            name='review_version',
            field=models.PositiveIntegerField(default=0, verbose_name='نسخه بررسی'),
        ),
        migrations.AddField(
            model_name='property',
            name='submitted_review_version',
            field=models.PositiveIntegerField(default=0, verbose_name='نسخه ارسال\u200cشده برای بررسی'),
        ),
    ]
