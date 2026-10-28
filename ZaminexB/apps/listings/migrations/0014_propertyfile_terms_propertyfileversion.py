import datetime
import decimal

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def json_safe(value):
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return str(value)
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    return value


def snapshot_existing(apps, schema_editor):
    File = apps.get_model("listings", "PropertyFile")
    Version = apps.get_model("listings", "PropertyFileVersion")
    alias = schema_editor.connection.alias
    for item in File.objects.using(alias).all().iterator():
        Version.objects.using(alias).create(
            property_file_id=item.pk,
            version_number=item.version,
            changed_by_id=item.assigned_to_id or item.created_by_id,
            snapshot=json_safe({
                "deal_type_id": item.deal_type_id,
                "deal_type_version_id": item.deal_type_version_id,
                "terms": {},
                "sale_price": str(item.sale_price) if item.sale_price is not None else None,
                "deposit": str(item.deposit) if item.deposit is not None else None,
                "monthly_rent": str(item.monthly_rent) if item.monthly_rent is not None else None,
                "price_details": item.price_details,
                "status": item.status,
                "title": item.title,
                "description": item.description,
                "publish_channel": item.publish_channel,
                "start_date": item.start_date,
                "end_date": item.end_date,
                "assigned_to_id": item.assigned_to_id,
                "terms_schema_version": item.deal_type_version_id,
            }),
        )


class Migration(migrations.Migration):

    dependencies = [
        ('listings', '0013_remove_propertyfileattributevalue_uq_listing_attribute_value_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='propertyfile',
            name='terms',
            field=models.JSONField(blank=True, default=dict, verbose_name='شرایط معامله'),
        ),
        migrations.CreateModel(
            name='PropertyFileVersion',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('version_number', models.PositiveIntegerField(verbose_name='شماره نسخه')),
                ('snapshot', models.JSONField(default=dict, verbose_name='عکس وضعیت')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='زمان ثبت')),
                ('changed_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='property_file_versions', to=settings.AUTH_USER_MODEL, verbose_name='تغییر دهنده')),
                ('property_file', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='versions', to='listings.propertyfile', verbose_name='فایل')),
            ],
            options={
                'verbose_name': 'نسخه فایل عرضه',
                'verbose_name_plural': 'نسخه\u200cهای فایل عرضه',
                'db_table': 'listings_listingversion',
                'ordering': ['-version_number'],
                'constraints': [models.UniqueConstraint(fields=('property_file', 'version_number'), name='uq_listing_version')],
            },
        ),
        migrations.RunPython(snapshot_existing, migrations.RunPython.noop),
    ]
