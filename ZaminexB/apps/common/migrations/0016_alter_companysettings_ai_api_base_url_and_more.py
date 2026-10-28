from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('common', '0015_remove_notification'),
    ]

    operations = [
        migrations.AlterField(
            model_name='companysettings',
            name='ai_api_base_url',
            field=models.CharField(blank=True, help_text='مثلاً https://api.openai.com/v1؛ مسیر /chat/completions به\u200cصورت خودکار افزوده می\u200cشود.', max_length=500, verbose_name='آدرس پایه API هوش مصنوعی'),
        ),
        migrations.AlterField(
            model_name='companysettings',
            name='ai_api_key',
            field=models.CharField(blank=True, help_text='در سرویس\u200cهای بدون احراز هویت خالی بماند. آدرس سرویس باید HTTPS عمومی باشد.', max_length=2048, verbose_name='کلید API هوش مصنوعی'),
        ),
        migrations.AlterField(
            model_name='companysettings',
            name='ai_model',
            field=models.CharField(help_text='شناسه دقیق مدل در سرویس\u200cدهنده را وارد کنید؛ مثلاً gpt-4o-mini یا deepseek-chat.', max_length=200, verbose_name='نام مدل'),
        ),
    ]
