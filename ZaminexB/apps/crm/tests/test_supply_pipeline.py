from datetime import timedelta
from decimal import Decimal
from io import BytesIO
from tempfile import TemporaryDirectory

from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import ManagementScope, ScopeMembership, User
from apps.basics.models import Attribute, City, DealType, DealTypeVersion, District, PropertyType, PropertyTypeAttribute, PropertyUsage, Province
from apps.basics.terms import default_terms_schema
from apps.crm import models
from apps.crm import services
from apps.crm.services import CASE_CONFLICT_DETAIL, property_case_stage
from apps.listings.models import Listing
from apps.notifications.models import Notification
from apps.properties.models import Property, PropertyAttributeValue
from apps.tasks.models import Task
from PIL import Image


class SupplyPipelineTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        for name in ["GENERAL_MANAGER", "RANGE_MANAGER", "AGENT", "FINANCE"]:
            Group.objects.get_or_create(name=name)

        self.admin = User.objects.create_user(username="sup-admin", password="pw", role="ADMIN")
        self.admin.groups.add(Group.objects.get(name="GENERAL_MANAGER"))

        self.mgr1 = User.objects.create_user(username="sup-mgr-1", password="pw", role="RANGE_MANAGER")
        self.mgr1.groups.add(Group.objects.get(name="RANGE_MANAGER"))

        self.mgr2 = User.objects.create_user(username="sup-mgr-2", password="pw", role="RANGE_MANAGER")
        self.mgr2.groups.add(Group.objects.get(name="RANGE_MANAGER"))

        self.adv1 = User.objects.create_user(username="sup-adv-1", password="pw", role="AGENT")
        self.adv1.groups.add(Group.objects.get(name="AGENT"))

        self.adv2 = User.objects.create_user(username="sup-adv-2", password="pw", role="AGENT")
        self.adv2.groups.add(Group.objects.get(name="AGENT"))

        self.fin = User.objects.create_user(username="sup-fin", password="pw", role="FINANCE")
        self.fin.groups.add(Group.objects.get(name="FINANCE"))

        now = timezone.now()
        self.range1 = ManagementScope.objects.create(name="رنج اول")
        self.range2 = ManagementScope.objects.create(name="رنج دوم")

        ScopeMembership.objects.create(scope=self.range1, user=self.mgr1, membership_role="MANAGER", started_at=now)
        ScopeMembership.objects.create(scope=self.range1, user=self.adv1, membership_role="MEMBER", started_at=now)
        ScopeMembership.objects.create(scope=self.range1, user=self.adv2, membership_role="MEMBER", started_at=now)
        ScopeMembership.objects.create(scope=self.range2, user=self.mgr2, membership_role="MANAGER", started_at=now)

        prov = Province.objects.create(name="sup-tehran", display_name="تهران")
        city = City.objects.create(name="sup-city", display_name="تهران", province=prov)
        self.district = District.objects.create(name="sup-jordan", display_name="جردن", city=city)
        self.other_district = District.objects.create(name="sup-saadat", display_name="سعادت‌آباد", city=city)
        usage = PropertyUsage.objects.create(name="sup-res", display_name="مسکونی")
        self.prop_type = PropertyType.objects.create(name="sup-apt", display_name="آپارتمان مسکونی", property_usage=usage)

        self.behaviors = {}
        for fam, title in [
            ("SALE", "فروش قطعی"),
            ("RENT", "رهن و اجاره"),
            ("FULL_MORTGAGE", "رهن کامل"),
            ("PRE_SALE", "پیش‌فروش"),
            ("PARTNERSHIP", "مشارکت در ساخت"),
            ("EXCHANGE", "معاوضه"),
        ]:
            dt = DealType.objects.create(name=f"dt-{fam.lower()}", display_name=title, family=fam, is_active=True)
            ver = DealTypeVersion.objects.create(
                deal_type=dt,
                version_number=1,
                family=fam,
                terms_schema=default_terms_schema(fam),
                status=DealTypeVersion.Status.PUBLISHED,
                published_at=now,
            )
            self.behaviors[fam] = (dt, ver)

    def auth(self, user):
        self.client.force_authenticate(user=user)

    def test_seeded_physical_features_are_only_core_for_shared_area(self):
        from apps.basics.management.commands.seed_basics import ATTRIBUTES, TYPE_ATTRIBUTES

        core_feature_names = {row[0] for row in ATTRIBUTES if row[7]}
        self.assertEqual(core_feature_names, {"area"})
        land_features = {name for name, _required in TYPE_ATTRIBUTES["land"]}
        self.assertTrue({"land_area", "frontage"}.issubset(land_features))
        self.assertTrue({"rooms", "floor", "built_year"}.isdisjoint(land_features))
        for type_name in ("apartment", "villa", "office"):
            linked_features = {name for name, _required in TYPE_ATTRIBUTES[type_name]}
            self.assertTrue(linked_features.intersection({"rooms", "floor", "built_year"}))

    def test_lead_creation_by_advisor_vs_manager_and_scope_isolation(self):
        self.auth(self.adv1)
        bad = self.client.post(
            "/crm/api/property-cases/",
            {"contact_full_name": "بدون تماس", "description": "تست"},
            format="json",
        )
        self.assertEqual(bad.status_code, 400)

        created = self.client.post(
            "/crm/api/property-cases/",
            {
                "contact_full_name": "رضا کریمی",
                "contact_phone": "09121112233",
                "description": "آپارتمان جردن شمالی",
                "lead_source": "OWNER_REFERRAL",
                "desired_deal_type_ids": [self.behaviors["SALE"][0].pk],
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY="lead-create-adv1",
        )
        self.assertEqual(created.status_code, 201, created.content)
        replay = self.client.post(
            "/crm/api/property-cases/",
            {
                "contact_full_name": "رضا کریمی",
                "contact_phone": "09121112233",
                "description": "آپارتمان جردن شمالی",
                "lead_source": "OWNER_REFERRAL",
                "desired_deal_type_ids": [self.behaviors["SALE"][0].pk],
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY="lead-create-adv1",
        )
        self.assertEqual(replay.status_code, 201)
        self.assertEqual(created.data["id"], replay.data["id"])
        self.assertEqual(created.data["stage"], "reception")
        self.assertEqual(created.data["lead_status"], models.LeadStatus.PENDING)
        self.assertTrue(Task.objects.filter(assigned_to=self.mgr1, title__contains=created.data["code"]).exists())

        self.auth(self.adv2)
        list_adv2 = self.client.get("/crm/api/property-cases/")
        ids_adv2 = [row["id"] for row in list_adv2.data["results"]]
        self.assertNotIn(created.data["id"], ids_adv2)
        self.assertEqual(self.client.get(f"/crm/api/property-cases/{created.data['id']}/").status_code, 404)

        self.auth(self.mgr2)
        self.assertEqual(self.client.get(f"/crm/api/property-cases/{created.data['id']}/").status_code, 404)

        self.auth(self.mgr1)
        mgr_created = self.client.post(
            "/crm/api/property-cases/",
            {
                "contact_full_name": "سارا رضایی",
                "contact_phone": "09123334455",
                "description": "ویلای نیاوران",
                "lead_source": "REFERRAL",
            },
            format="json",
        )
        self.assertEqual(mgr_created.status_code, 201, mgr_created.content)
        self.assertEqual(mgr_created.data["lead_status"], models.LeadStatus.ACCEPTED)
        self.assertEqual(mgr_created.data["stage"], "assignment")
        self.assertFalse(Task.objects.filter(title__contains=mgr_created.data["code"]).exists())

    def test_every_lead_source_choice_is_accepted_on_creation(self):
        """The wizard's «منبع سرنخ» list must never offer a code this API answers 400 for.

        The panel dropdown is generated from `LEAD_SOURCE_OPTIONS` in
        `ZaminexF/src/features/crm/lib/supplyDomain.ts`, which mirrors this enum. A previous
        mismatch (DIRECT_CALL, WEBSITE, …) made every choice but «سایر» fail with 400, so the
        contract is pinned here: changing `LeadSource` without updating the panel breaks this test.
        """
        self.assertEqual(
            [(value, label) for value, label in models.LeadSource.choices],
            [
                ("OWNER_REFERRAL", "مراجعه یا تماس مالک"),
                ("ADVISOR_NETWORK", "شبکه ارتباطی مشاور"),
                ("PORTAL", "پرتال و آگهی"),
                ("REFERRAL", "معرفی"),
                ("WALK_IN", "حضوری"),
                ("OTHER", "سایر"),
            ],
        )

        self.auth(self.adv1)
        for index, value in enumerate(models.LeadSource.values):
            res = self.client.post(
                "/crm/api/property-cases/",
                {
                    "contact_full_name": f"مالک {value}",
                    "contact_phone": f"0912000000{index}",
                    "description": f"سرنخ با منبع {value}",
                    "lead_source": value,
                },
                format="json",
            )
            self.assertEqual(res.status_code, 201, f"{value}: {res.content}")
            self.assertEqual(res.data["lead_source"], value)

        rejected = self.client.post(
            "/crm/api/property-cases/",
            {
                "contact_full_name": "منبع نامعتبر",
                "contact_phone": "09129999999",
                "description": "سرنخ با منبع نامعتبر",
                "lead_source": "DIRECT_CALL",
            },
            format="json",
        )
        self.assertEqual(rejected.status_code, 400)
        self.assertIn("lead_source", rejected.data)

    def test_assignment_48h_rule_reject_extension_withdrawal_and_reassign(self):
        self.auth(self.mgr1)
        res = self.client.post(
            "/crm/api/property-cases/",
            {"contact_full_name": "علی محمدی", "contact_phone": "09125556677", "description": "ملک تست"},
            format="json",
        )
        case_id = res.data["id"]

        missing_due = self.client.post(
            f"/crm/api/property-cases/{case_id}/assign/",
            {"assigned_to": self.adv1.pk},
            format="json",
        )
        self.assertEqual(missing_due.status_code, 400)

        due = timezone.now() + timedelta(days=3)
        assigned = self.client.post(
            f"/crm/api/property-cases/{case_id}/assign/",
            {"assigned_to": self.adv1.pk, "due_at": due.isoformat()},
            format="json",
        )
        self.assertEqual(assigned.status_code, 200)
        self.assertEqual(assigned.data["stage"], "acceptance")

        task = Task.objects.filter(assigned_to=self.adv1, title__contains=assigned.data["code"]).first()
        self.assertIsNotNone(task)
        task.due_date = (timezone.now() + timedelta(days=10)).date()
        task.save(update_fields=["due_date"])

        blocked_reassign = self.client.post(
            f"/crm/api/property-cases/{case_id}/change_assignee/",
            {"assigned_to": self.adv2.pk, "due_at": (timezone.now() + timedelta(days=4)).isoformat()},
            format="json",
        )
        self.assertEqual(blocked_reassign.status_code, 400)

        models.PropertyRegistrationRequest.objects.filter(pk=case_id).update(
            assigned_at=timezone.now() - timedelta(hours=49)
        )
        after_48h = self.client.post(
            f"/crm/api/property-cases/{case_id}/change_assignee/",
            {"assigned_to": self.adv2.pk, "due_at": (timezone.now() + timedelta(days=4)).isoformat()},
            format="json",
        )
        self.assertEqual(after_48h.status_code, 200, after_48h.content)
        self.assertEqual(after_48h.data["assigned_to"], self.adv2.pk)

        self.auth(self.adv2)
        reject_no_reason = self.client.post(
            f"/crm/api/property-cases/{case_id}/reject_assignment/",
            {"reason": ""},
            format="json",
        )
        self.assertEqual(reject_no_reason.status_code, 400)

        rejected = self.client.post(
            f"/crm/api/property-cases/{case_id}/reject_assignment/",
            {"reason": "تداخل بازدیدهای قبلی"},
            format="json",
        )
        self.assertEqual(rejected.status_code, 200, rejected.content)
        self.assertEqual(rejected.data["stage"], "assignment")
        self.assertEqual(rejected.data["acceptance_status"], models.AcceptanceStatus.REJECTED)

        self.auth(self.mgr1)
        reassigned = self.client.post(
            f"/crm/api/property-cases/{case_id}/assign/",
            {"assigned_to": self.adv1.pk, "due_at": (timezone.now() + timedelta(days=2)).isoformat()},
            format="json",
        )
        self.assertEqual(reassigned.status_code, 200)

        self.auth(self.adv1)
        early_ext = self.client.post(
            f"/crm/api/property-cases/{case_id}/request_extension/",
            {"requested_due_at": (timezone.now() + timedelta(days=5)).isoformat(), "reason": "زود"},
            format="json",
        )
        self.assertEqual(early_ext.status_code, 400)

        accepted = self.client.post(f"/crm/api/property-cases/{case_id}/accept_assignment/", {}, format="json")
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.data["stage"], "appraisal")

        before_due_ext = self.client.post(
            f"/crm/api/property-cases/{case_id}/request_extension/",
            {"requested_due_at": (timezone.now() + timedelta(days=5)).isoformat(), "reason": "هنوز نگذشته"},
            format="json",
        )
        self.assertEqual(before_due_ext.status_code, 400)

        models.PropertyRegistrationRequest.objects.filter(pk=case_id).update(
            due_at=timezone.now() - timedelta(hours=2)
        )
        ext_ok = self.client.post(
            f"/crm/api/property-cases/{case_id}/request_extension/",
            {"requested_due_at": (timezone.now() + timedelta(days=5)).isoformat(), "reason": "هماهنگی مالک"},
            format="json",
        )
        self.assertEqual(ext_ok.status_code, 201, ext_ok.content)
        dup_ext = self.client.post(
            f"/crm/api/property-cases/{case_id}/request_extension/",
            {"requested_due_at": (timezone.now() + timedelta(days=6)).isoformat(), "reason": "تکراری"},
            format="json",
        )
        self.assertEqual(dup_ext.status_code, 400)

        self.auth(self.mgr1)
        change_cancels_ext = self.client.post(
            f"/crm/api/property-cases/{case_id}/change_assignee/",
            {"assigned_to": self.adv2.pk, "due_at": (timezone.now() + timedelta(days=3)).isoformat(), "reason": "تغییر مشاور"},
            format="json",
        )
        self.assertEqual(change_cancels_ext.status_code, 200, change_cancels_ext.content)
        ext_row = models.AssignmentRescheduleRequest.objects.get(pk=ext_ok.data["id"])
        self.assertEqual(ext_row.status, models.AssignmentRescheduleRequest.Status.CANCELLED)

    def test_assignable_staff_matches_the_people_the_server_accepts(self):
        self.auth(self.mgr1)
        res = self.client.post(
            "/crm/api/property-cases/",
            {"contact_full_name": "نگار احمدی", "contact_phone": "09127778899", "description": "ملک ارجاع"},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        url = f"/crm/api/property-cases/{res.data['id']}/assignable-staff/"

        listed = self.client.get(url)
        self.assertEqual(listed.status_code, 200, listed.content)
        rows = {row["id"]: row for row in listed.data}
        listed_ids = set(rows)
        # Exactly the managers and members of this range, deduplicated by user: nothing from another
        # range, nothing from finance, and the general manager only when the range has no one.
        self.assertEqual(listed_ids, {self.mgr1.pk, self.adv1.pk, self.adv2.pk})
        self.assertEqual(len(listed.data), len(listed_ids))
        self.assertEqual(rows[self.adv1.pk]["full_name"], self.adv1.username)  # falls back to the account name
        self.assertEqual(rows[self.adv1.pk]["role"], "AGENT")
        self.assertEqual(rows[self.mgr1.pk]["role"], "RANGE_MANAGER")

        # An empty range still offers an assignable person instead of an empty list.
        self.range1.managers.clear()
        self.range1.members.clear()
        self.auth(self.admin)
        fallback = self.client.get(url)
        self.assertEqual(fallback.status_code, 200, fallback.content)
        self.assertEqual([row["id"] for row in fallback.data], [self.admin.pk])

        # A viewer who cannot assign this case gets an empty list rather than an error page, while a
        # case outside the viewer's reach stays a 404.
        self.auth(self.mgr2)
        self.assertEqual(self.client.get(url).status_code, 404)
        self.auth(self.adv2)
        denied = self.client.get(url)
        self.assertIn(denied.status_code, (200, 404))
        if denied.status_code == 200:
            self.assertEqual(denied.data, [])

    def test_workspace_title_review_queue_reopen_close_listings_and_explore(self):
        self.auth(self.mgr1)
        res = self.client.post(
            "/crm/api/property-cases/",
            {"contact_full_name": "مریم حسینی", "contact_phone": "09127778899", "description": "شرح اولیه سرنخ"},
            format="json",
        )
        case_id = res.data["id"]
        self.client.post(
            f"/crm/api/property-cases/{case_id}/assign/",
            {"assigned_to": self.adv1.pk, "due_at": (timezone.now() + timedelta(days=4)).isoformat()},
            format="json",
        )

        self.auth(self.adv1)
        self.client.post(f"/crm/api/property-cases/{case_id}/accept_assignment/", {}, format="json")

        forbidden_title = self.client.post(
            f"/crm/api/property-cases/{case_id}/set_property_title/",
            {"property_title": "عنوان غیرمجاز مشاور"},
            format="json",
        )
        self.assertEqual(forbidden_title.status_code, 403)

        incomplete = self.client.post(
            f"/crm/api/property-cases/{case_id}/save_workspace/",
            {
                "address": "",
                "area": 0,
                "report_text": "ناقص",
                "is_complete": False,
                "parties": [
                    {"full_name": "مریم حسینی", "phone": "09127778899", "role": "OWNER", "share_percent": "60", "is_primary": True},
                    {"full_name": "وکیل مالک", "phone": "09128889900", "role": "OWNER_REPRESENTATIVE"},
                ],
            },
            format="json",
        )
        self.assertEqual(incomplete.status_code, 200, incomplete.content)
        prop_id = incomplete.data["property_id"]
        self.assertEqual(Listing.objects.filter(property_id=prop_id).count(), 0)

        fail_submit = self.client.post(f"/crm/api/property-cases/{case_id}/submit_property_for_review/", {}, format="json")
        self.assertEqual(fail_submit.status_code, 400)
        self.assertIn("address", fail_submit.data)
        self.assertIn("district", fail_submit.data)
        self.assertIn("area", fail_submit.data)
        self.assertIn("appraisal", fail_submit.data)

        unapproved_listing = self.client.post(
            f"/crm/api/properties/{prop_id}/listings/",
            {"deal_type": self.behaviors["SALE"][0].pk, "sale_price": "5000000000", "status": "ACTIVE"},
            format="json",
        )
        self.assertEqual(unapproved_listing.status_code, 400)

        saved = self.client.post(
            f"/crm/api/property-cases/{case_id}/save_workspace/",
            {
                "address": "جردن، خیابان ناهید، پلاک ۱۲",
                "district": self.district.pk,
                "property_type": "APARTMENT",
                "property_type_ref": self.prop_type.pk,
                "area": 145,
                "rooms": 3,
                "floor": 4,
                "built_year": 1401,
                "report_text": "سازه اسکلت فلزی، نورگیری عالی، سند تک‌برگ آماده انتقال",
                "visit_notes": "کلید نزد سرایدار محرمانه",
                "findings": {"document": "single_deed", "parking": 2},
                "is_complete": True,
            },
            format="json",
        )
        self.assertEqual(saved.status_code, 200, saved.content)

        submitted = self.client.post(
            f"/crm/api/property-cases/{case_id}/submit_property_for_review/",
            {"version": saved.data["version"]},
            format="json",
        )
        self.assertEqual(submitted.status_code, 201, submitted.content)
        review_id = submitted.data["id"]

        case_obj = models.PropertyRegistrationRequest.objects.select_related("resulting_property").get(pk=case_id)
        self.assertEqual(property_case_stage(case_obj), "review")

        self.auth(self.mgr1)
        queue = self.client.get("/crm/api/reviews/")
        self.assertEqual(queue.status_code, 200)
        self.assertEqual([item["id"] for item in queue.data["results"]], [review_id])

        no_title_approve = self.client.post(
            f"/crm/api/reviews/{review_id}/decide/",
            {"decision": "APPROVED"},
            format="json",
        )
        self.assertEqual(no_title_approve.status_code, 400)
        self.assertIn("property_title", no_title_approve.data)

        stale_review = self.client.post(
            f"/crm/api/reviews/{review_id}/decide/",
            {"decision": "APPROVED", "property_title": "آپارتمان ۱۴۵ متری جردن", "version": 999},
            format="json",
        )
        self.assertEqual(stale_review.status_code, 409)
        self.assertEqual(stale_review.data["detail"], CASE_CONFLICT_DETAIL)

        changes_no_reason = self.client.post(
            f"/crm/api/reviews/{review_id}/decide/",
            {"decision": "CHANGES_REQUIRED", "reason": ""},
            format="json",
        )
        self.assertEqual(changes_no_reason.status_code, 400)

        changes_ok = self.client.post(
            f"/crm/api/reviews/{review_id}/decide/",
            {"decision": "CHANGES_REQUIRED", "reason": "ابعاد انباری در گزارش قید شود"},
            format="json",
        )
        self.assertEqual(changes_ok.status_code, 200)

        self.auth(self.adv1)
        resaved = self.client.post(
            f"/crm/api/property-cases/{case_id}/save_workspace/",
            {"report_text": "سند تک‌برگ، انباری ۶ متری سندی", "is_complete": True},
            format="json",
        )
        resubmitted = self.client.post(
            f"/crm/api/property-cases/{case_id}/submit_property_for_review/",
            {"version": resaved.data["version"]},
            format="json",
        )
        self.assertEqual(resubmitted.status_code, 201)
        review_id_2 = resubmitted.data["id"]

        self.auth(self.mgr1)
        titled = self.client.post(
            f"/crm/api/property-cases/{case_id}/set_property_title/",
            {"property_title": "آپارتمان ۱۴۵ متری ناهید جردن"},
            format="json",
        )
        self.assertEqual(titled.status_code, 200)
        self.assertEqual(titled.data["description"], "شرح اولیه سرنخ")

        approved = self.client.post(
            f"/crm/api/reviews/{review_id_2}/decide/",
            {"decision": "APPROVED"},
            format="json",
        )
        self.assertEqual(approved.status_code, 200, approved.content)
        self.assertEqual(Listing.objects.filter(property_id=prop_id).count(), 0)
        self.assertEqual(self.client.get("/crm/api/reviews/").data["results"], [])

        self.auth(self.adv1)
        bad_schema = self.client.post(
            f"/crm/api/properties/{prop_id}/listings/",
            {"deal_type": self.behaviors["PRE_SALE"][0].pk, "terms": {"unknown_key": 123}, "status": "DRAFT"},
            format="json",
        )
        self.assertEqual(bad_schema.status_code, 400)

        sample_terms = {
            "SALE": {"sale_price": 18000000000},
            "RENT": {"deposit": 2000000000, "monthly_rent": 45000000},
            "FULL_MORTGAGE": {"deposit": 3500000000},
            "PRE_SALE": {"down_payment": 5000000000, "installments": "ده قسط سه‌ماهه"},
            "PARTNERSHIP": {"owner_share": 55, "contribution": "بلاعوض دو میلیارد تومان"},
            "EXCHANGE": {"exchange_asset": "آپارتمان کوچک‌تر در ونک", "cash_difference": 3000000000},
        }
        created_ids = {}
        for fam, terms_payload in sample_terms.items():
            dt, _ = self.behaviors[fam]
            resp = self.client.post(
                f"/crm/api/properties/{prop_id}/listings/",
                {
                    "deal_type": dt.pk,
                    "terms": terms_payload,
                    "sale_price": terms_payload.get("sale_price"),
                    "deposit": terms_payload.get("deposit"),
                    "monthly_rent": terms_payload.get("monthly_rent"),
                    "status": "ACTIVE" if fam in ("SALE", "RENT") else "DRAFT",
                },
                format="json",
            )
            self.assertEqual(resp.status_code, 200, f"{fam}: {resp.content}")
            created_ids[fam] = resp.data["id"]

        sale_listing_id = created_ids["SALE"]
        updated_sale = self.client.patch(
            f"/crm/api/listings/{sale_listing_id}/",
            {
                "deal_type": self.behaviors["SALE"][0].pk,
                "sale_price": 19500000000,
                "terms": {"sale_price": 19500000000},
                "status": "ACTIVE",
            },
            format="json",
        )
        self.assertEqual(updated_sale.status_code, 200, updated_sale.content)
        self.assertEqual(updated_sale.data["id"], sale_listing_id)
        price_hist = self.client.get(f"/crm/api/listings/{sale_listing_id}/price-history/")
        self.assertEqual(price_hist.status_code, 200)
        self.assertGreaterEqual(len(price_hist.data), 2)

        anon = APIClient()
        exp = anon.get(f"/crm/api/explore/?district={self.district.pk}&area_min=100&price_max=20000000000")
        self.assertEqual(exp.status_code, 200, exp.content)
        self.assertEqual(len(exp.data["results"]), 1)
        row = exp.data["results"][0]
        self.assertEqual(row["id"], sale_listing_id)
        self.assertNotIn("owner_phone", row)
        self.assertNotIn("address", row)
        self.assertNotIn("visit_notes", row)
        self.assertEqual(models.Introduction.objects.count(), 0)

        self.auth(self.mgr1)
        reopened = self.client.post(
            f"/crm/api/property-cases/{case_id}/reopen_appraisal/",
            {"reason": "بازبینی متراژ سندی"},
            format="json",
        )
        self.assertEqual(reopened.status_code, 200, reopened.content)
        self.assertEqual(reopened.data["stage"], "appraisal")
        self.assertEqual(len(reopened.data["appraisal"]["archived_reports"]), 1)
        self.assertEqual(Listing.objects.get(pk=sale_listing_id).status, Listing.Status.PAUSED)
        self.assertEqual(anon.get("/crm/api/explore/").data["results"], [])

        closed = self.client.post(
            f"/crm/api/property-cases/{case_id}/change_case_status/",
            {"status": "CANCELLED", "reason": "انصراف موقت مالک"},
            format="json",
        )
        self.assertEqual(closed.status_code, 200, closed.content)
        self.assertEqual(closed.data["stage"], "closed")

        reopen_case = self.client.post(
            f"/crm/api/property-cases/{case_id}/change_case_status/",
            {"status": "REOPEN", "reason": "تماس مجدد مالک"},
            format="json",
        )
        self.assertEqual(reopen_case.status_code, 200, reopen_case.content)
        self.assertEqual(reopen_case.data["stage"], "appraisal")
        self.assertEqual(Listing.objects.get(pk=sale_listing_id).status, Listing.Status.PAUSED)
        self.assertGreaterEqual(Notification.objects.count(), 3)

    def test_contract_lock_mark_duplicate_paused_listing_and_finance_forbidden(self):
        self.auth(self.mgr1)
        first = self.client.post(
            "/crm/api/property-cases/",
            {"contact_full_name": "مالک اول", "contact_phone": "09120001122", "description": "ملک اصلی"},
            format="json",
        ).data
        second = self.client.post(
            "/crm/api/property-cases/",
            {"contact_full_name": "مالک دوم", "contact_phone": "09120003344", "description": "ملک تکراری"},
            format="json",
        ).data

        no_reason_dup = self.client.post(
            f"/crm/api/property-cases/{second['id']}/mark_duplicate/",
            {"duplicate_of": first["id"], "reason": ""},
            format="json",
        )
        self.assertEqual(no_reason_dup.status_code, 400)

        dup_ok = self.client.post(
            f"/crm/api/property-cases/{second['id']}/mark_duplicate/",
            {"duplicate_of": first["id"], "reason": "ثبت مجدد توسط مالک"},
            format="json",
        )
        self.assertEqual(dup_ok.status_code, 200, dup_ok.content)
        self.assertEqual(dup_ok.data["stage"], "closed")
        self.assertEqual(dup_ok.data["status"], models.CaseStatus.DUPLICATE)

        self.client.post(
            f"/crm/api/property-cases/{first['id']}/assign/",
            {"assigned_to": self.adv1.pk, "due_at": (timezone.now() + timedelta(days=3)).isoformat()},
            format="json",
        )
        self.auth(self.adv1)
        self.client.post(f"/crm/api/property-cases/{first['id']}/accept_assignment/", {}, format="json")
        saved = self.client.post(
            f"/crm/api/property-cases/{first['id']}/save_workspace/",
            {
                "address": "جردن، خیابان گلستان، پلاک ۸",
                "district": self.district.pk,
                "property_type": "APARTMENT",
                "area": 120,
                "report_text": "سند تک‌برگ و کارشناسی کامل",
                "is_complete": True,
            },
            format="json",
        ).data
        prop_id = saved["property_id"]
        rev1 = self.client.post(
            f"/crm/api/property-cases/{first['id']}/submit_property_for_review/",
            {"version": saved["version"]},
            format="json",
        ).data
        self.auth(self.mgr1)
        self.client.post(
            f"/crm/api/reviews/{rev1['id']}/decide/",
            {"decision": "APPROVED", "property_title": "آپارتمان ۱۲۰ متری گلستان"},
            format="json",
        )

        self.auth(self.adv1)
        listing = self.client.post(
            f"/crm/api/properties/{prop_id}/listings/",
            {"deal_type": self.behaviors["SALE"][0].pk, "terms": {"sale_price": 12000000000}, "status": "ACTIVE"},
            format="json",
        ).data

        self.auth(self.mgr1)
        self.client.post(
            f"/crm/api/property-cases/{first['id']}/reopen_appraisal/",
            {"reason": "بازبینی مجدد"},
            format="json",
        )
        self.auth(self.adv1)
        resaved = self.client.post(
            f"/crm/api/property-cases/{first['id']}/save_workspace/",
            {"report_text": "بازبینی انجام شد", "is_complete": True},
            format="json",
        ).data
        rev2 = self.client.post(
            f"/crm/api/property-cases/{first['id']}/submit_property_for_review/",
            {"version": resaved["version"]},
            format="json",
        ).data
        self.auth(self.mgr1)
        self.client.post(f"/crm/api/reviews/{rev2['id']}/decide/", {"decision": "APPROVED"}, format="json")
        self.assertEqual(Listing.objects.get(pk=listing["id"]).status, Listing.Status.PAUSED)

        self.auth(self.fin)
        self.assertEqual(self.client.post("/crm/api/property-cases/", {"contact_full_name": "تست", "contact_phone": "09120009999"}, format="json").status_code, 403)
        self.assertEqual(self.client.get("/crm/api/reviews/").status_code, 403)

        buyer_contact = models.Contact.objects.create(full_name="خریدار واقعی", created_by=self.mgr1)
        inquiry = models.Inquiry.objects.create(
            code="INQ-LOCK-1",
            contact=buyer_contact,
            sales_range=self.range1,
            created_by=self.mgr1,
            assigned_to=self.adv1,
            lead_status=models.LeadStatus.ACCEPTED,
            acceptance_status=models.AcceptanceStatus.ACCEPTED,
        )
        intro = models.Introduction.objects.create(
            inquiry=inquiry,
            property_file_id=listing["id"],
            introduced_by=self.adv1,
        )
        viewing = models.Viewing.objects.create(
            introduction=intro,
            scheduled_at=timezone.now(),
            result=models.Viewing.Result.INTERESTED,
            assigned_to=self.adv1,
        )
        _, ver = self.behaviors["SALE"]
        deal = models.Deal.objects.create(
            introduction=intro,
            viewing=viewing,
            property_file_id=listing["id"],
            inquiry=inquiry,
            assigned_to=self.adv1,
            deal_type_version=ver,
        )
        contract = models.Contract.objects.create(
            contract_number="CT-LOCK-1",
            deal=deal,
            deal_type_version=ver,
            status=models.Contract.Status.FINALIZED,
            finalized_at=timezone.now(),
            finalized_by=self.mgr1,
            created_by=self.mgr1,
        )
        self.assertIsNotNone(contract.pk)

        self.auth(self.mgr1)
        locked_close = self.client.post(
            f"/crm/api/property-cases/{first['id']}/change_case_status/",
            {"status": "CLOSED", "reason": "بستن غیرمجاز پس از قرارداد"},
            format="json",
        )
        self.assertEqual(locked_close.status_code, 400)

        locked_reopen_appraisal = self.client.post(
            f"/crm/api/property-cases/{first['id']}/reopen_appraisal/",
            {"reason": "بازگشایی غیرمجاز پس از قرارداد قطعی"},
            format="json",
        )
        self.assertEqual(locked_reopen_appraisal.status_code, 400)

        prop_detail = self.client.get(f"/properties/api/properties/{prop_id}/")
        self.assertEqual(prop_detail.status_code, 200, prop_detail.content)
        self.assertEqual(prop_detail.data["propertyCaseId"], first["id"])
        self.assertTrue(len(prop_detail.data["parties"]) >= 1)
        self.assertTrue(len(prop_detail.data["changeHistory"]) >= 1)
        self.assertIsNotNone(prop_detail.data["structuredAppraisal"])

        root_explore = self.client.get("/explore/")
        self.assertEqual(root_explore.status_code, 200)


    def test_workspace_save_and_review_submit_lock_only_the_case_row(self):
        """The appraisal step must not lock the nullable relations it joins.

        `resulting_property` is nullable and `appraisal` is a reverse one-to-one, so both joins are
        outer ones. `select_for_update()` without `of=("self",)` asks PostgreSQL to lock the joined
        rows too, and PostgreSQL refuses that outright — "FOR UPDATE cannot be applied to the
        nullable side of an outer join" — which made «ذخیره و ارسال برای تأیید مدیر» answer 500 for
        every case, whatever the payload.
        """
        self.auth(self.mgr1)
        created = self.client.post(
            "/crm/api/property-cases/",
            {"contact_full_name": "مالک قفل", "contact_phone": "09121113344", "description": "ملک آزمون قفل"},
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.content)
        case = models.PropertyRegistrationRequest.objects.get(pk=created.data["id"])

        def case_locks(queries):
            found = []
            for query in queries.captured_queries:
                sql = query["sql"].lower()
                # The statement that joins the nullable relations and asks for a row lock.
                if "for update" in sql and "crm_propertyregistrationrequest" in sql and "left outer join" in sql:
                    found.append(query["sql"].lower().split("for update", 1)[1].replace('"', ""))
            return found

        with CaptureQueriesContext(connection) as workspace_queries:
            services.save_workspace(
                case,
                self.mgr1,
                {"version": case.version, "contact_full_name": "مالک قفل", "contact_phone": "09121113344"},
            )
        workspace_locks = case_locks(workspace_queries)
        self.assertTrue(workspace_locks, "the workspace save must lock the case row")
        for clause in workspace_locks:
            self.assertIn("of crm_propertyregistrationrequest", clause)
            self.assertNotIn("properties_property", clause)

        case = models.PropertyRegistrationRequest.objects.get(pk=case.pk)
        self.assertIsNotNone(case.resulting_property_id)

        # Submitting for review joins `resulting_property` and `appraisal` and locks the same way.
        # The empty workspace is rejected with a validation error, but only after the row is locked,
        # which is exactly the statement that used to blow up.
        with CaptureQueriesContext(connection) as review_queries:
            with self.assertRaises(DjangoValidationError):
                services.submit_property_for_review(
                    models.PropertyRegistrationRequest.objects.get(pk=case.pk),
                    self.mgr1,
                    {"version": case.version},
                )
        review_locks = case_locks(review_queries)
        self.assertTrue(review_locks, "submitting for review must lock the case row")
        for clause in review_locks:
            self.assertIn("of crm_propertyregistrationrequest", clause)
            self.assertNotIn("properties_property", clause)
            self.assertNotIn("crm_propertyappraisal", clause)

    def test_appraisal_persists_location_coordinates_type_attributes_and_review_snapshot(self):
        parking = Attribute.objects.create(
            name="supply_parking",
            display_name="پارکینگ",
            data_type=Attribute.DataType.BOOLEAN,
            entity=Attribute.Entity.PROPERTY,
        )
        view = Attribute.objects.create(
            name="supply_view",
            display_name="چشم‌انداز",
            data_type=Attribute.DataType.TEXT,
            entity=Attribute.Entity.PROPERTY,
        )
        rooms = Attribute.objects.create(
            name="rooms",
            display_name="تعداد اتاق",
            data_type=Attribute.DataType.INTEGER,
            entity=Attribute.Entity.PROPERTY,
            is_core=False,
        )
        floor = Attribute.objects.create(
            name="floor",
            display_name="طبقه",
            data_type=Attribute.DataType.INTEGER,
            entity=Attribute.Entity.PROPERTY,
            is_core=False,
        )
        built_year = Attribute.objects.create(
            name="built_year",
            display_name="سال ساخت",
            data_type=Attribute.DataType.INTEGER,
            entity=Attribute.Entity.PROPERTY,
            is_core=False,
        )
        PropertyTypeAttribute.objects.create(
            property_type=self.prop_type, attribute=parking, is_required=True
        )
        PropertyTypeAttribute.objects.create(property_type=self.prop_type, attribute=view)
        PropertyTypeAttribute.objects.create(property_type=self.prop_type, attribute=rooms)
        PropertyTypeAttribute.objects.create(property_type=self.prop_type, attribute=floor)
        PropertyTypeAttribute.objects.create(property_type=self.prop_type, attribute=built_year)

        self.auth(self.mgr1)
        created = self.client.post(
            "/crm/api/property-cases/",
            {"contact_full_name": "مالک آزمون", "contact_phone": "09121112233", "description": "ملک با موقعیت"},
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.content)
        case_id = created.data["id"]
        assigned = self.client.post(
            f"/crm/api/property-cases/{case_id}/assign/",
            {"assigned_to": self.adv1.pk, "due_at": (timezone.now() + timedelta(days=2)).isoformat()},
            format="json",
        )
        self.assertEqual(assigned.status_code, 200, assigned.content)

        self.auth(self.adv1)
        accepted = self.client.post(f"/crm/api/property-cases/{case_id}/accept_assignment/", {}, format="json")
        self.assertEqual(accepted.status_code, 200, accepted.content)
        workspace = {
            "address": "تهران، جردن، خیابان آزمون",
            "district": self.district.pk,
            "property_type": "APARTMENT",
            "property_type_ref": self.prop_type.pk,
            "property_usage": self.prop_type.property_usage_id,
            "latitude": "35.721900",
            "longitude": "51.334700",
            "attributes": {
                parking.name: True,
                view.name: "شهر",
                rooms.name: 3,
                floor.name: 5,
                built_year.name: 1403,
            },
            "area": 120,
            "report_text": "گزارش کامل کارشناسی",
            "is_complete": True,
            "version": accepted.data["version"],
        }
        invalid_coordinates = self.client.post(
            f"/crm/api/property-cases/{case_id}/save_workspace/",
            {**workspace, "longitude": None},
            format="json",
        )
        self.assertEqual(invalid_coordinates.status_code, 400)
        self.assertIn("coordinates", invalid_coordinates.data)
        invalid_usage = self.client.post(
            f"/crm/api/property-cases/{case_id}/save_workspace/",
            {**workspace, "property_usage": self.prop_type.property_usage_id + 999},
            format="json",
        )
        self.assertEqual(invalid_usage.status_code, 400)
        self.assertIn("property_usage", invalid_usage.data)
        unknown_attribute = self.client.post(
            f"/crm/api/property-cases/{case_id}/save_workspace/",
            {**workspace, "attributes": {"not_for_this_type": "x"}},
            format="json",
        )
        self.assertEqual(unknown_attribute.status_code, 400)
        self.assertIn("attributes", unknown_attribute.data)

        saved = self.client.post(
            f"/crm/api/property-cases/{case_id}/save_workspace/", workspace, format="json"
        )
        self.assertEqual(saved.status_code, 200, saved.content)
        prop = Property.objects.get(pk=saved.data["property_id"])
        self.assertEqual(prop.district_id, self.district.pk)
        self.assertEqual(prop.latitude, Decimal("35.721900"))
        self.assertEqual(prop.longitude, Decimal("51.334700"))
        self.assertEqual(prop.property_type_ref_id, self.prop_type.pk)
        self.assertEqual(prop.property_usage_id, self.prop_type.property_usage_id)
        self.assertEqual((prop.rooms, prop.floor, prop.built_year), (3, 5, 1403))
        self.assertIs(PropertyAttributeValue.objects.get(property=prop, attribute=parking).value, True)
        self.assertEqual(PropertyAttributeValue.objects.get(property=prop, attribute=view).value, "شهر")
        self.assertEqual(PropertyAttributeValue.objects.get(property=prop, attribute=rooms).value, 3)
        self.assertEqual(PropertyAttributeValue.objects.get(property=prop, attribute=floor).value, 5)
        self.assertEqual(PropertyAttributeValue.objects.get(property=prop, attribute=built_year).value, 1403)
        image_buffer = BytesIO()
        Image.new("RGB", (2, 2), color=(20, 80, 120)).save(image_buffer, format="PNG")
        image_bytes = image_buffer.getvalue()
        with TemporaryDirectory() as media_root, override_settings(MEDIA_ROOT=media_root):
            upload = self.client.post(
                f"/properties/api/properties/{prop.pk}/images/",
                {"images": SimpleUploadedFile("review-snapshot.png", image_bytes, content_type="image/png")},
                format="multipart",
                HTTP_IDEMPOTENCY_KEY="supply-review-image-1",
            )
            self.assertEqual(upload.status_code, 201, upload.content)
            retried_upload = self.client.post(
                f"/properties/api/properties/{prop.pk}/images/",
                {"images": SimpleUploadedFile("review-snapshot.png", image_bytes, content_type="image/png")},
                format="multipart",
                HTTP_IDEMPOTENCY_KEY="supply-review-image-1",
            )
            self.assertEqual(retried_upload.status_code, 201, retried_upload.content)
            self.assertEqual(retried_upload.data[0]["id"], upload.data[0]["id"])

        image_id = upload.data[0]["id"]
        self.assertEqual(prop.images.count(), 1)
        submitted = self.client.post(
            f"/crm/api/property-cases/{case_id}/submit_property_for_review/",
            {"version": saved.data["version"]},
            format="json",
        )
        self.assertEqual(submitted.status_code, 201, submitted.content)
        snapshot = submitted.data["snapshot"]
        self.assertEqual(snapshot["province_id"], self.district.city.province_id)
        self.assertEqual(snapshot["city_id"], self.district.city_id)
        self.assertEqual(snapshot["district_id"], self.district.pk)
        self.assertEqual(snapshot["latitude"], "35.721900")
        self.assertEqual(snapshot["longitude"], "51.334700")
        self.assertEqual(snapshot["property_type_ref_id"], self.prop_type.pk)
        self.assertEqual(snapshot["property_usage_id"], self.prop_type.property_usage_id)
        snapshot_attrs = {item["name"]: item for item in snapshot["attributes"]}
        self.assertEqual(snapshot_attrs[parking.name]["value"], True)
        self.assertEqual(snapshot_attrs[parking.name]["display_value"], "بله")
        self.assertEqual(snapshot_attrs[view.name]["value"], "شهر")
        self.assertEqual(snapshot_attrs[rooms.name]["value"], 3)
        self.assertEqual(snapshot_attrs[floor.name]["value"], 5)
        self.assertEqual(snapshot_attrs[built_year.name]["value"], 1403)
        self.assertEqual(len(snapshot["images"]), 1)
        self.assertEqual(snapshot["images"][0]["id"], image_id)
        self.assertTrue(snapshot["images"][0]["url"])

        locked_upload = self.client.post(
            f"/properties/api/properties/{prop.pk}/images/", {}, format="multipart"
        )
        self.assertEqual(locked_upload.status_code, 409)
        locked_edit = self.client.patch(
            f"/properties/api/properties/{prop.pk}/", {"description": "تغییر پس از ارسال"}, format="json"
        )
        self.assertEqual(locked_edit.status_code, 400)
        locked_workspace = self.client.post(
            f"/crm/api/property-cases/{case_id}/save_workspace/",
            {
                "version": models.PropertyRegistrationRequest.objects.get(pk=case_id).version,
                "address": "تغییر از مسیر کارشناسی پس از ارسال",
            },
            format="json",
        )
        self.assertEqual(locked_workspace.status_code, 400)
        prop.refresh_from_db()
        self.assertEqual(prop.address, workspace["address"])

    def test_submission_requires_required_dynamic_property_attributes(self):
        required = Attribute.objects.create(
            name="supply_required_floor",
            display_name="تعداد طبقه",
            data_type=Attribute.DataType.INTEGER,
            entity=Attribute.Entity.PROPERTY,
        )
        PropertyTypeAttribute.objects.create(
            property_type=self.prop_type, attribute=required, is_required=True
        )
        self.auth(self.mgr1)
        created = self.client.post(
            "/crm/api/property-cases/",
            {"contact_full_name": "مالک دوم", "contact_phone": "09121112244", "description": "ملک"},
            format="json",
        )
        case_id = created.data["id"]
        self.client.post(
            f"/crm/api/property-cases/{case_id}/assign/",
            {"assigned_to": self.adv1.pk, "due_at": (timezone.now() + timedelta(days=2)).isoformat()},
            format="json",
        )
        self.auth(self.adv1)
        accepted = self.client.post(f"/crm/api/property-cases/{case_id}/accept_assignment/", {}, format="json")
        saved = self.client.post(
            f"/crm/api/property-cases/{case_id}/save_workspace/",
            {
                "address": "نشانی آزمون",
                "district": self.district.pk,
                "property_type_ref": self.prop_type.pk,
                "area": 100,
                "report_text": "گزارش کامل",
                "is_complete": True,
                "version": accepted.data["version"],
            },
            format="json",
        )
        self.assertEqual(saved.status_code, 200, saved.content)
        rejected = self.client.post(
            f"/crm/api/property-cases/{case_id}/submit_property_for_review/",
            {"version": saved.data["version"]},
            format="json",
        )
        self.assertEqual(rejected.status_code, 400)
        self.assertIn("attributes", rejected.data)
