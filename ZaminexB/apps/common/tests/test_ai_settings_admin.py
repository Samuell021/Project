import io
from unittest import mock

from django.contrib.auth.models import Permission
from django.core.management import call_command
from django.test import TestCase

from apps.accounts.models import User
from apps.analytics.ai_service import AIError
from apps.common.crypto import decrypt_secret
from apps.common.models import CompanySettings

CHANGE_URL = "/admin/common/aiconfiguration/1/change/"
TEST_URL = "/admin/common/aiconfiguration/test-connection/"
COMPANY_URL = "/admin/common/companysettings/1/change/"

FORM_PAYLOAD = {
    "ai_enabled": "on",
    "ai_api_base_url": "https://api.openai.com/v1",
    "ai_api_key": "",
    "ai_model": "gpt-4o-mini",
}


class AISettingsAdminTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_basics", stdout=io.StringIO())
        cls.admin = User.objects.create_superuser(
            username="ai-settings-admin", password="pw", role="ADMIN"
        )

    def setUp(self):
        self.client.force_login(self.admin)
        settings_row = CompanySettings.get_solo()
        settings_row.ai_enabled = True
        settings_row.ai_api_base_url = "https://api.openai.com/v1"
        settings_row.set_ai_api_key("sk-existing")
        settings_row.ai_model = "gpt-4o-mini"
        settings_row.save()

    def post_test(self, **overrides):
        payload = dict(FORM_PAYLOAD)
        payload.update(overrides)
        return self.client.post(TEST_URL, payload)

    def test_admin_index_lists_the_dedicated_ai_section(self):
        response = self.client.get("/admin/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "تنظیمات هوش مصنوعی (API مرکزی)")
        self.assertContains(response, "/admin/common/aiconfiguration/")

    def test_the_section_index_opens_the_single_settings_form(self):
        response = self.client.get("/admin/common/aiconfiguration/")
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], CHANGE_URL)

    def test_company_settings_page_no_longer_edits_ai_fields(self):
        response = self.client.get(COMPANY_URL)
        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, 'name="ai_enabled"')
        self.assertNotContains(response, 'name="ai_api_base_url"')
        self.assertNotContains(response, 'name="ai_api_key"')
        self.assertNotContains(response, 'name="ai_model"')
        self.assertContains(response, "ورود به تنظیمات هوش مصنوعی (API مرکزی)")

    def test_the_form_exposes_every_api_field_and_the_test_action(self):
        response = self.client.get(CHANGE_URL)
        self.assertEqual(response.status_code, 200)
        for field in (
            "ai_enabled",
            "ai_api_base_url",
            "ai_api_key",
            "clear_ai_api_key",
            "ai_model",
        ):
            self.assertContains(response, f'name="{field}"')
        self.assertContains(response, 'name="_ai_test"')
        self.assertContains(response, TEST_URL)
        self.assertContains(response, "آزمون اتصال به سرویس مرکزی")

    def test_the_form_documents_the_method_and_the_openai_example(self):
        response = self.client.get(CHANGE_URL)
        self.assertEqual(response.status_code, 200)
        self.assertContains(
            response, "راهنمای کامل و روش کار تنظیمات هوش مصنوعی (API مرکزی)"
        )
        self.assertContains(response, "روش کار، گام‌به‌گام")
        self.assertContains(response, "نمونهٔ کامل و دقیق (سرویس OpenAI)")
        self.assertContains(response, "https://api.openai.com/v1")
        self.assertContains(response, "gpt-4o-mini")
        self.assertContains(response, "sk-proj-XXXXXXXX")
        self.assertContains(response, "/chat/completions")
        self.assertContains(response, "خطاهای پرتکرار و راه‌حل")
        self.assertContains(response, "نکات امنیتی و عملکردی")

    def test_the_status_panel_shows_the_configuration_state(self):
        response = self.client.get(CHANGE_URL)
        self.assertContains(response, "OpenAI")
        self.assertContains(response, "gpt-4o-mini")
        self.assertContains(response, "https://api.openai.com/v1/chat/completions")
        self.assertContains(response, "هنوز آزمونی انجام نشده است")

    def test_the_connection_test_saves_settings_and_records_success(self):
        with mock.patch(
            "apps.analytics.ai_service._chat_completion",
            return_value='{"ok": true}',
        ) as chat:
            response = self.post_test(ai_model="gpt-4o-mini-2024")
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], CHANGE_URL)
        chat.assert_called_once()

        settings_row = CompanySettings.get_solo()
        self.assertEqual(settings_row.ai_model, "gpt-4o-mini-2024")
        self.assertTrue(settings_row.ai_last_test["ok"])
        self.assertEqual(settings_row.ai_last_test["provider"], "OpenAI")
        self.assertEqual(settings_row.ai_last_test["model"], "gpt-4o-mini-2024")
        self.assertIn("ok", settings_row.ai_last_test["sample"])
        self.assertGreaterEqual(settings_row.ai_last_test["latencyMs"], 0)

        page = self.client.get(CHANGE_URL)
        self.assertContains(page, "موفق")
        self.assertContains(page, "زمان پاسخ")

    def test_the_connection_test_records_provider_errors(self):
        with mock.patch(
            "apps.analytics.ai_service._chat_completion",
            side_effect=AIError("کلید API نامعتبر است."),
        ):
            response = self.post_test()
        self.assertEqual(response.status_code, 302)

        settings_row = CompanySettings.get_solo()
        self.assertFalse(settings_row.ai_last_test["ok"])
        self.assertEqual(settings_row.ai_last_test["error"], "کلید API نامعتبر است.")

        page = self.client.get(CHANGE_URL)
        self.assertContains(page, "ناموفق")
        self.assertContains(page, "کلید API نامعتبر است.")

    def test_the_connection_test_refuses_unsafe_addresses_without_calling_out(self):
        with mock.patch("apps.analytics.ai_service._chat_completion") as chat:
            response = self.post_test(ai_api_base_url="http://localhost:8080/v1")
        self.assertEqual(response.status_code, 302)
        chat.assert_not_called()

        settings_row = CompanySettings.get_solo()
        self.assertEqual(settings_row.ai_api_base_url, "https://api.openai.com/v1")
        self.assertIsNone(settings_row.ai_last_test)

        page = self.client.get(CHANGE_URL)
        self.assertContains(page, "اصلاح کنید")

    def test_the_connection_test_requires_a_post(self):
        response = self.client.get(TEST_URL)
        self.assertEqual(response.status_code, 405)

    def test_blank_key_keeps_the_stored_secret(self):
        response = self.client.post(CHANGE_URL, FORM_PAYLOAD)
        self.assertEqual(response.status_code, 302)
        settings_row = CompanySettings.get_solo()
        self.assertEqual(decrypt_secret(settings_row.ai_api_key), "sk-existing")

    def test_clearing_the_key_removes_the_stored_secret(self):
        payload = dict(FORM_PAYLOAD)
        payload["clear_ai_api_key"] = "on"
        response = self.client.post(CHANGE_URL, payload)
        self.assertEqual(response.status_code, 302)
        settings_row = CompanySettings.get_solo()
        self.assertEqual(settings_row.ai_api_key, "")

    def test_a_new_key_replaces_the_stored_secret(self):
        payload = dict(FORM_PAYLOAD)
        payload["ai_api_key"] = "sk-rotated"
        response = self.client.post(CHANGE_URL, payload)
        self.assertEqual(response.status_code, 302)
        settings_row = CompanySettings.get_solo()
        self.assertEqual(decrypt_secret(settings_row.ai_api_key), "sk-rotated")

    def test_clearing_and_replacing_the_key_together_is_rejected(self):
        payload = dict(FORM_PAYLOAD)
        payload["ai_api_key"] = "sk-rotated"
        payload["clear_ai_api_key"] = "on"
        response = self.client.post(CHANGE_URL, payload)
        self.assertEqual(response.status_code, 200)
        self.assertContains(
            response, "برای حذف کلید، فیلد کلید را خالی بگذارید."
        )

    def test_disabling_the_service_keeps_the_form_usable(self):
        payload = dict(FORM_PAYLOAD)
        payload.pop("ai_enabled")
        payload["ai_api_base_url"] = ""
        response = self.client.post(CHANGE_URL, payload)
        self.assertEqual(response.status_code, 302)
        settings_row = CompanySettings.get_solo()
        self.assertFalse(settings_row.ai_enabled)
        self.assertEqual(settings_row.ai_api_base_url, "")


class AISettingsPermissionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.staff = User.objects.create_user(
            username="ai-staff", password="pw", role="ADMIN", is_staff=True
        )
        cls.staff.user_permissions.add(
            Permission.objects.get(codename="change_companysettings")
        )
        cls.viewer = User.objects.create_user(
            username="ai-viewer", password="pw", role="ADMIN", is_staff=True
        )
        cls.viewer.groups.clear()
        cls.consultant = User.objects.create_user(
            username="ai-consultant", password="pw", role="AGENT"
        )

    def test_anonymous_visitors_are_sent_to_the_admin_login(self):
        response = self.client.get(CHANGE_URL)
        self.assertEqual(response.status_code, 302)
        self.assertIn("/admin/login/", response["Location"])

    def test_consultants_are_sent_to_the_admin_login(self):
        self.client.force_login(self.consultant)
        response = self.client.get(CHANGE_URL)
        self.assertEqual(response.status_code, 302)
        self.assertIn("/admin/login/", response["Location"])

    def test_staff_with_the_company_settings_permission_can_open_the_form(self):
        self.client.force_login(self.staff)
        response = self.client.get(CHANGE_URL)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'name="ai_api_base_url"')

    def test_staff_without_the_change_permission_cannot_run_the_test(self):
        self.client.force_login(self.viewer)
        response = self.client.post(TEST_URL, FORM_PAYLOAD)
        self.assertEqual(response.status_code, 302)
