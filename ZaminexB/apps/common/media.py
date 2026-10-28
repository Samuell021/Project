from __future__ import annotations

import posixpath
from pathlib import PurePosixPath

from django.conf import settings
from django.http import Http404, HttpResponseForbidden
from django.views.static import serve

from apps.accounts.models import AdminProfile, ConsultantProfile
from apps.accounts.permissions import user_is_general_manager
from apps.properties.models import PropertyAppraisalReport, PropertyImage


def _safe_relative_path(path: str) -> str | None:
    if not path:
        return None
    
    if "\x00" in path or path.startswith(("/", "\\")) or ":\\" in path:
        return None
    normalized = posixpath.normpath(path).replace("\\", "/")
    if normalized in (".", "..") or normalized.startswith("../") or "/../" in normalized:
        return None
    return normalized


def _can_access_media(user, rel_path: str) -> bool:
    parts = PurePosixPath(rel_path).parts
    if not parts:
        return False

    authenticated = bool(user and getattr(user, "is_authenticated", False))
    if not authenticated:
        if parts[0] != "properties" or len(parts) < 2 or parts[1] != "images":
            return False
        image = (
            PropertyImage.objects.select_related("property")
            .filter(image=rel_path)
            .only("property_id")
            .first()
        )
        if image is None:
            return False
        from apps.listings.models import PropertyFile

        return PropertyFile.objects.filter(
            property_id=image.property_id,
            status=PropertyFile.Status.ACTIVE,
            publish_channel=PropertyFile.PublishChannel.WEBSITE,
            property__review_status="APPROVED",
        ).exists()

    if parts[0] == "contracts":
        if not user_is_general_manager(user) or len(parts) < 3 or parts[1] != "attachments":
            return False
        from apps.crm.models import ContractAttachment

        return ContractAttachment.objects.filter(file=rel_path, contract__isnull=False).exists()

    if user_is_general_manager(user):
        return True

    if parts[0] == "properties" and len(parts) > 1 and parts[1] == "appraisals":
        report = (
            PropertyAppraisalReport.objects.select_related("property")
            .filter(file=rel_path)
            .only("property__consultant_id")
            .first()
        )
        return bool(report and report.property and report.property.consultant_id == user.pk)
    
    if parts[0] == "properties":
        image = (
            PropertyImage.objects.select_related("property")
            .filter(image=rel_path)
            .only("property__consultant_id")
            .first()
        )
        return bool(image and image.property and image.property.consultant_id == user.pk)
    
    if parts[0] == "consultants":
        return ConsultantProfile.objects.filter(user=user, profile_image=rel_path).exists()
    if parts[0] == "admins":
        return AdminProfile.objects.filter(user=user, profile_image=rel_path).exists()
    
    return False


def serve_media(request, path):
    rel_path = _safe_relative_path(path)
    if rel_path is None:
        raise Http404("مسیر فایل نامعتبر است.")
    if not _can_access_media(request.user, rel_path):
        return HttpResponseForbidden("شما به این فایل دسترسی ندارید.")
    response = serve(request, rel_path, document_root=settings.MEDIA_ROOT)
    if rel_path.startswith("contracts/"):
        response["Content-Disposition"] = "attachment"
        response["Cache-Control"] = "private, no-store, max-age=0"
        response["Pragma"] = "no-cache"
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Security-Policy"] = "sandbox; default-src 'none'"
    return response
