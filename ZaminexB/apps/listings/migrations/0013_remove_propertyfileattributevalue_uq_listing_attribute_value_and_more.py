from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('basics', '0007_property_file_attribute_entity'),
        ('listings', '0012_property_file_names'),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name='propertyfileattributevalue',
            name='uq_listing_attribute_value',
        ),
        migrations.AlterField(
            model_name='propertyfile',
            name='is_featured',
            field=models.BooleanField(default=False, verbose_name='فایل ویژه'),
        ),
        migrations.AddConstraint(
            model_name='propertyfileattributevalue',
            constraint=models.UniqueConstraint(fields=('property_file', 'attribute'), name='uq_listing_attribute_value'),
        ),
    ]
