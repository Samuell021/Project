from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('common', '0016_alter_companysettings_ai_api_base_url_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='AIConfiguration',
            fields=[
            ],
            options={
                'verbose_name': 'تنظیمات هوش مصنوعی',
                'verbose_name_plural': 'تنظیمات هوش مصنوعی (API مرکزی)',
                'proxy': True,
                'indexes': [],
                'constraints': [],
            },
            bases=('common.companysettings',),
        ),
    ]
