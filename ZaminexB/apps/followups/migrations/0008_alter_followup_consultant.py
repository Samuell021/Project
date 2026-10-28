import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('followups', '0007_followup_inquiry_followup_property_case_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name='followup',
            name='consultant',
            field=models.ForeignKey(limit_choices_to={'groups__name__in': ['AGENT', 'RANGE_MANAGER']}, on_delete=django.db.models.deletion.PROTECT, related_name='followups', to=settings.AUTH_USER_MODEL, verbose_name='کارشناس'),
        ),
    ]
