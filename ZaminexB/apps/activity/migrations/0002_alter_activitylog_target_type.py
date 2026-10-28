from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('activity', '0001_initial'),
    ]

    operations = [
        migrations.AlterField(
            model_name='activitylog',
            name='target_type',
            field=models.CharField(choices=[('property', 'ملک'), ('listing', 'آگهی'), ('task', 'وظیفه'), ('followup', 'پیگیری'), ('ticket', 'تیکت'), ('consultant', 'کارشناس'), ('system', 'سیستم')], db_index=True, max_length=20, verbose_name='نوع هدف'),
        ),
    ]
