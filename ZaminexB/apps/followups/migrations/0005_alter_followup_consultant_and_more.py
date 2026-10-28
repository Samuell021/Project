import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('followups', '0004_alter_followup_follow_up_type_alter_followup_status'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name='followup',
            name='consultant',
            field=models.ForeignKey(limit_choices_to={'role': 'AGENT'}, on_delete=django.db.models.deletion.PROTECT, related_name='followups', to=settings.AUTH_USER_MODEL, verbose_name='کارشناس'),
        ),
        migrations.AlterField(
            model_name='followup',
            name='consultant_name',
            field=models.CharField(blank=True, max_length=255, verbose_name='نام کارشناس'),
        ),
    ]
