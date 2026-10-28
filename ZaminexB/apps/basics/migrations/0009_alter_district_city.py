import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('basics', '0008_dealtypeversion_terms_schema'),
    ]

    operations = [
        migrations.AlterField(
            model_name='district',
            name='city',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='districts', to='basics.city', verbose_name='شهر'),
        ),
    ]
