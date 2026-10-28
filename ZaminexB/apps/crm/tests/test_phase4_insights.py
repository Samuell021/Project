from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from apps.crm import models
from apps.crm.tests.phase4_support import Phase4FixtureMixin
from apps.tasks.models import Task


class InsightsTests(Phase4FixtureMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.case = self.make_approved_case()
        self.listing = self.make_listing(self.case)
        self.inquiry = self.make_assigned_inquiry()
        today = timezone.localdate()
        self.range_query = f"?from={(today - timedelta(days=30)).isoformat()}&to={today.isoformat()}"

    def test_dashboard_requires_explicit_range(self):
        self.auth(self.admin)
        missing = self.client.get("/crm/api/dashboard/summary/")
        self.assertEqual(missing.status_code, 400, missing.content)
        invalid = self.client.get("/crm/api/dashboard/summary/?from=2026-10-30&to=2026-10-01")
        self.assertEqual(invalid.status_code, 400)
        ok = self.client.get(f"/crm/api/dashboard/summary/{self.range_query}")
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertEqual(ok.data["role"], "admin")
        keys = [metric["key"] for metric in ok.data["metrics"]]
        self.assertIn("active_listings", keys)
        self.assertIn("pending_reviews", keys)
        self.assertIn("finance", ok.data)
        self.assertNotEqual(ok.data["finance"].get("claimed"), None)

    def test_consultant_dashboard_is_priority_ordered_and_hides_team_totals(self):
        self.auth(self.agent)
        response = self.client.get(f"/crm/api/dashboard/summary/{self.range_query}")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data["role"], "consultant")
        self.assertEqual(response.data["team"], [])
        self.assertEqual(response.data["finance"], {})
        self.assertEqual(response.data["metrics"][0]["key"], "today_tasks")

    def test_range_manager_dashboard_exposes_team_table(self):
        self.auth(self.manager)
        response = self.client.get(f"/crm/api/dashboard/summary/{self.range_query}")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data["role"], "range_manager")
        names = [row["name"] for row in response.data["team"]]
        self.assertTrue(response.data["team"])
        self.assertIn(self.agent.get_full_name() or self.agent.username, names)
        row = response.data["team"][0]
        for column in ("active_listings", "new_leads", "overdue_followups", "calls", "viewings", "open_deals", "won_deals"):
            self.assertIn(column, row)

    def test_reports_are_scoped_and_separate_finance_from_deal_value(self):
        self.auth(self.agent)
        self.assertEqual(self.client.get(f"/crm/api/reports/{self.range_query}").status_code, 403)
        self.auth(self.admin)
        response = self.client.get(f"/crm/api/reports/{self.range_query}")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn("funnel", response.data)
        self.assertIn("finance", response.data)
        self.assertEqual(response.data["deals"]["value_mixed"], False)
        self.assertEqual(response.data["funnel"]["contracts"], 0)
        self.assertEqual(response.data["finance"]["claimed"], "0")

    def test_pipelines_cover_six_boards_and_reject_unknown_kind(self):
        self.auth(self.admin)
        listing = self.client.get("/crm/api/pipelines/")
        self.assertEqual(listing.status_code, 200, listing.content)
        kinds = [item["kind"] for item in listing.data["available"]]
        self.assertEqual(kinds, ["leads", "listings", "inquiries", "deals", "contracts", "tasks"])
        board = self.client.get("/crm/api/pipelines/listings/")
        self.assertEqual(board.status_code, 200, board.content)
        active = next(column for column in board.data["stages"] if column["code"] == "ACTIVE")
        self.assertEqual(active["count"], 1)
        card = active["cards"][0]
        self.assertIn("financials", card)
        self.assertEqual(card["transitions"][0]["to"], "PAUSED")
        self.assertEqual(self.client.get("/crm/api/pipelines/unknown/").status_code, 400)

    def test_stage_age_is_read_from_stage_history(self):
        entry = models.StageTransitionHistory.objects.create(
            subject_type="listing",
            subject_id=self.listing.pk,
            from_stage="DRAFT",
            to_stage="ACTIVE",
        )
        models.StageTransitionHistory.objects.filter(pk=entry.pk).update(
            changed_at=timezone.now() - timedelta(days=12)
        )
        self.auth(self.admin)
        board = self.client.get("/crm/api/pipelines/listings/")
        card = next(
            card
            for column in board.data["stages"]
            for card in column["cards"]
            if card["id"] == self.listing.pk
        )
        self.assertGreaterEqual(card["days_in_stage"], 11)

    def test_stall_threshold_comes_from_workflow_settings(self):
        settings_obj = models.WorkflowSettings.load()
        settings_obj.stall_threshold_days = 0
        settings_obj.save()
        self.auth(self.admin)
        board = self.client.get("/crm/api/pipelines/listings/")
        self.assertEqual(board.data["stall_threshold_days"], 0)
        active = next(column for column in board.data["stages"] if column["code"] == "ACTIVE")
        self.assertTrue(active["cards"][0]["stalled"])

    def test_task_board_lists_overdue_items_and_filters_by_owner(self):
        Task.objects.create(
            title="تماس عقب‌افتاده",
            assigned_to=self.agent,
            created_by=self.manager,
            due_date=timezone.localdate() - timedelta(days=2),
        )
        self.auth(self.agent)
        board = self.client.get("/crm/api/pipelines/tasks/?mine=1&overdue=1")
        self.assertEqual(board.status_code, 200, board.content)
        pending = next(column for column in board.data["stages"] if column["code"] == "PENDING")
        self.assertEqual(pending["count"], 1)
        self.assertTrue(pending["cards"][0]["stalled"])
        self.assertEqual(pending["cards"][0]["transitions"][0]["to"], "IN_PROGRESS")

    def test_finance_role_sees_contract_board_only_with_finance_permission(self):
        self.auth(self.finance)
        listing = self.client.get("/crm/api/pipelines/")
        kinds = [item["kind"] for item in listing.data["available"]]
        self.assertIn("contracts", kinds)
        self.assertNotIn("leads", kinds)
        self.assertEqual(self.client.get("/crm/api/pipelines/leads/").data["kind"], "contracts")

    def test_listing_board_is_open_to_the_roles_that_manage_files(self):
        self.auth(self.agent)
        board = self.client.get("/crm/api/pipelines/listings/")
        self.assertEqual(board.status_code, 200, board.content)
        self.assertEqual(board.data["kind"], "listings")


