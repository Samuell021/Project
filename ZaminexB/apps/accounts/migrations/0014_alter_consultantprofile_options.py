from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0013_seed_roles_permissions'),
    ]

    operations = [
        migrations.AlterModelOptions(
            name='consultantprofile',
            options={'ordering': ['full_name'], 'verbose_name': 'پروفایل کارشناس', 'verbose_name_plural': 'پروفایل\u200cهای کارشناسان'},
        ),
    ]
