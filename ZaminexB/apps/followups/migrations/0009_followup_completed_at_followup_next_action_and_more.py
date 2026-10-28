
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('followups', '0008_alter_followup_consultant'),
    ]

    operations = [
        migrations.AddField(
            model_name='followup',
            name='completed_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='زمان تکمیل'),
        ),
        migrations.AddField(
            model_name='followup',
            name='next_action',
            field=models.CharField(blank=True, max_length=255, verbose_name='اقدام بعدی'),
        ),
        migrations.AddField(
            model_name='followup',
            name='next_action_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='موعد اقدام بعدی'),
        ),
        migrations.AddField(
            model_name='followup',
            name='reschedule_history',
            field=models.JSONField(blank=True, default=list, verbose_name='تاریخچه تعویق'),
        ),
        migrations.AddField(
            model_name='followup',
            name='version',
            field=models.PositiveIntegerField(default=1, verbose_name='نسخه'),
        ),
    ]
