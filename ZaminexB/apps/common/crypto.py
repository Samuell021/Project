from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import secrets

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured


_PREFIX_V1 = "enc:v1:"
_PREFIX_V2 = "enc:v2:"
_NONCE_SIZE = 12
_ASSOCIATED_DATA = b"zaminex:common.CompanySettings:ai_api_key:v2"
_KEY_CONTEXT = b"zaminex:common.CompanySettings:ai_api_key:v2\0"


class SecretDecryptionError(ValueError):
    pass


def _current_key() -> bytes:
    configured = (getattr(settings, "SECRET_ENCRYPTION_KEY", "") or "").strip()
    if configured:
        try:
            key = bytes.fromhex(configured)
        except ValueError as exc:
            raise ImproperlyConfigured(
                "SECRET_ENCRYPTION_KEY must contain 64 hexadecimal characters."
            ) from exc
        if len(key) != 32:
            raise ImproperlyConfigured(
                "SECRET_ENCRYPTION_KEY must contain 64 hexadecimal characters."
            )
        return key

    if not getattr(settings, "DEBUG", False):
        raise ImproperlyConfigured(
            "SECRET_ENCRYPTION_KEY must be configured when DEBUG is False."
        )

    secret_key = (getattr(settings, "SECRET_KEY", "") or "").encode("utf-8")
    if not secret_key:
        raise ImproperlyConfigured("A secret key is required to encrypt API credentials.")
    return hashlib.sha256(_KEY_CONTEXT + secret_key).digest()


def _legacy_keys() -> tuple[bytes, ...]:
    candidates = (
        getattr(settings, "SECRET_ENCRYPTION_KEY", ""),
        getattr(settings, "SECRET_KEY", ""),
        "insecure-default",
    )
    keys: list[bytes] = []
    for candidate in candidates:
        if not candidate:
            continue
        key = hashlib.sha256(str(candidate).encode("utf-8")).digest()
        if key not in keys:
            keys.append(key)
    return tuple(keys)


def _xor(data: bytes, key: bytes) -> bytes:
    return bytes(value ^ key[index % len(key)] for index, value in enumerate(data))


def _decode_v1(value: str) -> str:
    try:
        encoded = value[len(_PREFIX_V1):].encode("ascii")
        payload = base64.urlsafe_b64decode(encoded)
    except (UnicodeEncodeError, binascii.Error, ValueError) as exc:
        raise SecretDecryptionError(
            "کلید API ذخیره‌شده قابل رمزگشایی نیست. مقدار SECRET_ENCRYPTION_KEY را بررسی کنید."
        ) from exc

    if len(payload) < 32:
        raise SecretDecryptionError(
            "کلید API ذخیره‌شده قابل رمزگشایی نیست. مقدار SECRET_ENCRYPTION_KEY را بررسی کنید."
        )

    signature, body = payload[:32], payload[32:]
    for key in _legacy_keys():
        plaintext = _xor(body, key)
        expected = hmac.new(key, plaintext, hashlib.sha256).digest()
        if hmac.compare_digest(signature, expected):
            try:
                return plaintext.decode("utf-8")
            except UnicodeDecodeError as exc:
                break

    raise SecretDecryptionError(
        "کلید API ذخیره‌شده قابل رمزگشایی نیست. مقدار SECRET_ENCRYPTION_KEY را بررسی کنید."
    )


def _decode_v2(value: str) -> str:
    encoded = value[len(_PREFIX_V2):]
    padded = encoded + "=" * (-len(encoded) % 4)
    try:
        payload = base64.b64decode(padded.encode("ascii"), altchars=b"-_", validate=True)
        if len(payload) <= _NONCE_SIZE:
            raise ValueError("Ciphertext is too short.")
        plaintext = AESGCM(_current_key()).decrypt(
            payload[:_NONCE_SIZE], payload[_NONCE_SIZE:], _ASSOCIATED_DATA
        )
        return plaintext.decode("utf-8")
    except (InvalidTag, UnicodeDecodeError, UnicodeEncodeError, ValueError, binascii.Error) as exc:
        raise SecretDecryptionError(
            "کلید API ذخیره‌شده قابل رمزگشایی نیست. مقدار SECRET_ENCRYPTION_KEY را بررسی کنید."
        ) from exc


def encrypt_secret(plaintext: str | None) -> str:
    if not plaintext:
        return ""
    if plaintext.startswith(_PREFIX_V2):
        _decode_v2(plaintext)
        return plaintext
    if plaintext.startswith(_PREFIX_V1):
        plaintext = _decode_v1(plaintext)
    elif plaintext.startswith("enc:"):
        raise SecretDecryptionError("قالب رمزنگاری کلید API ذخیره‌شده پشتیبانی نمی‌شود.")

    nonce = secrets.token_bytes(_NONCE_SIZE)
    ciphertext = AESGCM(_current_key()).encrypt(
        nonce, plaintext.encode("utf-8"), _ASSOCIATED_DATA
    )
    token = base64.urlsafe_b64encode(nonce + ciphertext).decode("ascii").rstrip("=")
    return _PREFIX_V2 + token


def decrypt_secret(value: str | None) -> str:
    if not value:
        return ""
    if value.startswith(_PREFIX_V2):
        return _decode_v2(value)
    if value.startswith(_PREFIX_V1):
        return _decode_v1(value)
    if value.startswith("enc:"):
        raise SecretDecryptionError("قالب رمزنگاری کلید API ذخیره‌شده پشتیبانی نمی‌شود.")
    return value
