import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('crm', '0002_convert_existing_properties'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='WorkflowSettings',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('assignment_waiting_hours', models.PositiveIntegerField(default=48, verbose_name='مهلت پاسخ ارجاع (ساعت)')),
                ('default_assignment_due_days', models.PositiveIntegerField(default=5, verbose_name='مهلت پیش\u200cفرض انجام ارجاع (روز)')),
                ('withdrawal_decision_note_required', models.BooleanField(default=False, verbose_name='الزام دلیل تصمیم انصراف')),
                ('extension_decision_note_required', models.BooleanField(default=False, verbose_name='الزام دلیل تصمیم تمدید')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='زمان آخرین ویرایش')),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='updated_workflow_settings', to=settings.AUTH_USER_MODEL, verbose_name='آخرین ویرایش\u200cکننده')),
            ],
            options={
                'verbose_name': 'تنظیمات جریان کار',
                'verbose_name_plural': 'تنظیمات جریان کار',
            },
        ),
    ]
