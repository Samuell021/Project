from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('crm', '0009_propertyparty_ended_at'),
    ]

    operations = [
        migrations.AddField(
            model_name='propertyappraisal',
            name='archived_reports',
            field=models.JSONField(blank=True, default=list, verbose_name='گزارش\u200cهای بایگانی\u200cشده قبلی'),
        ),
        migrations.AddField(
            model_name='propertyregistrationrequest',
            name='lead_source',
            field=models.CharField(blank=True, choices=[('OWNER_REFERRAL', 'مراجعه یا تماس مالک'), ('ADVISOR_NETWORK', 'شبکه ارتباطی مشاور'), ('PORTAL', 'پرتال و آگهی'), ('REFERRAL', 'معرفی'), ('WALK_IN', 'حضوری'), ('OTHER', 'سایر')], default='OWNER_REFERRAL', max_length=30, verbose_name='منبع سرنخ'),
        ),
        migrations.AddField(
            model_name='propertyregistrationrequest',
            name='status_snapshot',
            field=models.JSONField(blank=True, default=dict, verbose_name='تصویر وضعیت پیش از بستن'),
        ),
        migrations.AlterField(
            model_name='assignmenthistory',
            name='action',
            field=models.CharField(choices=[('ASSIGNED', 'ارجاع'), ('ACCEPTED', 'پذیرش'), ('REJECTED', 'رد ارجاع'), ('REASSIGNED', 'تغییر مسئول'), ('WITHDRAWAL_REQUESTED', 'درخواست انصراف'), ('WITHDRAWAL_APPROVED', 'تأیید انصراف'), ('WITHDRAWAL_REJECTED', 'رد انصراف'), ('EXTENSION_REQUESTED', 'درخواست تمدید'), ('EXTENSION_APPROVED', 'تأیید تمدید'), ('EXTENSION_REJECTED', 'رد تمدید'), ('SCOPE_TRANSFERRED', 'انتقال رنج')], max_length=30, verbose_name='رویداد'),
        ),
        migrations.AlterField(
            model_name='inquiry',
            name='acceptance_status',
            field=models.CharField(choices=[('UNASSIGNED', 'ارجاع\u200cنشده'), ('PENDING', 'در انتظار پذیرش مسئول'), ('ACCEPTED', 'پذیرفته\u200cشده توسط مسئول'), ('REJECTED', 'رد شده'), ('WITHDRAWAL_PENDING', 'در انتظار تصمیم انصراف')], default='UNASSIGNED', max_length=30, verbose_name='وضعیت پذیرش مسئول'),
        ),
        migrations.AlterField(
            model_name='inquiry',
            name='status',
            field=models.CharField(choices=[('ACTIVE', 'فعال'), ('COMPLETED', 'تکمیل\u200cشده'), ('CLOSED', 'بسته'), ('CANCELLED', 'لغوشده'), ('DUPLICATE', 'تکراری')], default='ACTIVE', max_length=20, verbose_name='وضعیت درخواست'),
        ),
        migrations.AlterField(
            model_name='propertyparty',
            name='role',
            field=models.CharField(choices=[('OWNER', 'مالک'), ('REPRESENTATIVE', 'نماینده'), ('OWNER_REPRESENTATIVE', 'نماینده مالک'), ('TENANT', 'مستأجر'), ('OTHER', 'سایر')], default='OWNER', max_length=30, verbose_name='نقش'),
        ),
        migrations.AlterField(
            model_name='propertyregistrationrequest',
            name='acceptance_status',
            field=models.CharField(choices=[('UNASSIGNED', 'ارجاع\u200cنشده'), ('PENDING', 'در انتظار پذیرش مسئول'), ('ACCEPTED', 'پذیرفته\u200cشده توسط مسئول'), ('REJECTED', 'رد شده'), ('WITHDRAWAL_PENDING', 'در انتظار تصمیم انصراف')], default='UNASSIGNED', max_length=30, verbose_name='وضعیت پذیرش مسئول'),
        ),
        migrations.AlterField(
            model_name='propertyregistrationrequest',
            name='status',
            field=models.CharField(choices=[('ACTIVE', 'فعال'), ('COMPLETED', 'تکمیل\u200cشده'), ('CLOSED', 'بسته'), ('CANCELLED', 'لغوشده'), ('DUPLICATE', 'تکراری')], default='ACTIVE', max_length=20, verbose_name='وضعیت پرونده'),
        ),
    ]
