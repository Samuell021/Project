
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('crm', '0011_contract_terms_history_inquiry_needs_confirmed_at_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='deal',
            name='viewing',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='deals', to='crm.viewing', verbose_name='بازدید مبنا'),
        ),
    ]
