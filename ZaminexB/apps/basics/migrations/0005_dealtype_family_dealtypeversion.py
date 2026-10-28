import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('basics', '0004_attributecategory'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='dealtype',
            name='family',
            field=models.CharField(choices=[('SALE', 'فروش'), ('RENT', 'اجاره'), ('FULL_MORTGAGE', 'رهن کامل'), ('PRE_SALE', 'پیش\u200cفروش'), ('PARTNERSHIP', 'مشارکت در ساخت'), ('EXCHANGE', 'معاوضه')], default='SALE', max_length=20, verbose_name='خانواده رفتاری'),
        ),
        migrations.CreateModel(
            name='DealTypeVersion',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('version_number', models.PositiveIntegerField(verbose_name='شماره نسخه')),
                ('family', models.CharField(choices=[('SALE', 'فروش'), ('RENT', 'اجاره'), ('FULL_MORTGAGE', 'رهن کامل'), ('PRE_SALE', 'پیش\u200cفروش'), ('PARTNERSHIP', 'مشارکت در ساخت'), ('EXCHANGE', 'معاوضه')], default='SALE', max_length=20, verbose_name='خانواده رفتاری')),
                ('financial_fields', models.JSONField(blank=True, default=list, verbose_name='فیلدهای مالی')),
                ('required_roles', models.JSONField(blank=True, default=list, verbose_name='نقش\u200cهای طرفین')),
                ('rules', models.JSONField(blank=True, default=dict, verbose_name='قواعد')),
                ('status', models.CharField(choices=[('DRAFT', 'پیش\u200cنویس'), ('PUBLISHED', 'منتشرشده'), ('ARCHIVED', 'بایگانی\u200cشده')], default='DRAFT', max_length=20, verbose_name='وضعیت')),
                ('published_at', models.DateTimeField(blank=True, null=True, verbose_name='زمان انتشار')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='تاریخ ایجاد')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='تاریخ بروزرسانی')),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_deal_type_versions', to=settings.AUTH_USER_MODEL, verbose_name='ایجادکننده')),
                ('deal_type', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='versions', to='basics.dealtype', verbose_name='نوع معامله')),
            ],
            options={
                'verbose_name': 'نسخه نوع معامله',
                'verbose_name_plural': 'نسخه\u200cهای نوع معامله',
                'ordering': ['deal_type', 'version_number'],
                'constraints': [models.UniqueConstraint(fields=('deal_type', 'version_number'), name='uq_deal_type_version')],
            },
        ),
    ]
