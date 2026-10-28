from datetime import timedelta

from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import ManagementScope, ScopeMembership, User
from apps.basics.models import City, DealType, DealTypeVersion, District, Province
from apps.crm import models
from apps.listings.models import PropertyFile


class Phase4FixtureMixin:
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="gm-p4", password="x", role="ADMIN")
        self.manager = User.objects.create_user(username="rm-p4", password="x", role="RANGE_MANAGER")
        self.agent = User.objects.create_user(username="ag-p4", password="x", role="AGENT")
        self.agent2 = User.objects.create_user(username="ag2-p4", password="x", role="AGENT")
        self.finance = User.objects.create_user(username="fin-p4", password="x", role="FINANCE")
        for name in ["GENERAL_MANAGER", "RANGE_MANAGER", "AGENT", "FINANCE"]:
            Group.objects.get_or_create(name=name)
        self.admin.groups.add(Group.objects.get(name="GENERAL_MANAGER"))
        self.manager.groups.add(Group.objects.get(name="RANGE_MANAGER"))
        self.agent.groups.add(Group.objects.get(name="AGENT"))
        self.agent2.groups.add(Group.objects.get(name="AGENT"))
        self.finance.groups.add(Group.objects.get(name="FINANCE"))
        self.scope = ManagementScope.objects.create(name="رنج آزمون چهار")
        now = timezone.now()
        ScopeMembership.objects.create(scope=self.scope, user=self.manager, membership_role="MANAGER", started_at=now)
        ScopeMembership.objects.create(scope=self.scope, user=self.agent, membership_role="MEMBER", started_at=now)
        ScopeMembership.objects.create(scope=self.scope, user=self.agent2, membership_role="MEMBER", started_at=now)
        province = Province.objects.create(name="tehran-p4", display_name="تهران")
        city = City.objects.create(name="tehran-city-p4", display_name="تهران", province=province)
        self.district = District.objects.create(name="vanak-p4", display_name="ونک", city=city)
        self.owner = models.Contact.objects.create(full_name="مالک آزمون", created_by=self.manager)
        models.ContactPhone.objects.create(
            contact=self.owner, phone="09121111111", normalized_phone="09121111111", is_primary=True
        )
        self.buyer = models.Contact.objects.create(full_name="خریدار آزمون", created_by=self.agent)
        models.ContactPhone.objects.create(
            contact=self.buyer, phone="09122222222", normalized_phone="09122222222", is_primary=True
        )
        self.deal_type, _ = DealType.objects.get_or_create(name="sale-p4", defaults={"display_name": "فروش"})
        DealTypeVersion.objects.get_or_create(
            deal_type=self.deal_type,
            version_number=1,
            defaults={"status": DealTypeVersion.Status.PUBLISHED, "published_at": timezone.now()},
        )

    def auth(self, user):
        self.client.force_authenticate(user=user)

    def create_finance_commission(self, contract, *, shares=None, base_amount="1000000", percent="10"):
        policy = models.CommissionPolicyVersion.objects.create(
            name="سیاست فروش آزمون",
            deal_type=self.deal_type,
            version_number=models.CommissionPolicyVersion.objects.filter(deal_type=self.deal_type).count() + 1,
            calculation_method="PERCENT",
            parameters={"percent": percent},
            status=models.CommissionPolicyVersion.Status.PUBLISHED,
            effective_from=timezone.now(),
        )
        self.auth(self.finance)
        response = self.client.post(
            "/crm/api/commissions/create_from_contract/",
            {
                "contract": contract.pk,
                "debtor_contact": self.buyer.pk,
                "policy_version": policy.pk,
                "base_amount": base_amount,
                "shares": shares or [],
            },
            format="json",
        )
        return policy, response

    def make_approved_case(self):
        self.auth(self.agent)
        res = self.client.post(
            "/crm/api/property-cases/",
            {"contact": self.owner.pk, "description": "سرنخ آزمون"},
            format="json",
        )
        assert res.status_code == 201, res.content
        case = models.PropertyRegistrationRequest.objects.get(pk=res.data["id"])
        self.auth(self.manager)
        res = self.client.post(f"/crm/api/property-cases/{case.pk}/accept_lead/", {}, format="json")
        assert res.status_code == 200, res.content
        res = self.client.post(
            f"/crm/api/property-cases/{case.pk}/assign/",
            {"assigned_to": self.agent.pk, "due_at": (timezone.now() + timedelta(days=5)).isoformat()},
            format="json",
        )
        assert res.status_code == 200, res.content
        self.auth(self.agent)
        res = self.client.post(f"/crm/api/property-cases/{case.pk}/accept_assignment/", {}, format="json")
        assert res.status_code == 200, res.content
        res = self.client.post(
            f"/crm/api/property-cases/{case.pk}/save_workspace/",
            {
                "address": "تهران ونک",
                "district": self.district.pk,
                "area": 120,
                "rooms": 3,
                "report_text": "گزارش کامل",
                "is_complete": True,
                "findings": {"visit": "done"},
            },
            format="json",
        )
        assert res.status_code == 200, res.content
        res = self.client.post(f"/crm/api/property-cases/{case.pk}/submit_review/", {}, format="json")
        assert res.status_code == 201, res.content
        self.auth(self.manager)
        res = self.client.post(
            f"/crm/api/property-cases/{case.pk}/review/",
            {"decision": "APPROVED", "property_title": "آپارتمان آزمون"},
            format="json",
        )
        assert res.status_code == 200, res.content
        case.refresh_from_db()
        return case

    def make_listing(self, case, status="ACTIVE"):
        self.auth(self.agent)
        res = self.client.post(
            "/crm/api/crm-listings/save_listing/",
            {
                "property": case.resulting_property_id,
                "deal_type": self.deal_type.pk,
                "sale_price": "1000000",
                "status": status,
            },
            format="json",
        )
        assert res.status_code == 200, res.content
        return PropertyFile.objects.get(property_id=case.resulting_property_id, deal_type=self.deal_type)

    def make_assigned_inquiry(self):
        self.auth(self.agent2)
        res = self.client.post(
            "/crm/api/inquiries/", {"contact": self.buyer.pk, "description": "خریدار آزمون"}, format="json"
        )
        assert res.status_code == 201, res.content
        inquiry = models.Inquiry.objects.get(pk=res.data["id"])
        self.auth(self.manager)
        self.client.post(f"/crm/api/inquiries/{inquiry.pk}/accept_lead/", {}, format="json")
        self.client.post(
            f"/crm/api/inquiries/{inquiry.pk}/assign/",
            {"assigned_to": self.agent2.pk, "due_at": (timezone.now() + timedelta(days=5)).isoformat()},
            format="json",
        )
        self.auth(self.agent2)
        self.client.post(f"/crm/api/inquiries/{inquiry.pk}/accept_assignment/", {}, format="json")
        inquiry.refresh_from_db()
        return inquiry

    def build_finalized_contract(self, sale_price="1000000"):
        case = self.make_approved_case()
        listing = self.make_listing(case)
        inquiry = self.make_assigned_inquiry()
        self.auth(self.agent2)
        self.client.post(
            f"/crm/api/inquiries/{inquiry.pk}/save_needs/",
            {
                "preferences": [
                    {
                        "deal_type": self.deal_type.pk,
                        "max_amount": "2000000",
                        "min_area": 50,
                        "districts": [self.district.pk],
                    }
                ],
                "version": inquiry.version,
            },
            format="json",
        )
        res = self.client.post(
            f"/crm/api/inquiries/{inquiry.pk}/introduce/", {"listing_id": listing.pk}, format="json"
        )
        assert res.status_code == 201, res.content
        intro = models.Introduction.objects.get(pk=res.data["id"])
        res = self.client.post(
            "/crm/api/viewings/",
            {"introduction": intro.pk, "scheduled_at": (timezone.now() + timedelta(days=1)).isoformat()},
            format="json",
        )
        assert res.status_code == 201, res.content
        viewing = models.Viewing.objects.get(pk=res.data["id"])
        self.client.post(f"/crm/api/viewings/{viewing.pk}/complete/", {"result": "INTERESTED"}, format="json")
        res = self.client.post(
            f"/crm/api/viewings/{viewing.pk}/start_deal/",
            {
                "participants": [
                    {"contact": self.buyer.pk, "participant_role": "BUYER", "is_primary": True},
                    {"contact": self.owner.pk, "participant_role": "SELLER", "is_primary": True},
                ]
            },
            format="json",
        )
        assert res.status_code == 201, res.content
        deal = models.Deal.objects.get(pk=res.data["id"])
        self.auth(self.agent2)
        self.client.post(f"/crm/api/deals/{deal.pk}/succeed/", {"result_notes": "توافق"}, format="json")
        self.auth(self.admin)
        res = self.client.post("/crm/api/contracts/", {"deal": deal.pk}, format="json")
        assert res.status_code == 201, res.content
        contract = models.Contract.objects.get(pk=res.data["id"])
        self.client.post(
            f"/crm/api/contracts/{contract.pk}/save_terms/",
            {"sale_price": sale_price, "terms_snapshot": {"note": "شرایط"}},
            format="json",
        )
        for party in contract.parties.all():
            self.client.post(
                f"/crm/api/contracts/{contract.pk}/sign/", {"contract_party": party.pk}, format="json"
            )
        res = self.client.post(f"/crm/api/contracts/{contract.pk}/finalize/", {}, format="json")
        assert res.status_code == 200, res.content
        contract.refresh_from_db()
        return contract, case, listing, inquiry
