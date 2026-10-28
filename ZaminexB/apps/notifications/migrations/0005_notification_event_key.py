import uuid
from django.db import migrations, models


def fill_event_keys(apps, schema_editor):
    Notification = apps.get_model("notifications", "Notification")
    for notification in Notification.objects.using(schema_editor.connection.alias).filter(event_key__isnull=True).iterator():
        notification.event_key = str(uuid.uuid4())
        notification.save(update_fields=["event_key"], using=schema_editor.connection.alias)


class Migration(migrations.Migration):
    dependencies = [("notifications", "0004_property_file_notification_types")]
    operations = [
        migrations.AddField(model_name="notification", name="event_key", field=models.CharField(max_length=200, unique=True, null=True, verbose_name="کلید رویداد")),
        migrations.RunPython(fill_event_keys, migrations.RunPython.noop),
        migrations.AlterField(model_name="notification", name="event_key", field=models.CharField(max_length=200, unique=True, default=uuid.uuid4, verbose_name="کلید رویداد")),
    ]
