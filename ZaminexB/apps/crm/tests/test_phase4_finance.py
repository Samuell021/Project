from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from apps.crm import models
from apps.notifications.models import Notification
from apps.crm.tests.phase4_support import Phase4FixtureMixin


class FinanceWorkflowTests(Phase4FixtureMixin, TestCase):
    def test_commission_uses_published_policy_snapshot_and_keeps_history(self):
        contract, *_ = self.build_finalized_contract()
        policy, res = self.create_finance_commission(
            contract, shares=[{"beneficiary_user": self.agent2.pk, "share_percent": "40"}]
        )
        self.assertEqual(res.status_code, 201, res.content)
        commission = models.Commission.objects.get(pk=res.data["id"])
        self.assertEqual(commission.final_amount, Decimal("100000"))
        self.assertEqual(commission.calculation_snapshot["policy_version_id"], policy.pk)
        self.assertEqual(commission.calculation_snapshot["base_amount"], "1000000")
        self.assertEqual(commission.shares.get().amount, Decimal("40000"))
        policy.parameters = {"percent": "50"}
        policy.save()
        commission.refresh_from_db()
        self.assertEqual(commission.final_amount, Decimal("100000"))

    def test_share_total_cannot_exceed_claim(self):
        contract, *_ = self.build_finalized_contract()
        policy = models.CommissionPolicyVersion.objects.create(
            name="سیاست فروش دوم",
            deal_type=self.deal_type,
            version_number=2,
            calculation_method="FLAT",
            parameters={"flat_amount": "100000"},
            status=models.CommissionPolicyVersion.Status.PUBLISHED,
            effective_from=timezone.now(),
        )
        self.auth(self.finance)
        res = self.client.post(
            "/crm/api/commissions/create_from_contract/",
            {
                "contract": contract.pk,
                "debtor_contact": self.buyer.pk,
                "policy_version": policy.pk,
                "shares": [
                    {"beneficiary_user": self.agent.pk, "amount": "60000"},
                    {"beneficiary_user": self.agent2.pk, "amount": "60000"},
                ],
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400, res.content)
        self.assertFalse(models.Commission.objects.filter(contract=contract).exists())

    def test_partial_receipt_allocation_and_reversal_document(self):
        contract, *_ = self.build_finalized_contract()
        policy, res = self.create_finance_commission(contract)
        commission = models.Commission.objects.get(pk=res.data["id"])
        self.auth(self.finance)
        approve = self.client.post(f"/crm/api/commissions/{commission.pk}/approve/", {}, format="json")
        self.assertEqual(approve.status_code, 200, approve.content)
        receipt = self.client.post(
            "/crm/api/payments/",
            {
                "direction": "IN",
                "contact": self.buyer.pk,
                "amount": "60000",
                "paid_at": timezone.now().isoformat(),
                "allocations": [{"commission": commission.pk, "amount": "60000"}],
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY="receipt-partial-1",
        )
        self.assertEqual(receipt.status_code, 201, receipt.content)
        commission.refresh_from_db()
        self.assertEqual(commission.status, models.Commission.Status.PARTIALLY_PAID)
        detail = self.client.get(f"/crm/api/commissions/{commission.pk}/")
        self.assertEqual(detail.data["received_amount"], 60000)
        self.assertEqual(detail.data["remaining_amount"], 40000)
        overflow = self.client.post(
            "/crm/api/payments/",
            {
                "direction": "IN",
                "contact": self.buyer.pk,
                "amount": "50000",
                "paid_at": timezone.now().isoformat(),
                "allocations": [{"commission": commission.pk, "amount": "50000"}],
            },
            format="json",
        )
        self.assertEqual(overflow.status_code, 400)
        reversal = self.client.post(f"/crm/api/payments/{receipt.data['id']}/reverse/", {}, format="json")
        self.assertEqual(reversal.status_code, 201, reversal.content)
        self.assertEqual(Decimal(reversal.data["allocations"][0]["amount"]), Decimal("-60000"))
        repeated = self.client.post(
            f"/crm/api/payments/{receipt.data['id']}/reverse/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="receipt-partial-1",
        )
        self.assertEqual(repeated.status_code, 201, repeated.content)
        self.assertEqual(models.Payment.objects.filter(reversal_of_id=receipt.data["id"]).count(), 1)
        commission.refresh_from_db()
        self.assertEqual(commission.status, models.Commission.Status.APPROVED)
        self.assertEqual(commission_received(commission), Decimal("0"))

    def test_adjustment_requires_reason_and_cannot_drop_below_received(self):
        contract, *_ = self.build_finalized_contract()
        policy, res = self.create_finance_commission(contract)
        commission = models.Commission.objects.get(pk=res.data["id"])
        self.auth(self.finance)
        rejected = self.client.post(
            f"/crm/api/commissions/{commission.pk}/approve/",
            {"adjustment_amount": "-10000"},
            format="json",
        )
        self.assertEqual(rejected.status_code, 400)
        accepted = self.client.post(
            f"/crm/api/commissions/{commission.pk}/approve/",
            {"adjustment_amount": "-10000", "adjustment_reason": "تخفیف توافقی"},
            format="json",
        )
        self.assertEqual(accepted.status_code, 200, accepted.content)
        commission.refresh_from_db()
        self.assertEqual(commission.final_amount, Decimal("90000"))

    def test_finance_overview_is_scoped_and_lists_claim_states(self):
        contract, *_ = self.build_finalized_contract()
        policy, res = self.create_finance_commission(contract)
        commission = models.Commission.objects.get(pk=res.data["id"])
        self.auth(self.finance)
        self.client.post(f"/crm/api/commissions/{commission.pk}/approve/", {}, format="json")
        self.client.post(
            "/crm/api/payments/",
            {
                "direction": "IN",
                "contact": self.buyer.pk,
                "amount": "30000",
                "paid_at": timezone.now().isoformat(),
                "allocations": [{"commission": commission.pk, "amount": "30000"}],
            },
            format="json",
        )
        overview = self.client.get("/crm/api/finance/overview/")
        self.assertEqual(overview.status_code, 200, overview.content)
        self.assertEqual(len(overview.data["contracts"]), 1)
        row = overview.data["contracts"][0]
        self.assertEqual(Decimal(row["claimed"]), Decimal("100000"))
        self.assertEqual(Decimal(row["received"]), Decimal("30000"))
        self.assertEqual(Decimal(row["remaining"]), Decimal("70000"))
        self.assertEqual(row["deal_value"], "1000000")
        self.assertNotIn("owner_name", row)
        detail = self.client.get(f"/crm/api/finance/contracts/{contract.pk}/")
        self.assertEqual(detail.status_code, 200, detail.content)
        self.assertEqual(len(detail.data["claims"]), 1)
        self.assertTrue(detail.data["can_manage"])
        self.auth(self.agent)
        self.assertEqual(self.client.get("/crm/api/finance/overview/").status_code, 403)


def commission_received(commission):
    from apps.crm.services import finance_workflow

    return finance_workflow.commission_received(commission)


class FinanceNotificationTests(Phase4FixtureMixin, TestCase):
    def test_commission_creation_and_approval_notify_once_per_event(self):
        contract, *_ = self.build_finalized_contract()
        policy, res = self.create_finance_commission(contract)
        self.assertEqual(res.status_code, 201, res.content)
        commission = models.Commission.objects.get(pk=res.data["id"])
        created = Notification.objects.filter(type="commission_pending").exclude(user=self.finance)
        self.assertEqual(created.count(), 1)
        self.assertEqual(created.first().metadata["subject_id"], commission.pk)
        self.auth(self.finance)
        self.client.post(f"/crm/api/commissions/{commission.pk}/approve/", {"adjustment_amount": "0"}, format="json")
        approved = Notification.objects.filter(type="commission_approved").exclude(user=self.finance)
        self.assertEqual(approved.count(), 1)

    def test_reversal_notifies_the_reversing_document(self):
        contract, *_ = self.build_finalized_contract()
        policy, res = self.create_finance_commission(contract)
        commission = models.Commission.objects.get(pk=res.data["id"])
        self.auth(self.finance)
        self.client.post(f"/crm/api/commissions/{commission.pk}/approve/", {}, format="json")
        payment = self.client.post(
            "/crm/api/payments/",
            {
                "direction": "IN",
                "contact": self.buyer.pk,
                "amount": "30000",
                "paid_at": timezone.now().isoformat(),
                "allocations": [{"commission": commission.pk, "amount": "30000"}],
            },
            format="json",
        )
        self.assertEqual(payment.status_code, 201, payment.content)
        reversal = self.client.post(f"/crm/api/payments/{payment.data['id']}/reverse/", {}, format="json")
        self.assertEqual(reversal.status_code, 201, reversal.content)
        note = Notification.objects.filter(type="payment_reversed").exclude(user=self.finance).first()
        self.assertIsNotNone(note)
        self.assertEqual(note.metadata["subject_id"], reversal.data["id"])
