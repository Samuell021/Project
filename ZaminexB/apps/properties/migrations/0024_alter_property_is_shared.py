from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('properties', '0023_alter_property_consultant'),
    ]

    operations = [
        migrations.AlterField(
            model_name='property',
            name='is_shared',
            field=models.BooleanField(default=False, help_text='وقتی فعال باشد، همه کارشناسان ملک را می\u200cبینند و می\u200cتوانند ویرایش کنند (به جز تغییر کارشناس مسئول).', verbose_name='نمایش برای همه کارشناسان'),
        ),
    ]
