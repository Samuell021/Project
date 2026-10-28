from django.contrib.auth.models import Group
from django.test import TestCase

from apps.accounts.models import User, UserRole
from apps.accounts.presentation import default_page_for, frontend_role_for, role_label_for


class GeneralManagerPresentationTests(TestCase):
    def test_general_manager_group_receives_admin_frontend_access(self):
        user = User.objects.create_user(
            username="group-general-manager",
            password="test-password",
            role=UserRole.AGENT,
        )
        group, _ = Group.objects.get_or_create(name="GENERAL_MANAGER")
        user.groups.add(group)

        self.assertEqual(frontend_role_for(user), "admin")
        self.assertEqual(role_label_for(user), "مدیر")
        self.assertEqual(default_page_for(user), "admin-dashboard")

    def test_agent_without_general_manager_group_keeps_consultant_access(self):
        user = User.objects.create_user(
            username="regular-agent-presentation",
            password="test-password",
            role=UserRole.AGENT,
        )

        self.assertEqual(frontend_role_for(user), "consultant")
        self.assertEqual(role_label_for(user), "کارشناس")
        self.assertEqual(default_page_for(user), "consultant-dashboard")
