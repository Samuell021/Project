from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0026_staffprofile_legacy_metadata_delete_adminprofile"),
    ]

    operations = [
        migrations.AlterField(
            model_name="role",
            name="code",
            field=models.CharField(max_length=40, unique=True, verbose_name="کد نقش"),
        ),
        migrations.AddField(
            model_name="role",
            name="permissions_provisioned",
            field=models.BooleanField(default=False, verbose_name="اعمال اولیه مجوزها"),
        ),
        migrations.DeleteModel(
            name="GroupSettings",
        ),
    ]
