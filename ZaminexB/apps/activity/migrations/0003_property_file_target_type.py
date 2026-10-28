from django.db import migrations, models


def rename_target_type(apps, schema_editor):
    ActivityLog = apps.get_model("activity", "ActivityLog")
    ActivityLog.objects.using(schema_editor.connection.alias).filter(
        target_type="listing"
    ).update(target_type="property_file")


def restore_target_type(apps, schema_editor):
    ActivityLog = apps.get_model("activity", "ActivityLog")
    ActivityLog.objects.using(schema_editor.connection.alias).filter(
        target_type="property_file"
    ).update(target_type="listing")


class Migration(migrations.Migration):

    dependencies = [
        ("activity", "0002_alter_activitylog_target_type"),
    ]

    operations = [
        migrations.RunPython(rename_target_type, restore_target_type),
        migrations.AlterField(
            model_name="activitylog",
            name="target_type",
            field=models.CharField(
                choices=[
                    ("property", "ملک"),
                    ("property_file", "فایل"),
                    ("task", "وظیفه"),
                    ("followup", "پیگیری"),
                    ("ticket", "تیکت"),
                    ("consultant", "کارشناس"),
                    ("system", "سیستم"),
                ],
                db_index=True,
                max_length=20,
                verbose_name="نوع هدف",
            ),
        ),
    ]
