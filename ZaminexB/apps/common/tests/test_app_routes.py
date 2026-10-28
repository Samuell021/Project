from types import SimpleNamespace

from django.test import RequestFactory, SimpleTestCase
from django.urls import resolve

from config.views import crm_dashboard_alias, crm_settings_alias, dashboard


class AppShellRouteTests(SimpleTestCase):
    def test_app_shell_root_resolves_to_dashboard(self):
        match = resolve("/app/")

        self.assertIs(match.func, dashboard)
        self.assertEqual(match.url_name, "app-shell")

    def test_deep_app_routes_resolve_to_dashboard(self):
        routes = (
            ("/app/my-properties/", "my-properties"),
            ("/app/properties/27/", "properties/27"),
            ("/app/listings/18/edit/", "listings/18/edit"),
            ("/app/listings/explore/", "listings/explore"),
            ("/app/tickets/received/9/", "tickets/received/9"),
        )

        for url, app_path in routes:
            with self.subTest(url=url):
                match = resolve(url)
                self.assertIs(match.func, dashboard)
                self.assertEqual(match.url_name, "app-route")
                self.assertEqual(match.kwargs["app_path"], app_path)


class CrmAliasRouteTests(SimpleTestCase):
    def test_crm_aliases_redirect_to_canonical_app_pages_and_require_login(self):
        routes = (
            ("/crm", crm_dashboard_alias, "/app/crm/"),
            ("/crm/", crm_dashboard_alias, "/app/crm/"),
            ("/crm/setting", crm_settings_alias, "/app/crm/settings/"),
            ("/crm/setting/", crm_settings_alias, "/app/crm/settings/"),
            ("/crm/settings", crm_settings_alias, "/app/crm/settings/"),
            ("/crm/settings/", crm_settings_alias, "/app/crm/settings/"),
        )
        factory = RequestFactory()

        for url, expected_view, destination in routes:
            with self.subTest(url=url):
                match = resolve(url)
                self.assertIs(match.func, expected_view)
                anonymous_response = self.client.get(url)
                self.assertEqual(anonymous_response.status_code, 302)
                self.assertTrue(anonymous_response.url.startswith("/accounts/login/"))

                request = factory.get(url)
                request.user = SimpleNamespace(is_authenticated=True)
                response = match.func(request)
                self.assertEqual(response.status_code, 302)
                self.assertEqual(response["Location"], destination)
