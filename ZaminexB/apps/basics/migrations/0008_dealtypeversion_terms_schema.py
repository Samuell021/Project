from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('basics', '0007_property_file_attribute_entity'),
    ]

    operations = [
        migrations.AddField(
            model_name='dealtypeversion',
            name='terms_schema',
            field=models.JSONField(blank=True, default=dict, verbose_name='تعریف شرایط معامله'),
        ),
    ]
