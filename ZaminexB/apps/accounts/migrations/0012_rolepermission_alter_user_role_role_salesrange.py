from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0011_loginsettings_smslogincode_smsprovidersettings'),
    ]

    operations = [
        migrations.CreateModel(
            name='RolePermission',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.CharField(max_length=64, unique=True, verbose_name='کد مجوز')),
                ('name', models.CharField(max_length=160, verbose_name='نام مجوز')),
                ('group', models.CharField(max_length=80, verbose_name='گروه')),
                ('group_order', models.PositiveSmallIntegerField(default=0, verbose_name='ترتیب گروه')),
                ('sort_order', models.PositiveSmallIntegerField(default=0, verbose_name='ترتیب نمایش')),
            ],
            options={
                'verbose_name': 'مجوز',
                'verbose_name_plural': 'مجوزها',
                'ordering': ['group_order', 'sort_order', 'code'],
            },
        ),
        migrations.AlterField(
            model_name='user',
            name='role',
            field=models.CharField(choices=[('ADMIN', 'مدیر'), ('RANGE_MANAGER', 'مدیر رنج'), ('AGENT', 'کارشناس')], db_index=True, default='AGENT', max_length=20, verbose_name='نقش کاربری'),
        ),
        migrations.CreateModel(
            name='Role',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.CharField(choices=[('ADMIN', 'مدیر'), ('RANGE_MANAGER', 'مدیر رنج'), ('AGENT', 'کارشناس')], max_length=20, unique=True, verbose_name='کد نقش')),
                ('name', models.CharField(max_length=80, verbose_name='نام نقش')),
                ('sort_order', models.PositiveSmallIntegerField(default=0, verbose_name='ترتیب نمایش')),
                ('is_locked', models.BooleanField(default=False, verbose_name='دسترسی کامل و غیرقابل تغییر')),
                ('permissions', models.ManyToManyField(blank=True, related_name='roles', to='accounts.rolepermission', verbose_name='مجوزها')),
            ],
            options={
                'verbose_name': 'نقش',
                'verbose_name_plural': 'نقش\u200cها',
                'ordering': ['sort_order', 'code'],
            },
        ),
        migrations.CreateModel(
            name='SalesRange',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=120, unique=True, verbose_name='نام رنج')),
                ('is_active', models.BooleanField(default=True, verbose_name='فعال')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='تاریخ ایجاد')),
                ('managers', models.ManyToManyField(blank=True, limit_choices_to={'role': 'RANGE_MANAGER'}, related_name='managed_ranges', to=settings.AUTH_USER_MODEL, verbose_name='مدیران رنج')),
                ('members', models.ManyToManyField(blank=True, limit_choices_to={'role': 'AGENT'}, related_name='sales_ranges', to=settings.AUTH_USER_MODEL, verbose_name='کارشناسان رنج')),
            ],
            options={
                'verbose_name': 'رنج',
                'verbose_name_plural': 'رنج\u200cها',
                'ordering': ['name'],
            },
        ),
    ]
