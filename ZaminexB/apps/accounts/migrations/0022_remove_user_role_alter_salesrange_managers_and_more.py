import datetime
import django.core.validators
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def preserve_groups(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    Group = apps.get_model("auth", "Group")
    alias = schema_editor.connection.alias
    mapping = {"ADMIN": "GENERAL_MANAGER", "RANGE_MANAGER": "RANGE_MANAGER", "AGENT": "AGENT", "FINANCE": "FINANCE"}
    for user in User.objects.using(alias).all().iterator():
        if not user.groups.exists() and user.role in mapping:
            group, _ = Group.objects.using(alias).get_or_create(name=mapping[user.role])
            user.groups.add(group)


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0021_alter_scopemembership_options_and_more'),
    ]

    operations = [
        migrations.RunPython(preserve_groups, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name='user',
            name='role',
        ),
        migrations.AlterField(
            model_name='salesrange',
            name='managers',
            field=models.ManyToManyField(blank=True, limit_choices_to={'groups__name': 'RANGE_MANAGER'}, related_name='managed_ranges', to=settings.AUTH_USER_MODEL, verbose_name='مدیران رنج'),
        ),
        migrations.AlterField(
            model_name='salesrange',
            name='members',
            field=models.ManyToManyField(blank=True, limit_choices_to={'groups__name': 'AGENT'}, related_name='sales_ranges', to=settings.AUTH_USER_MODEL, verbose_name='کارشناسان رنج'),
        ),
        migrations.RenameModel(old_name="ConsultantProfile", new_name="StaffProfile"),
        migrations.AlterModelTable(name="staffprofile", table="accounts_consultantprofile"),
        migrations.AlterModelOptions(name="staffprofile", options={"verbose_name": "پروفایل کارمند", "verbose_name_plural": "پروفایل‌های کارکنان", "ordering": ["full_name"]}),
        migrations.AddField(model_name="staffprofile", name="staff_code", field=models.CharField(max_length=40, unique=True, null=True, blank=True, verbose_name="کد پرسنلی")),
        migrations.AddField(model_name="staffprofile", name="version", field=models.PositiveIntegerField(default=1, verbose_name="نسخه")),
    ]
