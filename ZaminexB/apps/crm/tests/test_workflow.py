from datetime import timedelta
from decimal import Decimal
from tempfile import TemporaryDirectory

from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import ManagementScope, ScopeMembership, User
from apps.basics.models import DealType, DealTypeVersion, District, City, Province
from apps.crm import models
from apps.crm.views import pipeline_stage
from apps.listings.models import Listing
from apps.properties.models import Property
from apps.tasks.models import Task
from apps.followups.models import FollowUp, FollowUpType


class CrmWorkflowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="gm", password="x", role="ADMIN")
        self.manager = User.objects.create_user(username="rm", password="x", role="RANGE_MANAGER")
        self.agent = User.objects.create_user(username="ag1", password="x", role="AGENT")
        self.agent2 = User.objects.create_user(username="ag2", password="x", role="AGENT")
        self.finance = User.objects.create_user(username="fin", password="x", role="FINANCE")
        for name in ["GENERAL_MANAGER", "RANGE_MANAGER", "AGENT", "FINANCE"]:
            Group.objects.get_or_create(name=name)
        self.admin.groups.add(Group.objects.get(name="GENERAL_MANAGER"))
        self.manager.groups.add(Group.objects.get(name="RANGE_MANAGER"))
        self.agent.groups.add(Group.objects.get(name="AGENT"))
        self.agent2.groups.add(Group.objects.get(name="AGENT"))
        self.finance.groups.add(Group.objects.get(name="FINANCE"))
        self.scope = ManagementScope.objects.create(name="شمال")
        now = timezone.now()
        ScopeMembership.objects.create(scope=self.scope, user=self.manager, membership_role="MANAGER", started_at=now)
        ScopeMembership.objects.create(scope=self.scope, user=self.agent, membership_role="MEMBER", started_at=now)
        ScopeMembership.objects.create(scope=self.scope, user=self.agent2, membership_role="MEMBER", started_at=now)
        province = Province.objects.create(name="tehran", display_name="تهران")
        city = City.objects.create(name="tehran-city", display_name="تهران", province=province)
        self.district = District.objects.create(name="vanak", display_name="ونک", city=city)
        self.contact = models.Contact.objects.create(full_name="مالک تست", created_by=self.manager)
        models.ContactPhone.objects.create(contact=self.contact, phone="09120000000", normalized_phone="09120000000", is_primary=True)
        self.buyer = models.Contact.objects.create(full_name="متقاضی تست", created_by=self.agent)
        self.deal_type, _ = DealType.objects.get_or_create(name="sale", defaults={"display_name": "فروش"})
        DealTypeVersion.objects.get_or_create(deal_type=self.deal_type, version_number=1, defaults={"status": DealTypeVersion.Status.PUBLISHED, "published_at": timezone.now()})

    def auth(self, user):
        self.client.force_authenticate(user=user)

    def make_case(self):
        self.auth(self.agent)
        res = self.client.post("/crm/api/property-cases/", {"contact": self.contact.pk, "description": "سرنخ تست"}, format="json")
        assert res.status_code == 201, res.content
        return models.PropertyRegistrationRequest.objects.get(pk=res.data["id"])

    def approve_property(self, case):
        self.auth(self.manager)
        res = self.client.post(f"/crm/api/property-cases/{case.pk}/accept_lead/", {}, format="json")
        assert res.status_code == 200, res.content
        res = self.client.post(f"/crm/api/property-cases/{case.pk}/assign/", {"assigned_to": self.agent.pk, "due_at": (timezone.now() + timedelta(days=5)).isoformat()}, format="json")
        assert res.status_code == 200, res.content
        self.auth(self.agent)
        res = self.client.post(f"/crm/api/property-cases/{case.pk}/accept_assignment/", {}, format="json")
        assert res.status_code == 200, res.content
        res = self.client.post(f"/crm/api/property-cases/{case.pk}/save_workspace/", {"address": "تهران ونک", "district": self.district.pk, "area": 120, "rooms": 3, "report_text": "گزارش کامل", "is_complete": True, "findings": {"visit": "done"}}, format="json")
        assert res.status_code == 200, res.content
        res = self.client.post(f"/crm/api/property-cases/{case.pk}/submit_review/", {}, format="json")
        assert res.status_code == 201, res.content
        self.auth(self.manager)
        res = self.client.post(f"/crm/api/property-cases/{case.pk}/review/", {"decision": "APPROVED", "property_title": "آپارتمان ونک"}, format="json")
        assert res.status_code == 200, res.content
        case.refresh_from_db()
        return case

    def test_full_cycle_to_finalized_contract_and_finance(self):
        case = self.make_case()
        self.assertEqual(case.lead_status, models.LeadStatus.PENDING)
        case = self.approve_property(case)
        prop = case.resulting_property
        self.assertEqual(prop.review_status, Property.ReviewStatus.APPROVED)
        self.auth(self.agent)
        res = self.client.post("/crm/api/crm-listings/save_listing/", {"property": prop.pk, "deal_type": self.deal_type.pk, "sale_price": "1000000", "status": "ACTIVE"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        listing = Listing.objects.get(property=prop, deal_type=self.deal_type)
        self.auth(self.agent2)
        res = self.client.post("/crm/api/inquiries/", {"contact": self.buyer.pk, "description": "خریدار"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        inquiry = models.Inquiry.objects.get(pk=res.data["id"])
        self.assertEqual(pipeline_stage(inquiry), "LEAD")
        self.auth(self.manager)
        self.client.post(f"/crm/api/inquiries/{inquiry.pk}/accept_lead/", {}, format="json")
        self.client.post(f"/crm/api/inquiries/{inquiry.pk}/assign/", {"assigned_to": self.agent2.pk, "due_at": (timezone.now() + timedelta(days=5)).isoformat()}, format="json")
        self.auth(self.agent2)
        self.client.post(f"/crm/api/inquiries/{inquiry.pk}/accept_assignment/", {}, format="json")
        inquiry.refresh_from_db()
        self.assertEqual(pipeline_stage(inquiry), "NEEDS")
        res = self.client.post(f"/crm/api/inquiries/{inquiry.pk}/save_needs/", {"preferences": [{"deal_type": self.deal_type.pk, "max_amount": "2000000", "min_area": 50, "districts": [self.district.pk]}], "version": inquiry.version}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        res = self.client.get(f"/crm/api/inquiries/{inquiry.pk}/matches/")
        self.assertTrue(res.data[0]["matched"])
        res = self.client.post(f"/crm/api/inquiries/{inquiry.pk}/introduce/", {"listing_id": listing.pk}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        intro = models.Introduction.objects.get(pk=res.data["id"])
        self.assertEqual(pipeline_stage(inquiry), "INTRODUCTION")
        res = self.client.post("/crm/api/viewings/", {"introduction": intro.pk, "scheduled_at": (timezone.now() + timedelta(days=1)).isoformat()}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        viewing = models.Viewing.objects.get(pk=res.data["id"])
        self.assertEqual(pipeline_stage(inquiry), "VIEWING")
        self.client.post(f"/crm/api/viewings/{viewing.pk}/complete/", {"result": "INTERESTED"}, format="json")
        res = self.client.post(f"/crm/api/viewings/{viewing.pk}/start_deal/", {"participants": [{"contact": self.buyer.pk, "participant_role": "BUYER", "is_primary": True}, {"contact": self.contact.pk, "participant_role": "SELLER", "is_primary": True}]}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        deal = models.Deal.objects.get(pk=res.data["id"])
        self.assertEqual(pipeline_stage(inquiry), "NEGOTIATION")
        self.auth(self.agent2)
        res = self.client.post(f"/crm/api/deals/{deal.pk}/succeed/", {"result_notes": "توافق شد"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.auth(self.finance)
        res = self.client.post("/crm/api/contracts/", {"deal": deal.pk}, format="json")
        self.assertEqual(res.status_code, 403)
        self.auth(self.admin)
        res = self.client.post("/crm/api/contracts/", {"deal": deal.pk}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        contract = models.Contract.objects.get(pk=res.data["id"])
        with TemporaryDirectory() as media_root, override_settings(MEDIA_ROOT=media_root):
            upload_url = f"/crm/api/contracts/{contract.pk}/add_attachment/"
            upload_data = {
                "document_type": "نسخه امضاشده",
                "file": SimpleUploadedFile(
                    "signed-contract.pdf",
                    b"%PDF-1.7\\ncontract document\\n%%EOF",
                    content_type="application/pdf",
                ),
            }
            first_upload = self.client.post(
                upload_url,
                upload_data,
                format="multipart",
                HTTP_IDEMPOTENCY_KEY="contract-upload-once",
            )
            self.assertEqual(first_upload.status_code, 201, first_upload.content)
            repeated_upload = self.client.post(
                upload_url,
                {
                    "document_type": "نسخه امضاشده",
                    "file": SimpleUploadedFile(
                        "signed-contract.pdf",
                        b"%PDF-1.7\\ncontract document\\n%%EOF",
                        content_type="application/pdf",
                    ),
                },
                format="multipart",
                HTTP_IDEMPOTENCY_KEY="contract-upload-once",
            )
            self.assertEqual(repeated_upload.status_code, 201, repeated_upload.content)
            self.assertEqual(first_upload.data["id"], repeated_upload.data["id"])
            self.assertEqual(contract.attachments.count(), 1)
            attachment_url = repeated_upload.data["file"]
            from urllib.parse import urlparse

            media_path = urlparse(attachment_url).path
            self.auth(self.finance)
            self.assertEqual(self.client.get(media_path).status_code, 403)
            self.client.force_authenticate(user=None)
            self.assertEqual(self.client.get(media_path).status_code, 403)
            from django.test import Client

            browser = Client()
            browser.force_login(self.admin)
            downloaded = browser.get(media_path)
            self.assertEqual(downloaded.status_code, 200)
            self.assertEqual(downloaded["Content-Disposition"], "attachment")
            self.assertIn("no-store", downloaded["Cache-Control"])
            self.assertEqual(b"".join(downloaded.streaming_content), b"%PDF-1.7\\ncontract document\\n%%EOF")
            self.auth(self.admin)
            invalid_upload = self.client.post(
                upload_url,
                {
                    "file": SimpleUploadedFile(
                        "fake.pdf", b"plain text", content_type="application/pdf"
                    )
                },
                format="multipart",
            )
            self.assertEqual(invalid_upload.status_code, 400)
            self.assertEqual(contract.attachments.count(), 1)
        self.client.post(f"/crm/api/contracts/{contract.pk}/save_terms/", {"sale_price": "900000", "terms_snapshot": {"note": "شرایط"}}, format="json")
        for party in contract.parties.all():
            res = self.client.post(f"/crm/api/contracts/{contract.pk}/sign/", {"contract_party": party.pk}, format="json")
            self.assertEqual(res.status_code, 200, res.content)
        res = self.client.post(f"/crm/api/contracts/{contract.pk}/finalize/", {}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        contract.refresh_from_db()
        self.assertEqual(contract.status, models.Contract.Status.FINALIZED)
        inquiry.refresh_from_db()
        self.assertEqual(pipeline_stage(inquiry), "COMPLETED")
        policy = models.CommissionPolicyVersion.objects.create(name="فروش پایه", deal_type=self.deal_type, version_number=1, calculation_method="PERCENT", parameters={"percent": "10"}, status="PUBLISHED")
        self.auth(self.finance)
        res = self.client.post("/crm/api/commissions/create_from_contract/", {"contract": contract.pk, "debtor_contact": self.buyer.pk, "policy_version": policy.pk, "base_amount": "900000", "shares": [{"beneficiary_user": self.agent2.pk, "share_percent": "40"}]}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        commission = models.Commission.objects.get(pk=res.data["id"])
        self.assertEqual(commission.final_amount, Decimal("90000"))
        self.client.post(f"/crm/api/commissions/{commission.pk}/approve/", {}, format="json")
        share = commission.shares.first()
        res = self.client.post("/crm/api/payments/", {"direction": "IN", "contact": self.buyer.pk, "amount": "50000", "paid_at": timezone.now().isoformat(), "allocations": [{"commission": commission.pk, "amount": "50000"}]}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        incoming_payment_id = res.data["id"]
        commission.refresh_from_db()
        self.assertEqual(commission.status, models.Commission.Status.PARTIALLY_PAID)
        duplicate_target_payment = self.client.post("/crm/api/payments/", {"direction": "IN", "contact": self.buyer.pk, "amount": "50000", "paid_at": timezone.now().isoformat(), "allocations": [{"commission": commission.pk, "amount": "25000"}, {"commission": commission.pk, "amount": "25000"}]}, format="json")
        self.assertEqual(duplicate_target_payment.status_code, 400)
        self.assertEqual(models.Payment.objects.filter(direction=models.Payment.Direction.IN).count(), 1)
        res = self.client.post("/crm/api/payments/", {"direction": "OUT", "user": self.agent2.pk, "amount": "999999", "paid_at": timezone.now().isoformat(), "allocations": [{"commission_share": share.pk, "amount": "999999"}]}, format="json")
        self.assertEqual(res.status_code, 400)
        reversal = self.client.post(f"/crm/api/payments/{incoming_payment_id}/reverse/", {}, format="json")
        self.assertEqual(reversal.status_code, 201, reversal.content)
        commission.refresh_from_db()
        commission_summary = self.client.get(f"/crm/api/commissions/{commission.pk}/")
        self.assertEqual(commission_summary.status_code, 200, commission_summary.content)
        self.assertEqual(commission_summary.data["received_amount"], 0)
        self.assertEqual(commission_summary.data["remaining_amount"], 90000)
        reversal_id = reversal.data["id"]
        reverse_again = self.client.post(f"/crm/api/payments/{reversal_id}/reverse/", {}, format="json")
        self.assertEqual(reverse_again.status_code, 400)

    def test_create_command_is_idempotent_and_rejects_key_reuse_with_different_payload(self):
        self.auth(self.admin)
        endpoint = "/crm/api/contacts/"
        first = self.client.post(
            endpoint,
            {"full_name": "تماس تکرارنشدنی", "email": "once@example.test"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="contact-create-once",
        )
        self.assertEqual(first.status_code, 201, first.content)
        repeated = self.client.post(
            endpoint,
            {"full_name": "تماس تکرارنشدنی", "email": "once@example.test"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="contact-create-once",
        )
        self.assertEqual(repeated.status_code, 201, repeated.content)
        self.assertEqual(first.data["id"], repeated.data["id"])
        self.assertEqual(models.Contact.objects.filter(full_name="تماس تکرارنشدنی").count(), 1)

        changed_payload = self.client.post(
            endpoint,
            {"full_name": "نام متفاوت"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="contact-create-once",
        )
        self.assertEqual(changed_payload.status_code, 400)
        self.assertFalse(models.Contact.objects.filter(full_name="نام متفاوت").exists())

    def test_matches_and_introduction_are_limited_to_the_inquiry_scope(self):
        outside_user = User.objects.create_user(username="outside-agent", password="x", role="AGENT")
        outside_contact = models.Contact.objects.create(full_name="مالک بیرون رنج", created_by=outside_user)
        now = timezone.now()
        inquiry = models.Inquiry.objects.create(
            contact=self.buyer,
            code="I-SCOPE-TEST",
            created_by=self.agent2,
            scope=self.scope,
            lead_status=models.LeadStatus.ACCEPTED,
            lead_accepted_by=self.manager,
            lead_accepted_at=now,
            acceptance_status=models.AcceptanceStatus.ACCEPTED,
            assigned_to=self.agent2,
            assigned_at=now,
            accepted_at=now,
            due_at=now + timedelta(days=5),
        )
        outside_property = Property.objects.create(
            title="ملک خارج از رنج",
            consultant=outside_user,
            property_type=Property.PropertyType.APARTMENT,
            deal_type=Property.DealType.SALE,
            area=100,
            address="تهران",
            status=Property.Status.AVAILABLE,
            review_status=Property.ReviewStatus.APPROVED,
        )
        outside_listing = Listing.objects.create(
            property=outside_property,
            deal_type=self.deal_type,
            title="فایل خارج از رنج",
            created_by=outside_user,
            assigned_to=outside_user,
            status=Listing.Status.ACTIVE,
            publish_channel=Listing.PublishChannel.WEBSITE,
        )
        models.PropertyContact.objects.create(
            property=outside_property,
            contact=outside_contact,
            role=models.PropertyContact.Role.OWNER,
            is_primary=True,
        )
        self.auth(self.agent2)
        matches = self.client.get(f"/crm/api/inquiries/{inquiry.pk}/matches/")
        self.assertEqual(matches.status_code, 200, matches.content)
        self.assertEqual(matches.data, [])
        introduced = self.client.post(
            f"/crm/api/inquiries/{inquiry.pk}/introduce/",
            {"listing_id": outside_listing.pk},
            format="json",
        )
        self.assertEqual(introduced.status_code, 404)
        self.assertFalse(models.Introduction.objects.filter(inquiry=inquiry).exists())

    def test_dashboard_counts_only_the_users_active_scope(self):
        in_scope_case = self.make_case()
        outside_manager = User.objects.create_user(username="outside-manager", password="x", role="RANGE_MANAGER")
        outside_agent = User.objects.create_user(username="outside-member", password="x", role="AGENT")
        outside_scope = ManagementScope.objects.create(name="جنوب")
        now = timezone.now()
        ScopeMembership.objects.create(scope=outside_scope, user=outside_manager, membership_role="MANAGER", started_at=now)
        ScopeMembership.objects.create(scope=outside_scope, user=outside_agent, membership_role="MEMBER", started_at=now)
        outside_contact = models.Contact.objects.create(full_name="تماس رنج دیگر", created_by=outside_agent)
        models.PropertyRegistrationRequest.objects.create(
            contact=outside_contact,
            code="R-OUTSIDE-TEST",
            created_by=outside_agent,
            scope=outside_scope,
        )
        self.auth(self.manager)
        today = timezone.localdate()
        summary = self.client.get(
            "/crm/api/crm-dashboard/summary/",
            {"from": (today - timedelta(days=30)).isoformat(), "to": today.isoformat()},
        )
        self.assertEqual(summary.status_code, 200, summary.content)
        self.assertEqual(summary.data["counters"]["property_cases"], 1)
        self.assertEqual(summary.data["counters"]["pending_leads"], 1)
        in_scope_case.refresh_from_db()

    def test_contact_requires_a_version_and_direct_destructive_mutations_are_closed(self):
        contact = models.Contact.objects.create(full_name="مخاطب آزمون", created_by=self.admin)
        self.auth(self.admin)
        patch = self.client.patch(
            f"/crm/api/contacts/{contact.pk}/",
            {"full_name": "تغییر غیرمجاز"},
            format="json",
        )
        self.assertEqual(patch.status_code, 400)
        delete = self.client.delete(f"/crm/api/contacts/{contact.pk}/")
        self.assertEqual(delete.status_code, 405)
        membership = self.client.post(
            "/crm/api/scope-memberships/",
            {"scope": self.scope.pk, "user": self.agent.pk, "membership_role": "MEMBER"},
            format="json",
        )
        self.assertEqual(membership.status_code, 405)

    def test_idempotency_key_cannot_replay_a_different_record_path(self):
        first = self.make_case()
        second = self.make_case()
        self.auth(self.manager)
        first_response = self.client.post(
            f"/crm/api/property-cases/{first.pk}/accept_lead/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="same-action-key",
        )
        self.assertEqual(first_response.status_code, 200, first_response.content)
        second_response = self.client.post(
            f"/crm/api/property-cases/{second.pk}/accept_lead/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="same-action-key",
        )
        self.assertEqual(second_response.status_code, 400)
        second.refresh_from_db()
        self.assertEqual(second.lead_status, models.LeadStatus.PENDING)

    def test_assignment_waiting_period(self):
        case = self.make_case()
        self.auth(self.manager)
        self.client.post(f"/crm/api/property-cases/{case.pk}/accept_lead/", {}, format="json")
        res = self.client.post(f"/crm/api/property-cases/{case.pk}/assign/", {"assigned_to": self.agent.pk, "due_at": (timezone.now() + timedelta(days=5)).isoformat()}, format="json")
        self.assertEqual(res.status_code, 200)
        res = self.client.post(f"/crm/api/property-cases/{case.pk}/assign/", {"assigned_to": self.agent2.pk, "due_at": (timezone.now() + timedelta(days=5)).isoformat()}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_scope_transfer_and_status_change_enforce_versions_and_write_timeline(self):
        case = self.make_case()
        destination = ManagementScope.objects.create(name="جنوب برای انتقال")
        ScopeMembership.objects.create(
            scope=destination,
            user=self.manager,
            membership_role="MANAGER",
            started_at=timezone.now(),
        )
        self.auth(self.manager)

        same_scope_transfer = self.client.post(
            f"/crm/api/property-cases/{case.pk}/transfer_scope/",
            {"scope": case.scope_id, "version": case.version},
            format="json",
        )
        self.assertEqual(same_scope_transfer.status_code, 400)

        stale_transfer = self.client.post(
            f"/crm/api/property-cases/{case.pk}/transfer_scope/",
            {"scope": destination.pk, "version": case.version + 1},
            format="json",
        )
        self.assertEqual(stale_transfer.status_code, 409)
        self.assertEqual(
            stale_transfer.data["detail"],
            "پرونده توسط کاربر دیگری تغییر کرده است؛ اطلاعات را تازه کنید",
        )
        case.refresh_from_db()
        self.assertEqual(case.scope_id, self.scope.pk)

        transfer = self.client.post(
            f"/crm/api/property-cases/{case.pk}/transfer_scope/",
            {"scope": destination.pk, "version": case.version, "reason": "تغییر حوزه"},
            format="json",
        )
        self.assertEqual(transfer.status_code, 200, transfer.content)
        case.refresh_from_db()
        self.assertEqual(case.scope_id, destination.pk)
        self.assertEqual(case.version, 2)

        stale_status = self.client.post(
            f"/crm/api/property-cases/{case.pk}/change_status/",
            {"status": "COMPLETED", "version": 1},
            format="json",
        )
        self.assertEqual(stale_status.status_code, 409)
        self.assertEqual(
            stale_status.data["detail"],
            "پرونده توسط کاربر دیگری تغییر کرده است؛ اطلاعات را تازه کنید",
        )
        current_status = self.client.post(
            f"/crm/api/property-cases/{case.pk}/change_status/",
            {"status": "COMPLETED", "version": case.version},
            format="json",
        )
        self.assertEqual(current_status.status_code, 200, current_status.content)

        timeline = self.client.get(
            f"/crm/api/property-cases/{case.pk}/timeline/?page_size=100"
        )
        self.assertEqual(timeline.status_code, 200, timeline.content)
        event_types = {item["type"] for item in timeline.data["results"]}
        self.assertIn("assignment.scope_transferred", event_types)
        self.assertIn("stage.changed", event_types)

    def test_duplicate_status_link_is_cleared_when_case_reopens(self):
        case = self.make_case()
        original = self.make_case()
        self.auth(self.manager)

        duplicate = self.client.post(
            f"/crm/api/property-cases/{case.pk}/change_status/",
            {
                "status": "DUPLICATE",
                "duplicate_of": original.pk,
                "closure_reason": "پروندهٔ تکراری",
                "version": case.version,
            },
            format="json",
        )
        self.assertEqual(duplicate.status_code, 200, duplicate.content)
        case.refresh_from_db()
        self.assertEqual(case.duplicate_of_id, original.pk)

        reopened = self.client.post(
            f"/crm/api/property-cases/{case.pk}/change_status/",
            {"status": "ACTIVE", "version": case.version},
            format="json",
        )
        self.assertEqual(reopened.status_code, 200, reopened.content)
        case.refresh_from_db()
        self.assertIsNone(case.duplicate_of_id)

    def test_case_task_and_followup_links_are_searchable_and_timeline_visible(self):
        case = self.make_case()
        due_at = timezone.now() + timedelta(days=2)
        self.auth(self.admin)

        task_response = self.client.post(
            "/tasks/api/tasks/",
            {
                "title": "بررسی سند پرونده",
                "description": "پیگیری مدارک پرونده",
                "assigned_to": self.agent.pk,
                "propertyCaseId": case.pk,
                "due_date": due_at.date().isoformat(),
                "priority": "HIGH",
                "taskType": "DOCUMENT",
            },
            format="json",
        )
        self.assertEqual(task_response.status_code, 201, task_response.content)
        self.assertEqual(task_response.data["propertyCaseId"], case.pk)

        followup_response = self.client.post(
            "/followups/api/followups/",
            {
                "title": "تماس درباره پرونده",
                "type": FollowUpType.CALL,
                "contact": case.contact.full_name,
                "date": due_at.isoformat(),
                "consultantId": self.agent.pk,
                "propertyCaseId": case.pk,
                "notes": "دریافت مدارک تکمیلی",
            },
            format="json",
        )
        self.assertEqual(followup_response.status_code, 201, followup_response.content)
        self.assertEqual(followup_response.data["propertyCaseId"], case.pk)

        task_list = self.client.get(
            f"/tasks/api/tasks/?propertyCaseId={case.pk}&search=سند"
        )
        self.assertEqual(task_list.status_code, 200, task_list.content)
        self.assertEqual([item["id"] for item in task_list.data["results"]], [task_response.data["id"]])

        followup_list = self.client.get(
            f"/followups/api/followups/?propertyCaseId={case.pk}&search=پرونده"
        )
        self.assertEqual(followup_list.status_code, 200, followup_list.content)
        self.assertEqual(
            [item["id"] for item in followup_list.data["results"]],
            [followup_response.data["id"]],
        )

        self.auth(self.manager)
        timeline = self.client.get(
            f"/crm/api/property-cases/{case.pk}/timeline/?page_size=100"
        )
        self.assertEqual(timeline.status_code, 200, timeline.content)
        timeline_types = {item["type"] for item in timeline.data["results"]}
        self.assertTrue({"case.created", "task", "followup"}.issubset(timeline_types))

        finance_task = Task.objects.create(
            title="کار مالی بدون دسترسی به پرونده",
            assigned_to=self.finance,
            created_by=self.finance,
            property_case=case,
            due_date=due_at.date(),
        )
        FollowUp.objects.create(
            title="پیگیری مالی بدون دسترسی به پرونده",
            consultant=self.finance,
            contact_name=case.contact.full_name,
            property_case=case,
            scheduled_at=due_at,
        )
        self.auth(self.finance)
        finance_tasks = self.client.get(
            f"/tasks/api/tasks/?propertyCaseId={case.pk}"
        )
        self.assertEqual(finance_tasks.status_code, 200, finance_tasks.content)
        self.assertNotIn(finance_task.pk, [item["id"] for item in finance_tasks.data["results"]])
        finance_followups = self.client.get(
            f"/followups/api/followups/?propertyCaseId={case.pk}"
        )
        self.assertEqual(finance_followups.status_code, 200, finance_followups.content)
        self.assertEqual(finance_followups.data["results"], [])
        self.assertEqual(
            self.client.get(f"/crm/api/property-cases/{case.pk}/timeline/").status_code,
            404,
        )

    def test_listing_review_endpoints_removed(self):
        self.auth(self.admin)
        res = self.client.post("/listings/api/listings/1/approve/", {}, format="json")
        self.assertIn(res.status_code, (404, 410))
