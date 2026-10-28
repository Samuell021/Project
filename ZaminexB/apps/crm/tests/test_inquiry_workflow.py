from datetime import timedelta

from django.contrib.auth.models import Group
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import ManagementScope, ScopeMembership, User
from apps.basics.models import City, DealType, DealTypeVersion, District, Province
from apps.crm import models
from apps.followups.models import FollowUp
from apps.listings.models import PropertyFile
from apps.properties.models import Property
from apps.tasks.models import Task


class InquiryFlowBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.gm = User.objects.create_user(username="gm-flow", password="x", role="ADMIN")
        self.manager = User.objects.create_user(username="rm-flow", password="x", role="RANGE_MANAGER")
        self.agent = User.objects.create_user(username="ag-flow", password="x", role="AGENT")
        self.agent2 = User.objects.create_user(username="ag2-flow", password="x", role="AGENT")
        self.finance = User.objects.create_user(username="fin-flow", password="x", role="FINANCE")
        for name in ["GENERAL_MANAGER", "RANGE_MANAGER", "AGENT", "FINANCE"]:
            Group.objects.get_or_create(name=name)
        self.gm.groups.add(Group.objects.get(name="GENERAL_MANAGER"))
        self.manager.groups.add(Group.objects.get(name="RANGE_MANAGER"))
        self.agent.groups.add(Group.objects.get(name="AGENT"))
        self.agent2.groups.add(Group.objects.get(name="AGENT"))
        self.finance.groups.add(Group.objects.get(name="FINANCE"))
        now = timezone.now()
        self.scope = ManagementScope.objects.create(name="رنج آزمون")
        ScopeMembership.objects.create(scope=self.scope, user=self.manager, membership_role="MANAGER", started_at=now)
        ScopeMembership.objects.create(scope=self.scope, user=self.agent, membership_role="MEMBER", started_at=now)
        ScopeMembership.objects.create(scope=self.scope, user=self.agent2, membership_role="MEMBER", started_at=now)
        province = Province.objects.create(name="province-flow", display_name="تهران")
        city = City.objects.create(name="city-flow", display_name="تهران", province=province)
        self.district = District.objects.create(name="district-flow", display_name="ونک", city=city)
        self.owner = models.Contact.objects.create(full_name="مالک آزمون", created_by=self.agent)
        models.ContactPhone.objects.create(contact=self.owner, phone="09121111111", normalized_phone="09121111111", is_primary=True)
        self.buyer = models.Contact.objects.create(full_name="متقاضی آزمون", created_by=self.agent2)
        models.ContactPhone.objects.create(contact=self.buyer, phone="09122222222", normalized_phone="09122222222", is_primary=True)
        self.deal_type, _ = DealType.objects.get_or_create(name="sale-flow", defaults={"display_name": "فروش", "family": "SALE"})
        self.sale_version = DealTypeVersion.objects.create(deal_type=self.deal_type, version_number=1, family="SALE", status=DealTypeVersion.Status.PUBLISHED, published_at=now)
        self.rent_type, _ = DealType.objects.get_or_create(name="rent-flow", defaults={"display_name": "رهن و اجاره", "family": "RENT"})
        self.rent_version = DealTypeVersion.objects.create(deal_type=self.rent_type, version_number=1, family="RENT", status=DealTypeVersion.Status.PUBLISHED, published_at=now)
        self.property = Property.objects.create(
            title="آپارتمان آزمون",
            internal_code="P-FLOW-1",
            consultant=self.agent2,
            property_type=Property.PropertyType.APARTMENT,
            area=120,
            rooms=3,
            address="تهران، ونک",
            district=self.district,
            review_status=Property.ReviewStatus.APPROVED,
            status=Property.Status.AVAILABLE,
        )
        models.PropertyParty.objects.create(property=self.property, contact=self.owner, role=models.PropertyParty.Role.OWNER, is_primary=True)
        self.listing = PropertyFile.objects.create(
            property=self.property,
            deal_type=self.deal_type,
            deal_type_version=self.sale_version,
            title="فروش آپارتمان آزمون",
            publish_channel=PropertyFile.PublishChannel.WEBSITE,
            created_by=self.agent2,
            assigned_to=self.agent2,
            status=PropertyFile.Status.ACTIVE,
            sale_price=1000000,
        )

    def auth(self, user):
        self.client.force_authenticate(user=user)

    def create_accepted_inquiry(self):
        self.auth(self.agent2)
        res = self.client.post("/crm/api/inquiries/", {"contact": self.buyer.pk, "description": "خریدار آزمون"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        inquiry = models.Inquiry.objects.get(pk=res.data["id"])
        self.auth(self.manager)
        self.assertEqual(self.client.post(f"/crm/api/inquiries/{inquiry.pk}/accept_lead/", {}, format="json").status_code, 200)
        self.assertEqual(self.client.post(f"/crm/api/inquiries/{inquiry.pk}/assign/", {"assigned_to": self.agent2.pk, "due_at": (timezone.now() + timedelta(days=3)).isoformat()}, format="json").status_code, 200)
        self.auth(self.agent2)
        self.assertEqual(self.client.post(f"/crm/api/inquiries/{inquiry.pk}/accept_assignment/", {}, format="json").status_code, 200)
        inquiry.refresh_from_db()
        return inquiry

    def save_needs(self, inquiry, **extra):
        payload = {
            "preferences": [
                {
                    "deal_type": self.deal_type.pk,
                    "max_amount": "1500000",
                    "max_deposit": "800000",
                    "districts": [self.district.pk],
                    "min_area": 80,
                    "min_rooms": 2,
                    "required_conditions": [{"label": "طبقه", "field": "area", "operator": "GTE", "value": 50}],
                }
            ],
            "version": inquiry.version,
        }
        payload.update(extra)
        self.auth(self.agent2)
        res = self.client.post(f"/crm/api/inquiries/{inquiry.pk}/save_needs/", payload, format="json")
        inquiry.refresh_from_db()
        return res

    def introduced(self, inquiry):
        self.auth(self.agent2)
        res = self.client.post(f"/crm/api/inquiries/{inquiry.pk}/introduce/", {"listing_id": self.listing.pk}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return models.Introduction.objects.get(pk=res.data["id"])

    def completed_viewing(self, intro):
        self.auth(self.agent2)
        res = self.client.post("/crm/api/viewings/", {"introduction": intro.pk, "scheduled_at": (timezone.now() + timedelta(days=1)).isoformat()}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        viewing = models.Viewing.objects.get(pk=res.data["id"])
        res = self.client.post(f"/crm/api/viewings/{viewing.pk}/complete/", {"result": "INTERESTED", "notes": "پسندید"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        viewing.refresh_from_db()
        return viewing

    def agreed_deal(self, inquiry, intro, viewing):
        self.auth(self.agent2)
        res = self.client.post("/crm/api/deals/", {"viewing": viewing.pk}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        deal = models.Deal.objects.get(pk=res.data["id"])
        res = self.client.post(f"/crm/api/deals/{deal.pk}/succeed/", {"result_notes": "توافق"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        deal.refresh_from_db()
        return deal

    def contract_with_terms(self, deal):
        self.auth(self.gm)
        res = self.client.post("/crm/api/contracts/", {"deal": deal.pk}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        contract = models.Contract.objects.get(pk=res.data["id"])
        res = self.client.post(f"/crm/api/contracts/{contract.pk}/save_terms/", {"terms": {"sale_price": 900000}, "version": contract.version}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        contract.refresh_from_db()
        return contract


class InquiryNeedsAndMatchingTests(InquiryFlowBase):
    def test_stage_and_version_conflict(self):
        inquiry = self.create_accepted_inquiry()
        stale = self.save_needs(inquiry, version=inquiry.version + 5)
        self.assertEqual(stale.status_code, 409, stale.content)
        self.assertEqual(stale.data["detail"], "پرونده توسط کاربر دیگری تغییر کرده است؛ اطلاعات را تازه کنید")
        ok = self.save_needs(inquiry)
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertEqual(ok.data["stage"], "matching")
        self.assertEqual(ok.data["stage_label"], "معرفی فایل")
        self.assertIsNotNone(ok.data["needs_confirmed_at"])
        self.assertEqual(len(ok.data["preferences"]), 1)
        self.assertEqual(ok.data["preferences"][0]["criteria"]["min_rooms"], 2)

    def test_matching_is_read_only_and_explains_reasons(self):
        inquiry = self.create_accepted_inquiry()
        self.assertEqual(self.save_needs(inquiry).status_code, 200)
        before = (
            models.Introduction.objects.count(),
            models.Deal.objects.count(),
            Task.objects.count(),
        )
        self.auth(self.agent2)
        res = self.client.get(f"/crm/api/inquiries/{inquiry.pk}/matches/")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data)
        top = res.data[0]
        self.assertTrue(top["matched"], top)
        self.assertEqual(top["match_percent"], 100)
        self.assertTrue(any(reason["label"] == "منطقه" and reason["passed"] for reason in top["reasons"]))
        after = (
            models.Introduction.objects.count(),
            models.Deal.objects.count(),
            Task.objects.count(),
        )
        self.assertEqual(before, after)

    def test_matching_reports_budget_blocker(self):
        inquiry = self.create_accepted_inquiry()
        self.assertEqual(self.save_needs(inquiry, preferences=[{"deal_type": self.deal_type.pk, "max_amount": "500000"}]).status_code, 200)
        self.auth(self.agent2)
        res = self.client.get(f"/crm/api/inquiries/{inquiry.pk}/matches/")
        self.assertEqual(res.status_code, 200, res.content)
        top = res.data[0]
        self.assertFalse(top["matched"])
        self.assertLess(top["match_percent"], 100)
        self.assertIn("مبلغ یا ودیعه خارج از بودجه است", top["blockers"])

    def test_needs_requires_accepted_assignment_and_valid_deal_type(self):
        self.auth(self.agent2)
        res = self.client.post("/crm/api/inquiries/", {"contact": self.buyer.pk}, format="json")
        inquiry = models.Inquiry.objects.get(pk=res.data["id"])
        res = self.client.post(f"/crm/api/inquiries/{inquiry.pk}/save_needs/", {"preferences": [{"deal_type": self.deal_type.pk}]}, format="json")
        self.assertEqual(res.status_code, 403)


class IntroductionAndViewingTests(InquiryFlowBase):
    def test_introduction_is_idempotent_and_keeps_snapshot(self):
        inquiry = self.create_accepted_inquiry()
        self.save_needs(inquiry)
        intro = self.introduced(inquiry)
        self.assertEqual(intro.introduced_terms_snapshot["sale_price"], "1000000")
        self.auth(self.agent2)
        again = self.client.post(f"/crm/api/inquiries/{inquiry.pk}/introduce/", {"listing_id": self.listing.pk}, format="json")
        self.assertEqual(again.status_code, 200, again.content)
        self.assertEqual(again.data["id"], intro.pk)
        self.assertEqual(models.Introduction.objects.filter(inquiry=inquiry).count(), 1)
        self.listing.sale_price = 2000000
        self.listing.save()
        intro.refresh_from_db()
        self.assertEqual(intro.introduced_terms_snapshot["sale_price"], "1000000")

    def test_introduction_requires_rejection_reason(self):
        inquiry = self.create_accepted_inquiry()
        self.save_needs(inquiry)
        intro = self.introduced(inquiry)
        self.auth(self.agent2)
        res = self.client.post(f"/crm/api/introductions/{intro.pk}/feedback/", {"customer_interest": "NOT_INTERESTED"}, format="json")
        self.assertEqual(res.status_code, 400, res.content)
        self.assertIn("rejection_reason", res.data)
        res = self.client.post(f"/crm/api/introductions/{intro.pk}/feedback/", {"customer_interest": "NOT_INTERESTED", "rejection_reason": "قیمت بالا"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        intro.refresh_from_db()
        self.assertEqual(intro.status, models.Introduction.Status.CLOSED)
        self.assertEqual(intro.rejection_reason, "قیمت بالا")

    def test_viewing_schedules_task_and_completion_closes_it(self):
        inquiry = self.create_accepted_inquiry()
        self.save_needs(inquiry)
        intro = self.introduced(inquiry)
        scheduled = timezone.now() + timedelta(days=2)
        self.auth(self.agent2)
        res = self.client.post("/crm/api/viewings/", {"introduction": intro.pk, "scheduled_at": scheduled.isoformat()}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        viewing = models.Viewing.objects.get(pk=res.data["id"])
        self.assertIsNotNone(viewing.task_id)
        self.assertEqual(viewing.task.inquiry_id, inquiry.pk)
        self.assertEqual(viewing.task.due_date, scheduled.date())
        res = self.client.post(f"/crm/api/viewings/{viewing.pk}/complete/", {"result": "INTERESTED"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        viewing.task.refresh_from_db()
        self.assertEqual(viewing.task.status, Task.Status.COMPLETED)
        intro.refresh_from_db()
        self.assertEqual(intro.customer_interest, models.Introduction.Interest.INTERESTED)
        repeat = self.client.post(f"/crm/api/viewings/{viewing.pk}/complete/", {"result": "INTERESTED"}, format="json")
        self.assertEqual(repeat.status_code, 200, repeat.content)


class DealAndContractTests(InquiryFlowBase):
    def prepare_deal(self):
        inquiry = self.create_accepted_inquiry()
        self.save_needs(inquiry)
        intro = self.introduced(inquiry)
        viewing = self.completed_viewing(intro)
        deal = self.agreed_deal(inquiry, intro, viewing)
        return inquiry, intro, viewing, deal

    def test_deal_requires_positive_viewing_and_participants(self):
        inquiry = self.create_accepted_inquiry()
        self.save_needs(inquiry)
        intro = self.introduced(inquiry)
        self.auth(self.agent2)
        res = self.client.post("/crm/api/deals/", {"introduction": intro.pk}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        deal = models.Deal.objects.get(pk=res.data["id"])
        roles = set(deal.participants.values_list("participant_role", flat=True))
        self.assertEqual(roles, {"BUYER", "SELLER"})
        res = self.client.post(f"/crm/api/deals/{deal.pk}/close/", {}, format="json")
        self.assertEqual(res.status_code, 400)
        res = self.client.post(f"/crm/api/deals/{deal.pk}/close/", {"closure_reason": "عدم توافق"}, format="json")
        self.assertEqual(res.status_code, 200)
        deal.refresh_from_db()
        self.assertEqual(deal.stage, models.Deal.Stage.LOST)

    def test_full_contract_cycle_and_commission(self):
        inquiry, intro, viewing, deal = self.prepare_deal()
        self.assertEqual(deal.stage, models.Deal.Stage.AGREED)
        self.assertTrue(Task.objects.filter(inquiry=inquiry, task_type=Task.TaskType.CONTRACT, status=Task.Status.PENDING).exists())
        models.CommissionPolicyVersion.objects.create(name="سیاست فروش", deal_type=self.deal_type, version_number=1, calculation_method="PERCENT", parameters={"percent": "2"}, status="PUBLISHED")
        contract = self.contract_with_terms(deal)
        deal.refresh_from_db()
        self.assertEqual(deal.stage, models.Deal.Stage.CONTRACT)
        self.assertEqual(contract.terms_snapshot, {"sale_price": 900000})
        self.assertFalse(Task.objects.filter(inquiry=inquiry, task_type=Task.TaskType.CONTRACT, status=Task.Status.PENDING).exists())
        self.auth(self.gm)
        early = self.client.post(f"/crm/api/contracts/{contract.pk}/finalize/", {}, format="json")
        self.assertEqual(early.status_code, 400, early.content)
        for party in contract.parties.all():
            res = self.client.post(f"/crm/api/contracts/{contract.pk}/sign/", {"contract_party": party.pk}, format="json")
            self.assertEqual(res.status_code, 200, res.content)
        res = self.client.post(f"/crm/api/contracts/{contract.pk}/finalize/", {}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        contract.refresh_from_db()
        self.assertEqual(contract.status, models.Contract.Status.FINALIZED)
        deal.refresh_from_db()
        self.assertEqual(deal.stage, models.Deal.Stage.FINALIZED)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.status, PropertyFile.Status.SOLD)
        inquiry.refresh_from_db()
        self.assertEqual(inquiry.status, models.CaseStatus.COMPLETED)
        commission = models.Commission.objects.get(contract=contract)
        self.assertEqual(commission.final_amount, 18000)

    def test_contract_terms_must_match_schema(self):
        inquiry, intro, viewing, deal = self.prepare_deal()
        self.auth(self.gm)
        res = self.client.post("/crm/api/contracts/", {"deal": deal.pk}, format="json")
        contract = models.Contract.objects.get(pk=res.data["id"])
        res = self.client.post(f"/crm/api/contracts/{contract.pk}/save_terms/", {"terms": {"sale_price": "abc"}}, format="json")
        self.assertEqual(res.status_code, 400, res.content)
        self.assertIn("sale_price", res.data)
        res = self.client.post(f"/crm/api/contracts/{contract.pk}/save_terms/", {"terms": {"deposit": 1000}}, format="json")
        self.assertEqual(res.status_code, 400)
        res = self.client.post(f"/crm/api/contracts/{contract.pk}/save_terms/", {"terms": {"sale_price": 900000}}, format="json")
        self.assertEqual(res.status_code, 200)
        contract.refresh_from_db()
        party = contract.parties.first()
        self.client.post(f"/crm/api/contracts/{contract.pk}/sign/", {"contract_party": party.pk}, format="json")
        locked = self.client.post(f"/crm/api/contracts/{contract.pk}/save_terms/", {"terms": {"sale_price": 800000}}, format="json")
        self.assertEqual(locked.status_code, 400)

    def test_conflicting_finalized_contract_is_blocked_and_state_is_unchanged(self):
        inquiry, intro, viewing, deal = self.prepare_deal()
        contract = self.contract_with_terms(deal)
        other_contact = models.Contact.objects.create(full_name="طرف دیگر", created_by=self.gm)
        second_type, _ = DealType.objects.get_or_create(name="sale-flow-2", defaults={"display_name": "فروش دوم", "family": "SALE"})
        second_version = DealTypeVersion.objects.create(deal_type=second_type, version_number=1, family="SALE", status=DealTypeVersion.Status.PUBLISHED)
        second_listing = PropertyFile.objects.create(
            property=self.property,
            deal_type=second_type,
            deal_type_version=second_version,
            title="فایل دوم",
            publish_channel=PropertyFile.PublishChannel.WEBSITE,
            created_by=self.agent,
            assigned_to=self.agent,
            status=PropertyFile.Status.ACTIVE,
            sale_price=1100000,
        )
        second_intro = models.Introduction.objects.create(inquiry=inquiry, property_file=second_listing, introduced_by=self.agent2, buyer_consultant=self.agent2, seller_consultant=self.agent)
        second_deal = models.Deal.objects.create(introduction=second_intro, property_file=second_listing, inquiry=inquiry, assigned_to=self.agent2, deal_type_version=second_version, stage=models.Deal.Stage.CONTRACT)
        conflict = models.Contract.objects.create(
            deal=second_deal,
            contract_number="C-CONFLICT-1",
            deal_type_version=second_version,
            terms_snapshot={"sale_price": 1},
            status=models.Contract.Status.FINALIZED,
            created_by=self.gm,
        )
        models.ContractParty.objects.create(contract=conflict, contact=other_contact, party_role="BUYER")
        self.auth(self.gm)
        for party in contract.parties.all():
            self.client.post(f"/crm/api/contracts/{contract.pk}/sign/", {"contract_party": party.pk}, format="json")
        res = self.client.post(f"/crm/api/contracts/{contract.pk}/finalize/", {}, format="json")
        self.assertEqual(res.status_code, 400, res.content)
        contract.refresh_from_db()
        deal.refresh_from_db()
        self.listing.refresh_from_db()
        inquiry.refresh_from_db()
        self.assertEqual(contract.status, models.Contract.Status.SIGNING)
        self.assertEqual(deal.stage, models.Deal.Stage.CONTRACT)
        self.assertEqual(self.listing.status, PropertyFile.Status.ACTIVE)
        self.assertEqual(inquiry.status, models.CaseStatus.ACTIVE)

    def test_finance_cannot_advance_deal_or_create_contract(self):
        inquiry, intro, viewing, deal = self.prepare_deal()
        self.auth(self.finance)
        res = self.client.post(f"/crm/api/deals/{deal.pk}/succeed/", {}, format="json")
        self.assertEqual(res.status_code, 403)
        res = self.client.post("/crm/api/contracts/", {"deal": deal.pk}, format="json")
        self.assertEqual(res.status_code, 403)
        self.auth(self.gm)
        res = self.client.post("/crm/api/contracts/", {"deal": deal.pk}, format="json")
        self.assertEqual(res.status_code, 201, res.content)

    def test_amendment_requires_reason_and_effective_date(self):
        inquiry, intro, viewing, deal = self.prepare_deal()
        contract = self.contract_with_terms(deal)
        self.auth(self.gm)
        for party in contract.parties.all():
            self.client.post(f"/crm/api/contracts/{contract.pk}/sign/", {"contract_party": party.pk}, format="json")
        self.assertEqual(self.client.post(f"/crm/api/contracts/{contract.pk}/finalize/", {}, format="json").status_code, 200)
        res = self.client.post(f"/crm/api/contracts/{contract.pk}/amendments/", {"reason": "تغییر مبلغ", "new_terms_snapshot": {"sale_price": 950000}}, format="json")
        self.assertEqual(res.status_code, 400, res.content)
        self.assertIn("effective_at", res.data)
        res = self.client.post(
            f"/crm/api/contracts/{contract.pk}/amendments/",
            {"reason": "تغییر مبلغ", "new_terms_snapshot": {"sale_price": 950000}, "effective_at": timezone.now().isoformat()},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        contract.refresh_from_db()
        self.assertEqual(contract.terms_snapshot, {"sale_price": 900000})
        self.assertEqual(contract.amendments.count(), 1)


class FollowUpCommandTests(InquiryFlowBase):
    def test_follow_up_reschedule_and_complete(self):
        inquiry = self.create_accepted_inquiry()
        self.auth(self.agent2)
        res = self.client.post(
            "/followups/api/followups/",
            {
                "title": "تماس با متقاضی",
                "type": "Call",
                "contact": "متقاضی آزمون",
                "date": (timezone.now() + timedelta(days=1)).isoformat(),
                "consultantId": self.agent2.pk,
                "inquiryId": inquiry.pk,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        followup = FollowUp.objects.get(pk=res.data["id"])
        self.assertEqual(followup.inquiry_id, inquiry.pk)
        self.assertTrue(Task.objects.filter(inquiry=inquiry, task_type=Task.TaskType.FOLLOW_UP, title="پیگیری: تماس با متقاضی").exists())
        res = self.client.post(f"/followups/api/followups/{followup.pk}/reschedule/", {"scheduled_at": (timezone.now() + timedelta(days=3)).isoformat()}, format="json")
        self.assertEqual(res.status_code, 400, res.content)
        res = self.client.post(
            f"/followups/api/followups/{followup.pk}/reschedule/",
            {"scheduled_at": (timezone.now() + timedelta(days=3)).isoformat(), "reason": "سفر متقاضی"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        followup.refresh_from_db()
        self.assertEqual(len(followup.reschedule_history), 1)
        self.assertEqual(followup.reschedule_history[0]["reason"], "سفر متقاضی")
        res = self.client.post(f"/followups/api/followups/{followup.pk}/complete/", {}, format="json")
        self.assertEqual(res.status_code, 400, res.content)
        res = self.client.post(f"/followups/api/followups/{followup.pk}/complete/", {"outcome": "پاسخ نداد", "next_action": "تماس دوباره"}, format="json")
        self.assertEqual(res.status_code, 400, res.content)
        next_at = timezone.now() + timedelta(days=5)
        res = self.client.post(
            f"/followups/api/followups/{followup.pk}/complete/",
            {"outcome": "پاسخ نداد", "next_action": "تماس دوباره", "next_action_at": next_at.isoformat()},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        followup.refresh_from_db()
        self.assertEqual(followup.status, "completed")
        self.assertIsNotNone(followup.completed_at)
        self.assertIsNotNone(res.data["next_follow_up"])
        self.assertEqual(FollowUp.objects.filter(inquiry=inquiry, status="scheduled").count(), 1)


class IdempotencyAndGuardTests(InquiryFlowBase):
    def test_viewing_creation_is_idempotent_for_the_same_time(self):
        inquiry = self.create_accepted_inquiry()
        self.save_needs(inquiry)
        intro = self.introduced(inquiry)
        self.auth(self.agent2)
        payload = {"introduction": intro.pk, "scheduled_at": (timezone.now() + timedelta(days=1)).isoformat()}
        first = self.client.post("/crm/api/viewings/", payload, format="json")
        second = self.client.post("/crm/api/viewings/", payload, format="json")
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(second.status_code, 200, second.content)
        self.assertEqual(first.data["id"], second.data["id"])
        self.assertEqual(models.Viewing.objects.filter(introduction=intro).count(), 1)
        self.assertEqual(Task.objects.filter(inquiry=inquiry, task_type=Task.TaskType.VIEWING).count(), 1)

    def test_finalize_is_idempotent_and_keeps_a_single_commission(self):
        inquiry = self.create_accepted_inquiry()
        self.save_needs(inquiry)
        intro = self.introduced(inquiry)
        viewing = self.completed_viewing(intro)
        deal = self.agreed_deal(inquiry, intro, viewing)
        models.CommissionPolicyVersion.objects.create(name="سیاست فروش", deal_type=self.deal_type, version_number=1, calculation_method="PERCENT", parameters={"percent": "2"}, status="PUBLISHED")
        contract = self.contract_with_terms(deal)
        for party in contract.parties.all():
            self.client.post(f"/crm/api/contracts/{contract.pk}/sign/", {"contract_party": party.pk}, format="json")
        first = self.client.post(f"/crm/api/contracts/{contract.pk}/finalize/", {}, format="json")
        second = self.client.post(f"/crm/api/contracts/{contract.pk}/finalize/", {}, format="json")
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(second.status_code, 200, second.content)
        self.assertEqual(models.Commission.objects.filter(contract=contract).count(), 1)

    def test_finance_cannot_change_inquiry_stage_or_assignment(self):
        inquiry = self.create_accepted_inquiry()
        self.auth(self.finance)
        close = self.client.post(f"/crm/api/inquiries/{inquiry.pk}/change_status/", {"status": "CLOSED", "reason": "تلاش مالی"}, format="json")
        assign = self.client.post(f"/crm/api/inquiries/{inquiry.pk}/assign/", {"assigned_to": self.agent.pk, "due_at": (timezone.now() + timedelta(days=2)).isoformat()}, format="json")
        self.assertIn(close.status_code, (403, 404), close.content)
        self.assertIn(assign.status_code, (403, 404), assign.content)
        inquiry.refresh_from_db()
        self.assertEqual(inquiry.status, models.CaseStatus.ACTIVE)
        self.assertEqual(inquiry.assigned_to_id, self.agent2.pk)

    def test_closed_inquiry_blocks_needs_and_introduction(self):
        inquiry = self.create_accepted_inquiry()
        self.auth(self.manager)
        closed = self.client.post(f"/crm/api/inquiries/{inquiry.pk}/change_status/", {"status": "CLOSED", "reason": "انصراف متقاضی"}, format="json")
        self.assertEqual(closed.status_code, 200, closed.content)
        inquiry.refresh_from_db()
        needs = self.save_needs(inquiry)
        self.assertEqual(needs.status_code, 400, needs.content)
        self.auth(self.agent2)
        intro = self.client.post(f"/crm/api/inquiries/{inquiry.pk}/introduce/", {"listing_id": self.listing.pk}, format="json")
        self.assertEqual(intro.status_code, 400, intro.content)
        self.assertFalse(models.Introduction.objects.filter(inquiry=inquiry).exists())
