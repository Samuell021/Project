from django.contrib import admin
from django.contrib.auth.models import Group
from django.test import RequestFactory, TestCase
from rest_framework.test import APIClient

from apps.accounts import models as account_models
from apps.accounts.models import User
from apps.basics import models as basic_models
from apps.crm import models
from apps.listings import models as listing_models


class AdminRegistrationTests(TestCase):
    def test_all_crm_models_are_registered(self):
        registered = set(admin.site._registry)
        expected = {
            models.Contact,
            models.ContactPhone,
            models.PropertyContact,
            models.PropertyRegistrationRequest,
            models.RegistrationRequestDealType,
            models.PropertyAppraisal,
            models.PropertyReview,
            models.AssignmentHistory,
            models.AssignmentRescheduleRequest,
            models.ConsultantWithdrawalRequest,
            models.Inquiry,
            models.InquiryPreference,
            models.Introduction,
            models.Viewing,
            models.Deal,
            models.DealParticipant,
            models.Contract,
            models.ContractParty,
            models.ContractSignature,
            models.ContractAttachment,
            models.ContractAmendment,
            models.CommissionPolicyVersion,
            models.Commission,
            models.CommissionShare,
            models.Payment,
            models.PaymentAllocation,
            models.StageTransitionHistory,
            models.CommandReceipt,
            models.WorkflowSettings,
        }
        self.assertTrue(expected.issubset(registered))

    def test_related_new_models_are_registered(self):
        registered = set(admin.site._registry)
        self.assertIn(basic_models.DealTypeVersion, registered)
        self.assertIn(account_models.ManagementScope, registered)
        self.assertIn(account_models.ScopeMembership, registered)
        self.assertIn(account_models.ScopeTransferHistory, registered)
        self.assertIn(listing_models.ListingPriceHistory, registered)

    def test_history_admins_are_read_only(self):
        for model in (models.AssignmentHistory, models.StageTransitionHistory, models.CommandReceipt, listing_models.ListingPriceHistory):
            model_admin = admin.site._registry[model]
            request = RequestFactory().get("/admin/")
            self.assertFalse(model_admin.has_add_permission(request))
            self.assertFalse(model_admin.has_change_permission(request))
            self.assertFalse(model_admin.has_delete_permission(request))


class WorkflowSettingsApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.gm = User.objects.create_user(username="gm-settings", password="x", role="AGENT")
        self.gm.groups.add(Group.objects.get_or_create(name="GENERAL_MANAGER")[0])
        self.agent = User.objects.create_user(username="agent-settings", password="x", role="AGENT")

    def test_general_manager_can_read_and_update_settings(self):
        self.client.force_authenticate(user=self.gm)
        response = self.client.get("/crm/api/workflow-settings/current/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data["assignment_waiting_hours"], 48)
        response = self.client.patch("/crm/api/workflow-settings/current/", {"assignment_waiting_hours": 72, "default_assignment_due_days": 9}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data["assignment_waiting_hours"], 72)
        self.assertEqual(models.WorkflowSettings.objects.count(), 1)
        self.assertEqual(models.WorkflowSettings.load().default_assignment_due_days, 9)
        self.assertEqual(models.WorkflowSettings.load().updated_by, self.gm)

    def test_non_general_manager_cannot_access_settings(self):
        self.client.force_authenticate(user=self.agent)
        response = self.client.get("/crm/api/workflow-settings/current/")
        self.assertEqual(response.status_code, 403)
        response = self.client.patch("/crm/api/workflow-settings/current/", {"assignment_waiting_hours": 1}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_general_manager_group_can_enter_django_admin(self):
        request = RequestFactory().get("/admin/")
        request.user = self.gm
        self.assertTrue(admin.site.has_permission(request))
        request.user = self.agent
        self.assertFalse(admin.site.has_permission(request))
