import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('followups', '0005_alter_followup_consultant_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name='followup',
            name='consultant',
            field=models.ForeignKey(limit_choices_to={'role__in': ['AGENT', 'RANGE_MANAGER']}, on_delete=django.db.models.deletion.PROTECT, related_name='followups', to=settings.AUTH_USER_MODEL, verbose_name='کارشناس'),
        ),
    ]
