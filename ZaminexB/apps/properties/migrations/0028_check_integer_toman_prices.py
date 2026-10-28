from django.db import migrations


def check_prices(apps, schema_editor):
    Property = apps.get_model("properties", "Property")
    rows = Property.objects.using(schema_editor.connection.alias).values_list("pk", "price")
    invalid = []
    for identifier, amount in rows.iterator():
        if amount is not None and (not amount.is_finite() or amount != amount.to_integral_value()):
            invalid.append(str(identifier))
            if len(invalid) == 20:
                break
    if invalid:
        raise RuntimeError("مبالغ کسری املاک باید پیش از تبدیل به تومان صحیح تعیین تکلیف شوند. شناسه‌ها: " + "، ".join(invalid))


class Migration(migrations.Migration):
    dependencies = [("properties", "0026_alter_property_price")]
    operations = [migrations.RunPython(check_prices, migrations.RunPython.noop)]
