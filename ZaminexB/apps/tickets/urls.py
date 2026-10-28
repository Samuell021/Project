from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    TicketAttachmentDownloadView,
    TicketMetaView,
    TicketRecipientOptionsView,
    TicketSubjectOptionsView,
    TicketUnreadCountView,
    PublicPropertyFileInquiryView,
    TicketViewSet,
)


router = DefaultRouter()
router.register(r"tickets", TicketViewSet, basename="ticket")

urlpatterns = [
    path("property-file-inquiries/", PublicPropertyFileInquiryView.as_view(), name="property-file-inquiry"),
    path("listing-inquiries/", PublicPropertyFileInquiryView.as_view(), name="listing-inquiry"),
    path("meta/", TicketMetaView.as_view(), name="ticket-meta"),
    path(
        "subjects/", TicketSubjectOptionsView.as_view(), name="ticket-subject-options"
    ),
    path(
        "recipients/",
        TicketRecipientOptionsView.as_view(),
        name="ticket-recipient-options",
    ),
    path("unread-count/", TicketUnreadCountView.as_view(), name="ticket-unread-count"),
    path(
        "attachments/<int:pk>/download/",
        TicketAttachmentDownloadView.as_view(),
        name="ticket-attachment-download",
    ),
    path("", include(router.urls)),
]
