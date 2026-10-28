
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('crm', '0012_alter_deal_viewing'),
    ]

    operations = [
        migrations.AddField(
            model_name='workflowsettings',
            name='stall_threshold_days',
            field=models.PositiveIntegerField(default=7, verbose_name='آستانه هشدار توقف (روز)'),
        ),
    ]
