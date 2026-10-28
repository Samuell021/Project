import django.core.validators
from decimal import Decimal
from django.db import migrations, models


def validate_shares(apps, schema_editor):
    Party = apps.get_model("crm", "PropertyParty")
    invalid = list(Party.objects.using(schema_editor.connection.alias).filter(models.Q(share_percent__lt=0) | models.Q(share_percent__gt=100)).values_list("pk", flat=True)[:20])
    if invalid:
        raise RuntimeError(f"سهم اشخاص مرتبط با ملک خارج از بازه صفر تا صد است؛ پیش از ادامه تعیین تکلیف شود: {invalid}")


class Migration(migrations.Migration):

    dependencies = [
        ('crm', '0007_remove_inquiry_crm_inquiry_scope_i_93cfb8_idx_and_more'),
        ('properties', '0027_alter_property_consultant'),
    ]

    operations = [
        migrations.RunPython(validate_shares, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='propertyparty',
            name='share_percent',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=5, null=True, validators=[django.core.validators.MinValueValidator(Decimal('0')), django.core.validators.MaxValueValidator(Decimal('100'))], verbose_name='سهم درصدی'),
        ),
        migrations.AddConstraint(
            model_name='propertyparty',
            constraint=models.CheckConstraint(condition=models.Q(('share_percent__isnull', True), models.Q(('share_percent__gte', 0), ('share_percent__lte', 100)), _connector='OR'), name='ck_property_party_share_percent'),
        ),
    ]
