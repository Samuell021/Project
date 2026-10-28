import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0020_property_file_permissions'),
    ]

    operations = [
        migrations.AlterModelOptions(
            name='scopemembership',
            options={'ordering': ['-started_at'], 'verbose_name': 'عضویت رنج', 'verbose_name_plural': 'سوابق عضویت رنج'},
        ),
        migrations.AlterField(
            model_name='legacymanagementscope',
            name='name',
            field=models.CharField(max_length=120, unique=True, verbose_name='نام رنج قدیمی'),
        ),
        migrations.AlterField(
            model_name='scopetransferhistory',
            name='from_scope',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='transfers_from', to='accounts.legacymanagementscope', verbose_name='رنج مبدأ قدیمی'),
        ),
        migrations.AlterField(
            model_name='scopetransferhistory',
            name='to_scope',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='transfers_to', to='accounts.legacymanagementscope', verbose_name='رنج مقصد قدیمی'),
        ),
    ]
