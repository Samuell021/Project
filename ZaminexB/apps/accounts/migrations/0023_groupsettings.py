import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0022_remove_user_role_alter_salesrange_managers_and_more'),
        ('auth', '0012_alter_user_first_name_max_length'),
    ]

    operations = [
        migrations.CreateModel(
            name='GroupSettings',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('version', models.PositiveIntegerField(default=1, verbose_name='نسخه')),
                ('group', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='crm_settings', to='auth.group', verbose_name='گروه')),
            ],
            options={
                'verbose_name': 'تنظیمات گروه',
                'verbose_name_plural': 'تنظیمات گروه\u200cها',
            },
        ),
    ]
