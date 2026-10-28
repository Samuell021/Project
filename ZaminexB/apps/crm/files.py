from pathlib import PurePosixPath
import zipfile

from rest_framework.exceptions import ValidationError


MAX_CONTRACT_ATTACHMENT_BYTES = 10 * 1024 * 1024
ALLOWED_CONTRACT_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".docx"}


def validate_contract_attachment(upload):
    if upload is None:
        raise ValidationError({"file": "انتخاب فایل قرارداد الزامی است."})
    if not getattr(upload, "size", 0):
        raise ValidationError({"file": "فایل خالی قابل بارگذاری نیست."})
    if upload.size > MAX_CONTRACT_ATTACHMENT_BYTES:
        raise ValidationError({"file": "حداکثر حجم پیوست قرارداد ۱۰ مگابایت است."})

    filename = str(getattr(upload, "name", "") or "").replace("\\", "/")
    filename = PurePosixPath(filename).name
    extension = PurePosixPath(filename).suffix.lower()
    if not filename or extension not in ALLOWED_CONTRACT_EXTENSIONS:
        raise ValidationError({"file": "فقط PDF، تصویر PNG/JPG یا سند DOCX مجاز است."})

    try:
        upload.seek(0)
        prefix = upload.read(1024)
        upload.seek(0)
        if extension == ".pdf" and b"%PDF-" not in prefix:
            raise ValidationError({"file": "محتوای فایل با قالب PDF هم‌خوانی ندارد."})
        if extension == ".png" and not prefix.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValidationError({"file": "محتوای فایل با قالب PNG هم‌خوانی ندارد."})
        if extension in {".jpg", ".jpeg"} and not prefix.startswith(b"\xff\xd8\xff"):
            raise ValidationError({"file": "محتوای فایل با قالب JPEG هم‌خوانی ندارد."})
        if extension == ".docx":
            with zipfile.ZipFile(upload) as archive:
                names = set(archive.namelist())
                if not {"[Content_Types].xml", "word/document.xml"}.issubset(names):
                    raise ValidationError({"file": "ساختار سند DOCX معتبر نیست."})
                if any(name.lower().endswith("vbaproject.bin") for name in names):
                    raise ValidationError({"file": "سند دارای محتوای ماکرو مجاز نیست."})
    except ValidationError:
        raise
    except (OSError, zipfile.BadZipFile, zipfile.LargeZipFile):
        raise ValidationError({"file": "محتوای فایل خوانا یا معتبر نیست."})
    finally:
        try:
            upload.seek(0)
        except (AttributeError, OSError):
            pass

    upload.name = filename[:255]
    return upload
