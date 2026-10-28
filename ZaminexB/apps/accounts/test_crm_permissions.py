from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import Role, RolePermission, StaffProfile, UserRole
from apps.accounts.permissions import permission_codes_for_user


User = get_user_model()


class CrmPermissionCatalogTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            username="crm-permission-admin",
            password="test-password",
            role=UserRole.ADMIN,
        )
        self.agent = User.objects.create_user(
            username="crm-permission-agent",
            password="test-password",
            role=UserRole.AGENT,
        )
        self.finance = User.objects.create_user(
            username="crm-permission-finance",
            password="test-password",
            role=UserRole.FINANCE,
        )

    def test_crm_permissions_are_seeded_into_the_role_matrix(self):
        agent_permissions = set(Role.objects.get(code="AGENT").permissions.values_list("code", flat=True))
        finance_permissions = set(Role.objects.get(code="FINANCE").permissions.values_list("code", flat=True))

        self.assertTrue({"contact.view", "case.view", "case.create", "inquiry.view"}.issubset(agent_permissions))
        self.assertTrue({"finance.view", "finance.manage"}.issubset(finance_permissions))
        self.assertTrue(RolePermission.objects.filter(code="case.assign").exists())
        self.assertIn("contact.view", permission_codes_for_user(self.agent))
        self.assertIn("finance.view", permission_codes_for_user(self.finance))

    def test_configured_role_permissions_can_revoke_seeded_defaults(self):
        role = Role.objects.get(code="AGENT")
        role.permissions.remove(RolePermission.objects.get(code="case.view"))
        self.agent.refresh_from_db()

        self.assertNotIn("case.view", permission_codes_for_user(self.agent))

    def test_role_matrix_can_save_a_new_crm_permission(self):
        self.client.force_authenticate(self.admin)
        response = self.client.patch(
            reverse("accounts:role-permissions"),
            {"role": "AGENT", "permissions": ["contact.view", "case.view", "case.assign"]},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        role_permissions = set(Role.objects.get(code="AGENT").permissions.values_list("code", flat=True))
        self.assertEqual(role_permissions, {"contact.view", "case.view", "case.assign"})

    def test_only_an_admin_can_create_a_custom_role(self):
        self.client.force_authenticate(self.agent)
        response = self.client.post(reverse("accounts:role-permissions"), {"name": "کارشناس قرارداد"}, format="json")

        self.assertEqual(response.status_code, 403, response.content)
        self.assertFalse(Role.objects.filter(name="کارشناس قرارداد").exists())

    def test_custom_role_is_created_as_a_matrix_column_and_granted_from_the_same_table(self):
        self.client.force_authenticate(self.admin)
        created = self.client.post(reverse("accounts:role-permissions"), {"name": "کارشناس قرارداد"}, format="json")

        self.assertEqual(created.status_code, 201, created.content)
        custom_roles = [row for row in created.data["roles"] if row["isCustom"]]
        self.assertEqual([row["name"] for row in custom_roles], ["کارشناس قرارداد"])
        code = custom_roles[0]["code"]
        self.assertTrue(Group.objects.filter(name=code).exists())

        saved = self.client.patch(
            reverse("accounts:role-permissions"),
            {"role": code, "permissions": ["contract.manage", "finance.view"]},
            format="json",
        )
        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertEqual(
            set(Group.objects.get(name=code).permissions.values_list("codename", flat=True)),
            {"contract.manage", "finance.view"},
        )

        profile = StaffProfile.objects.create(user=self.agent, full_name="کارشناس آزمون", branch="مرکز")
        assigned = self.client.patch(
            f"/accounts/consultants/{profile.pk}/",
            {"extra_roles": [code]},
            format="json",
        )
        self.assertEqual(assigned.status_code, 200, assigned.content)
        self.assertEqual(assigned.data["extra_roles"], [code])
        self.assertTrue({"contract.manage", "finance.view"}.issubset(permission_codes_for_user(self.agent)))
        self.assertEqual(self.agent.role, "AGENT")

    def test_custom_role_cannot_be_created_twice_with_the_same_name(self):
        self.client.force_authenticate(self.admin)
        self.client.post(reverse("accounts:role-permissions"), {"name": "بازبین اسناد"}, format="json")
        repeated = self.client.post(reverse("accounts:role-permissions"), {"name": "بازبین اسناد"}, format="json")

        self.assertEqual(repeated.status_code, 400, repeated.content)
        self.assertEqual(Role.objects.filter(name="بازبین اسناد").count(), 1)
