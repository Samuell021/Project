from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("notifications", "0002_alter_notification_type"),
    ]

    operations = [
        migrations.AlterField(
            model_name="notification",
            name="type",
            field=models.CharField(
                choices=[
                    ("password_reset_request", "درخواست تغییر رمز عبور"),
                    ("password_changed", "تغییر رمز عبور"),
                    ("task_assigned", "وظیفه جدید"),
                    ("task_status_changed", "تغییر وضعیت وظیفه"),
                    ("followup_created", "پیگیری جدید"),
                    ("property_assigned", "ملک جدید"),
                    ("property_pending_review", "ملک در انتظار تأیید"),
                    ("property_approved", "تایید ملک"),
                    ("property_rejected", "رد ملک"),
                    ("property_file_pending_review", "فایل در انتظار تأیید"),
                    ("property_file_approved", "تایید فایل"),
                    ("property_file_rejected", "رد فایل"),
                    ("ticket_created", "تیکت جدید"),
                    ("ticket_reply", "پاسخ جدید تیکت"),
                    ("ticket_status_changed", "تغییر وضعیت تیکت"),
                ],
                max_length=50,
                verbose_name="نوع اعلان",
            ),
        ),
    ]
