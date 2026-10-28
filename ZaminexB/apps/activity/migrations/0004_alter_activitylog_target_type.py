from django.db import migrations, models


def unify_listing_targets(apps, schema_editor):
    ActivityLog = apps.get_model("activity", "ActivityLog")
    ActivityLog.objects.using(schema_editor.connection.alias).filter(target_type="property_file").update(target_type="listing")


def restore_property_file_targets(apps, schema_editor):
    ActivityLog = apps.get_model("activity", "ActivityLog")
    ActivityLog.objects.using(schema_editor.connection.alias).filter(target_type="listing").update(target_type="property_file")



class Migration(migrations.Migration):

    dependencies = [
        ('activity', '0003_property_file_target_type'),
    ]

    operations = [
        migrations.RunPython(unify_listing_targets, restore_property_file_targets),
        migrations.AlterField(
            model_name='activitylog',
            name='target_type',
            field=models.CharField(choices=[('property', 'ملک'), ('listing', 'فایل عرضه'), ('property_file', 'فایل (نام پیشین)'), ('task', 'وظیفه'), ('followup', 'پیگیری'), ('ticket', 'تیکت'), ('consultant', 'کارشناس'), ('system', 'سیستم')], db_index=True, max_length=20, verbose_name='نوع هدف'),
        ),
    ]
