from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('crm', '0008_alter_propertyparty_share_percent_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='propertyparty',
            name='ended_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='پایان ارتباط'),
        ),
    ]
