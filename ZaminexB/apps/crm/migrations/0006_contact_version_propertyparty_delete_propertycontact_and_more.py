from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("crm", "0005_property_file_relationships"), ("properties", "0027_alter_property_consultant")]
    operations = [
        migrations.AddField(model_name="contact", name="version", field=models.PositiveIntegerField(default=1, verbose_name="نسخه")),
        migrations.RenameModel(old_name="PropertyContact", new_name="PropertyParty"),
        migrations.AlterModelTable(name="propertyparty", table="crm_propertycontact"),
        migrations.AddField(model_name="propertyparty", name="share_percent", field=models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True, verbose_name="سهم درصدی")),
    ]
