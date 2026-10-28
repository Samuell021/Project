
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('crm', '0010_propertyappraisal_archived_reports_and_more'),
        ('listings', '0014_propertyfile_terms_propertyfileversion'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='contract',
            name='terms_history',
            field=models.JSONField(blank=True, default=list, verbose_name='تاریخچه شرایط قرارداد'),
        ),
        migrations.AddField(
            model_name='inquiry',
            name='needs_confirmed_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='زمان تأیید نیاز'),
        ),
        migrations.AddField(
            model_name='introduction',
            name='customer_interest',
            field=models.CharField(choices=[('UNKNOWN', 'بی\u200cپاسخ'), ('INTERESTED', 'علاقه\u200cمند'), ('NOT_INTERESTED', 'بدون علاقه')], default='UNKNOWN', max_length=20, verbose_name='علاقه متقاضی'),
        ),
        migrations.AddField(
            model_name='introduction',
            name='rejection_reason',
            field=models.TextField(blank=True, verbose_name='دلیل رد'),
        ),
        migrations.AddField(
            model_name='introduction',
            name='version',
            field=models.PositiveIntegerField(default=1, verbose_name='نسخه'),
        ),
        migrations.AddField(
            model_name='viewing',
            name='version',
            field=models.PositiveIntegerField(default=1, verbose_name='نسخه'),
        ),
        migrations.AlterField(
            model_name='deal',
            name='stage',
            field=models.CharField(choices=[('NEGOTIATION', 'مذاکره'), ('AGREED', 'توافق\u200cشده'), ('CONTRACT', 'تنظیم قرارداد'), ('LOST', 'ناموفق'), ('FINALIZED', 'نهایی\u200cشده')], default='NEGOTIATION', max_length=20, verbose_name='مرحله'),
        ),
        migrations.AddConstraint(
            model_name='introduction',
            constraint=models.UniqueConstraint(condition=models.Q(('status', 'OPEN')), fields=('inquiry', 'property_file'), name='uq_open_introduction_pair'),
        ),
    ]
