import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('properties', '0026_alter_property_price'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name='property',
            name='consultant',
            field=models.ForeignKey(limit_choices_to={'groups__name__in': ['AGENT', 'RANGE_MANAGER']}, on_delete=django.db.models.deletion.PROTECT, related_name='properties', to=settings.AUTH_USER_MODEL, verbose_name='کارشناس مسئول'),
        ),
    ]
