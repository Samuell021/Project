from django.urls import path, include
from . import urls as listings_urls
from rest_framework.routers import DefaultRouter

app_name = "property_files"

# Re-export the same URL patterns under the property_files namespace
urlpatterns = listings_urls.urlpatterns
