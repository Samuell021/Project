from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

app_name = "listings"

router = DefaultRouter()
router.register(r"api/property-files", views.PropertyFileViewSet, basename="property-file-api")
router.register(r"api/listings", views.PropertyFileViewSet, basename="listing-api")

urlpatterns = [
    path("explore/", views.public_property_file_explorer, name="public-property-file-explore"),
    path("explore/", views.public_property_file_explorer, name="public-explore"),
    path("<int:pk>/", views.public_property_file_detail, name="public-property-file-detail"),
    path("<int:pk>/", views.public_property_file_detail, name="public-detail"),
    path(
        "api/explore/",
        views.PublicPropertyFileExploreView.as_view(),
        name="public-property-file-explore-api",
    ),
    path(
        "api/public/<int:pk>/",
        views.PublicPropertyFileDetailView.as_view(),
        name="public-property-file-detail-api",
    ),
    path("", views.property_file_list, name="property-file-list"),
    path("", views.property_file_list, name="listing-list"),
    path("", include(router.urls)),
]
