import io
import urllib.error
from unittest import mock

from django.test import TestCase

from apps.analytics.ai_service import AIError, probe_ai_connection, probe_endpoint
from apps.common.models import CompanySettings


class AIProbeTests(TestCase):
    def setUp(self):
        settings_row = CompanySettings.get_solo()
        settings_row.ai_enabled = True
        settings_row.ai_api_base_url = "https://api.openai.com/v1"
        settings_row.set_ai_api_key("sk-test")
        settings_row.ai_model = "gpt-4o-mini"
        settings_row.save()

    def test_the_probe_reports_a_successful_call(self):
        with mock.patch(
            "apps.analytics.ai_service._chat_completion",
            return_value='{"ok": true}',
        ) as chat:
            result = probe_ai_connection()

        self.assertTrue(result["ok"])
        self.assertEqual(result["provider"], "OpenAI")
        self.assertEqual(result["model"], "gpt-4o-mini")
        self.assertEqual(
            result["endpoint"], "https://api.openai.com/v1/chat/completions"
        )
        self.assertEqual(result["sample"], '{"ok": true}')
        self.assertGreaterEqual(result["latencyMs"], 0)
        self.assertEqual(result["error"], "")
        self.assertTrue(result["checkedAt"])

        chat.assert_called_once()
        self.assertEqual(chat.call_args.kwargs["temperature"], 0)
        self.assertEqual(chat.call_args.kwargs["max_tokens"], 40)

    def test_the_probe_needs_a_base_address(self):
        settings_row = CompanySettings.get_solo()
        settings_row.ai_api_base_url = ""
        settings_row.save()

        with mock.patch("apps.analytics.ai_service._chat_completion") as chat:
            result = probe_ai_connection()

        chat.assert_not_called()
        self.assertFalse(result["ok"])
        self.assertIn("نشانی پایه", result["error"])
        self.assertEqual(result["endpoint"], "")

    def test_the_probe_needs_a_model_name(self):
        settings_row = CompanySettings.get_solo()
        settings_row.ai_model = ""
        settings_row.save()

        with mock.patch("apps.analytics.ai_service._chat_completion") as chat:
            result = probe_ai_connection()

        chat.assert_not_called()
        self.assertFalse(result["ok"])
        self.assertIn("نام مدل", result["error"])

    def test_the_probe_surfaces_service_errors(self):
        with mock.patch(
            "apps.analytics.ai_service._chat_completion",
            side_effect=AIError("کلید API نامعتبر است."),
        ):
            result = probe_ai_connection()

        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "کلید API نامعتبر است.")
        self.assertEqual(result["latencyMs"], 0)

    def test_the_probe_surfaces_http_error_codes_and_bodies(self):
        error = urllib.error.HTTPError(
            "https://api.openai.com/v1/chat/completions",
            401,
            "Unauthorized",
            {},
            io.BytesIO('{"error": {"message": "invalid key"}}'.encode("utf-8")),
        )
        with mock.patch(
            "apps.analytics.ai_service._chat_completion", side_effect=error
        ):
            result = probe_ai_connection()

        self.assertFalse(result["ok"])
        self.assertIn("401", result["error"])
        self.assertIn("invalid key", result["detail"])

    def test_the_probe_surfaces_network_failures(self):
        with mock.patch(
            "apps.analytics.ai_service._chat_completion",
            side_effect=urllib.error.URLError("نام میزبان پیدا نشد"),
        ):
            result = probe_ai_connection()

        self.assertFalse(result["ok"])
        self.assertIn("اتصال برقرار نشد", result["error"])

    def test_the_probe_surfaces_an_unreadable_stored_key(self):
        CompanySettings.objects.filter(pk=1).update(
            ai_api_key="enc:v2:not-a-real-token"
        )

        result = probe_ai_connection()

        self.assertFalse(result["ok"])
        self.assertIn("قابل رمزگشایی نیست", result["error"])

    def test_the_probe_endpoint_ignores_a_missing_address(self):
        settings_row = CompanySettings.get_solo()
        settings_row.ai_api_base_url = ""
        settings_row.save()
        self.assertEqual(probe_endpoint(), "")

    def test_the_probe_endpoint_trims_trailing_slashes(self):
        settings_row = CompanySettings.get_solo()
        settings_row.ai_api_base_url = "https://api.openai.com/v1/"
        settings_row.save()
        self.assertEqual(
            probe_endpoint(), "https://api.openai.com/v1/chat/completions"
        )