class ConsultantPipelineTests(Phase4FixtureMixin, TestCase):
    """The consultant panel exposes the pipeline board, scoped to that consultant's own records."""

    def setUp(self):
        super().setUp()
        self.case = self.make_approved_case()
        self.listing = self.make_listing(self.case)
        self.inquiry = self.make_assigned_inquiry()

    def board_ids(self, kind):
        board = self.client.get(f"/crm/api/pipelines/{kind}/")
        self.assertEqual(board.status_code, 200, board.content)
        return board.data["kind"], [
            card["id"] for column in board.data["stages"] for card in column["cards"]
        ]

    def test_consultant_is_offered_only_the_pipelines_they_work_on(self):
        self.auth(self.agent)
        available = self.client.get("/crm/api/pipelines/")
        self.assertEqual(available.status_code, 200, available.content)
        # The contract board belongs to finance/administration, so it stays out of the panel.
        self.assertEqual(
            [item["kind"] for item in available.data["available"]],
            ["leads", "listings", "inquiries", "deals", "tasks"],
        )
        for kind in ("leads", "listings", "inquiries", "deals", "tasks"):
            requested, _ = self.board_ids(kind)
            self.assertEqual(requested, kind)

    def test_consultant_board_never_shows_another_consultants_records(self):
        self.auth(self.agent)
        _, lead_ids = self.board_ids("leads")
        self.assertIn(self.case.pk, lead_ids)
        _, listing_ids = self.board_ids("listings")
        self.assertIn(self.listing.pk, listing_ids)
        # The inquiry belongs to the other consultant in the same range.
        _, inquiry_ids = self.board_ids("inquiries")
        self.assertNotIn(self.inquiry.pk, inquiry_ids)

        self.auth(self.agent2)
        _, other_lead_ids = self.board_ids("leads")
        self.assertNotIn(self.case.pk, other_lead_ids)
        _, other_listing_ids = self.board_ids("listings")
        self.assertNotIn(self.listing.pk, other_listing_ids)
        _, other_inquiry_ids = self.board_ids("inquiries")
        self.assertIn(self.inquiry.pk, other_inquiry_ids)
