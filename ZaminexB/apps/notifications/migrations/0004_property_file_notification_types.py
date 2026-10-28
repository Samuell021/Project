from django.db import migrations


NOTIFICATION_TYPES = {
    "listing_pending_review": "property_file_pending_review",
    "listing_approved": "property_file_approved",
    "listing_rejected": "property_file_rejected",
}


def rename_notification_types(apps, schema_editor):
    Notification = apps.get_model("notifications", "Notification")
    queryset = Notification.objects.using(schema_editor.connection.alias)
    for old_value, new_value in NOTIFICATION_TYPES.items():
        queryset.filter(type=old_value).update(type=new_value)


def restore_notification_types(apps, schema_editor):
    Notification = apps.get_model("notifications", "Notification")
    queryset = Notification.objects.using(schema_editor.connection.alias)
    for old_value, new_value in NOTIFICATION_TYPES.items():
        queryset.filter(type=new_value).update(type=old_value)


class Migration(migrations.Migration):

    dependencies = [
        ("notifications", "0003_property_file_notification_labels"),
    ]

    operations = [
        migrations.RunPython(rename_notification_types, restore_notification_types),
    ]
