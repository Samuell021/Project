from django.contrib import admin
from django.urls import include, path, re_path
from apps.common.media import serve_media
from apps.listings import views as listings_views
from . import views 

admin.site.site_header = "مدیریت زمینکس"
admin.site.site_title = "مدیریت زمینکس"
admin.site.index_title = "مدیریت زمینکس"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("", views.dashboard, name="dashboard"),
    path("explore/", listings_views.public_property_file_explorer, name="root-explore"),
    path("explore/<int:pk>/", listings_views.public_property_file_detail, name="root-explore-detail"),
    path("app/", views.dashboard, name="app-shell"),
    path("app/<path:app_path>/", views.dashboard, name="app-route"),
    path("accounts/", include("apps.accounts.urls")),
    path("properties/", include("apps.properties.urls")),
    path("property-files/", include("apps.listings.property_file_alias_urls")),
    path("listings/", include("apps.listings.urls")),
    path("followups/api/", include("apps.followups.urls")),
    path("tasks/api/", include("apps.tasks.urls")),
    path("tickets/api/", include("apps.tickets.urls")),
    path("common/api/", include("apps.common.urls")),
    path("basics/api/", include("apps.basics.urls")),
    re_path(r"^crm/?$", views.crm_dashboard_alias, name="crm-dashboard-alias"),
    re_path(r"^crm/setting/?$", views.crm_settings_alias, name="crm-settings-singular-alias"),
    re_path(r"^crm/settings/?$", views.crm_settings_alias, name="crm-settings-alias"),
    path("crm/api/", include("apps.crm.urls")),
    path("", include("apps.reports.urls")),
    path("media/<path:path>", serve_media, name="protected-media"),
]
