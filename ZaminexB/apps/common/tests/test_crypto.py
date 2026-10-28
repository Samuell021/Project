import base64
import hashlib
import hmac
from unittest import mock

from django.contrib.admin.sites import AdminSite
from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase, override_settings

from apps.common.admin import AIConfigurationAdmin
from apps.common.crypto import (
    SecretDecryptionError,
    decrypt_secret,
    encrypt_secret,
)
from apps.common.models import AIConfiguration, CompanySettings


def _legacy_ciphertext(plaintext, secret):
    key = hashlib.sha256(secret.encode("utf-8")).digest()
    raw = plaintext.encode("utf-8")
    signature = hmac.new(key, raw, hashlib.sha256).digest()
    body = bytes(value ^ key[index % len(key)] for index, value in enumerate(raw))
    return "enc:v1:" + base64.urlsafe_b64encode(signature + body).decode("ascii")


class SecretEncryptionTests(SimpleTestCase):
    @override_settings(SECRET_ENCRYPTION_KEY="71" * 32, DEBUG=False)
    def test_aes_gcm_encrypts_with_random_nonces(self):
        first = encrypt_secret("sk-example-secret")
        second = encrypt_secret("sk-example-secret")

        self.assertTrue(first.startswith("enc:v2:"))
        self.assertNotEqual(first, second)
        self.assertNotIn("sk-example-secret", first)
        self.assertEqual(decrypt_secret(first), "sk-example-secret")

    @override_settings(SECRET_ENCRYPTION_KEY="72" * 32, DEBUG=False)
    def test_tampered_ciphertext_is_rejected(self):
        encrypted = encrypt_secret("sk-example-secret")
        index = len("enc:v2:") + 2
        replacement = "A" if encrypted[index] != "A" else "B"
        tampered = encrypted[:index] + replacement + encrypted[index + 1:]

        with self.assertRaises(SecretDecryptionError):
            decrypt_secret(tampered)

    @override_settings(SECRET_ENCRYPTION_KEY="73" * 32, DEBUG=False)
    def test_v1_ciphertext_can_be_read_and_upgraded(self):
        legacy = _legacy_ciphertext("sk-legacy-secret", "legacy-django-secret")
        with override_settings(SECRET_KEY="legacy-django-secret"):
            self.assertEqual(decrypt_secret(legacy), "sk-legacy-secret")
            upgraded = encrypt_secret(legacy)

        self.assertTrue(upgraded.startswith("enc:v2:"))
        self.assertEqual(decrypt_secret(upgraded), "sk-legacy-secret")

    @override_settings(SECRET_ENCRYPTION_KEY="", DEBUG=False)
    def test_production_encryption_requires_a_dedicated_key(self):
        with self.assertRaises(ImproperlyConfigured):
            encrypt_secret("sk-example-secret")

    @override_settings(SECRET_ENCRYPTION_KEY="not-hex", DEBUG=True)
    def test_invalid_encryption_key_is_rejected(self):
        with self.assertRaises(ImproperlyConfigured):
            encrypt_secret("sk-example-secret")


class AIConfigurationAdminFormTests(SimpleTestCase):
    def setUp(self):
        self.instance = AIConfiguration(
            pk=1,
            company_name="زمینکس",
            ai_enabled=False,
            ai_api_base_url="",
            ai_api_key=encrypt_secret("sk-existing-secret"),
            ai_model="gpt-4o-mini",
        )
        self.admin_form = AIConfigurationAdmin(AIConfiguration, AdminSite())

    def _form(self, **overrides):
        data = {
            "ai_enabled": False,
            "ai_api_base_url": "",
            "ai_api_key": "",
            "clear_ai_api_key": "",
            "ai_model": self.instance.ai_model,
        }
        data.update(overrides)
        return self.admin_form.get_form(None)(instance=self.instance, data=data)

    def test_admin_form_does_not_render_the_existing_secret(self):
        form = self.admin_form.get_form(None)(instance=self.instance)
        rendered = form.as_p()

        self.assertNotIn("sk-existing-secret", rendered)
        self.assertNotIn("enc:v2:", rendered)

    def test_blank_key_preserves_the_saved_ciphertext(self):
        form = self._form()

        self.assertTrue(form.is_valid(), form.errors)
        self.assertEqual(form.cleaned_data["ai_api_key"], self.instance.ai_api_key)

    def test_clear_checkbox_removes_the_saved_secret(self):
        form = self._form(clear_ai_api_key="on")

        self.assertTrue(form.is_valid(), form.errors)
        self.assertEqual(form.cleaned_data["ai_api_key"], "")

    def test_clear_checkbox_rejects_a_simultaneous_new_key(self):
        form = self._form(ai_api_key="sk-new-secret", clear_ai_api_key="on")

        self.assertFalse(form.is_valid())
        self.assertIn("ai_api_key", form.errors)

    def test_plaintext_keys_entered_in_admin_are_encrypted_on_save(self):
        form = self._form(ai_api_key="sk-new-secret")

        self.assertTrue(form.is_valid(), form.errors)
        instance = form.save(commit=False)
        with mock.patch("django.db.models.Model.save"):
            instance.save()

        self.assertTrue(instance.ai_api_key.startswith("enc:v2:"))
        self.assertEqual(instance.ai_api_key_plain, "sk-new-secret")
