import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0014_alter_consultantprofile_options'),
    ]

    operations = [
        migrations.AlterField(
            model_name='role',
            name='code',
            field=models.CharField(choices=[('ADMIN', 'مدیر'), ('RANGE_MANAGER', 'مدیر رنج'), ('AGENT', 'کارشناس'), ('FINANCE', 'مالی')], max_length=20, unique=True, verbose_name='کد نقش'),
        ),
        migrations.AlterField(
            model_name='user',
            name='role',
            field=models.CharField(choices=[('ADMIN', 'مدیر'), ('RANGE_MANAGER', 'مدیر رنج'), ('AGENT', 'کارشناس'), ('FINANCE', 'مالی')], db_index=True, default='AGENT', max_length=20, verbose_name='نقش کاربری'),
        ),
        migrations.CreateModel(
            name='ManagementScope',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=120, unique=True, verbose_name='نام رنج')),
                ('is_active', models.BooleanField(default=True, verbose_name='فعال')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='تاریخ ایجاد')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='تاریخ بروزرسانی')),
                ('legacy_range', models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='management_scope', to='accounts.salesrange', verbose_name='رنج پیشین')),
            ],
            options={
                'verbose_name': 'حوزه مدیریتی',
                'verbose_name_plural': 'حوزه\u200cهای مدیریتی',
                'ordering': ['name'],
            },
        ),
        migrations.CreateModel(
            name='ScopeTransferHistory',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('subject_type', models.CharField(choices=[('PROPERTY_CASE', 'پرونده ملک'), ('INQUIRY', 'درخواست متقاضی')], max_length=20, verbose_name='نوع موضوع')),
                ('subject_id', models.PositiveIntegerField(db_index=True, verbose_name='شناسه موضوع')),
                ('reason', models.TextField(blank=True, verbose_name='دلیل')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='زمان ثبت')),
                ('actor', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='scope_transfers', to=settings.AUTH_USER_MODEL, verbose_name='انجام\u200cدهنده')),
                ('from_scope', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='transfers_from', to='accounts.managementscope', verbose_name='رنج مبدأ')),
                ('to_scope', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='transfers_to', to='accounts.managementscope', verbose_name='رنج مقصد')),
            ],
            options={
                'verbose_name': 'سابقه انتقال رنج',
                'verbose_name_plural': 'سوابق انتقال رنج',
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='ScopeMembership',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('membership_role', models.CharField(choices=[('MANAGER', 'مدیر رنج'), ('MEMBER', 'عضو')], max_length=20, verbose_name='نقش در رنج')),
                ('started_at', models.DateTimeField(verbose_name='شروع عضویت')),
                ('ended_at', models.DateTimeField(blank=True, null=True, verbose_name='پایان عضویت')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='تاریخ ایجاد')),
                ('scope', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='memberships', to='accounts.managementscope', verbose_name='حوزه مدیریتی')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='scope_memberships', to=settings.AUTH_USER_MODEL, verbose_name='کاربر')),
            ],
            options={
                'verbose_name': 'عضویت رنج',
                'verbose_name_plural': 'عضویت\u200cهای رنج',
                'ordering': ['-started_at'],
                'indexes': [models.Index(fields=['user', 'ended_at'], name='accounts_sc_user_id_c0ae6d_idx'), models.Index(fields=['scope', 'ended_at'], name='accounts_sc_scope_i_352c8c_idx')],
            },
        ),
    ]
