import React, { useState } from "react";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAppPath, parseAppLocation } from "../../shared/lib/appRouting";
import {
  clearLastVisitedCase,
  clearSupplyDraft,
  computeStallInfo,
  deriveWizardStage,
  formatFaAmount,
  formatFaInt,
  normalizePersianSearch,
  previewDealTypeChange,
  readLastVisitedCase,
  readSupplyDraft,
  saveLastVisitedCase,
  stageGuidanceForRole,
  subscribeSupplyCountersRefresh,
  supplyStatusBadgeMeta,
  writeSupplyDraft,
  type PropertyCaseRecord,
} from "./lib/supplyDomain";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://crm.example.test/app/property-register/",
});
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  HTMLSelectElement: dom.window.HTMLSelectElement,
  HTMLButtonElement: dom.window.HTMLButtonElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
  Event: dom.window.Event,
  InputEvent: dom.window.InputEvent,
  MouseEvent: dom.window.MouseEvent,
  KeyboardEvent: dom.window.KeyboardEvent,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  localStorage: dom.window.localStorage,
  sessionStorage: dom.window.sessionStorage,
});

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { AccessibleModal } = await import("./components/AccessibleModal");
const { ReviewsQueuePage } = await import("./pages/ReviewsQueuePage");

beforeEach(() => {
  dom.window.localStorage.clear();
  dom.window.sessionStorage.clear();
  dom.window.history.replaceState({}, "", "/app/property-register/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const baseCase: PropertyCaseRecord = {
  id: 101,
  code: "PC-101",
  contact: 11,
  contact_name: "کریم یوسفی",
  scope: 1,
  scope_name: "رنج شمال",
  sales_range: 1,
  sales_range_name: "رنج شمال",
  lead_status: "PENDING",
  acceptance_status: "UNASSIGNED",
  status: "ACTIVE",
  stage: "reception",
  assigned_to: null,
  property_title: "",
  description: "آپارتمان جردن",
  version: 1,
};

describe("supply domain helpers", () => {
  it("derives wizard stage strictly from server stage and guides roles accurately", () => {
    expect(deriveWizardStage(null)).toBe("lead");
    expect(deriveWizardStage({ ...baseCase, stage: "reception" })).toBe("reception");
    expect(deriveWizardStage({ ...baseCase, stage: "assignment" })).toBe("assignment");
    expect(deriveWizardStage({ ...baseCase, stage: "acceptance" })).toBe("acceptance");
    expect(deriveWizardStage({ ...baseCase, stage: "appraisal" })).toBe("appraisal");
    expect(deriveWizardStage({ ...baseCase, stage: "review" })).toBe("review");
    expect(deriveWizardStage({ ...baseCase, stage: "listing" })).toBe("listing");

    expect(stageGuidanceForRole(baseCase, "range_manager", "5").canActNow).toBe(true);
    expect(stageGuidanceForRole(baseCase, "consultant", "9").canActNow).toBe(false);
    expect(
      stageGuidanceForRole(
        { ...baseCase, stage: "acceptance", assigned_to: 9 },
        "consultant",
        "9",
      ).canActNow,
    ).toBe(true);
  });

  it("isolates browser drafts per user and supports last-visited reminder banner", () => {
    writeSupplyDraft("consultant:9", 101, { address: "جردن", area: "145" }, 2);
    expect(readSupplyDraft("consultant:9", 101)?.fields).toEqual({ address: "جردن", area: "145" });
    expect(readSupplyDraft("consultant:12", 101)).toBeNull();
    clearSupplyDraft("consultant:9", 101);
    expect(readSupplyDraft("consultant:9", 101)).toBeNull();

    saveLastVisitedCase("range_manager:5", {
      id: 101,
      code: "PC-101",
      title: "آپارتمان جردن",
      stageLabel: "کارشناسی ملک",
    });
    expect(readLastVisitedCase("range_manager:5")?.code).toBe("PC-101");
    expect(readLastVisitedCase("consultant:9")).toBeNull();
    clearLastVisitedCase("range_manager:5");
    expect(readLastVisitedCase("range_manager:5")).toBeNull();
  });

  it("normalizes Persian/Arabic text and formats Persian digits with unknown fallback", () => {
    expect(normalizePersianSearch("كريم يوسفي ۱۲۳")).toBe(normalizePersianSearch("کریم یوسفی 123"));
    expect(formatFaInt(null)).toBe("نامشخص");
    expect(formatFaAmount(null)).toBe("نامشخص");
    expect(formatFaAmount(18500000)).toContain("تومان");
  });

  it("computes stall status, 48h reassignment eligibility, distinct badges, and deal-type previews", () => {
    const now = new Date("2026-10-23T12:00:00Z").getTime();
    const freshPending = computeStallInfo(
      { ...baseCase, stage: "acceptance", acceptance_status: "PENDING", assigned_at: "2026-10-22T12:00:00Z" },
      now,
    );
    expect(freshPending.canReassignUnanswered).toBe(false);

    const unanswered49h = computeStallInfo(
      { ...baseCase, stage: "acceptance", acceptance_status: "PENDING", assigned_at: "2026-10-21T10:00:00Z" },
      now,
    );
    expect(unanswered49h.canReassignUnanswered).toBe(true);

    expect(supplyStatusBadgeMeta("property_review", "APPROVED").label).toBe("تأییدشده");
    expect(supplyStatusBadgeMeta("listing", "ACTIVE").label).toBe("فعال");
    expect(supplyStatusBadgeMeta("listing", "PAUSED").label).toBe("متوقف");

    const preview = previewDealTypeChange(
      { fields: [{ key: "sale_price", label: "ثمن معامله", type: "integer", required: true }] },
      {
        fields: [
          { key: "deposit", label: "ودیعه", type: "integer", required: true },
          { key: "monthly_rent", label: "اجاره ماهانه", type: "integer", required: true },
        ],
      },
      { sale_price: 15000000000 },
    );
    expect(preview.preservedTerms).toEqual({});
    expect(preview.incompatibleFields.map((f) => f.key)).toEqual(["sale_price"]);
    expect(preview.addedRequiredFields.map((f) => f.key)).toEqual(["deposit", "monthly_rent"]);
  });

  it("maps canonical supply routes accurately", () => {
    expect(buildAppPath("crm-property-register")).toBe("/app/property-register/");
    expect(buildAppPath("crm-reviews")).toBe("/app/reviews/");
    expect(parseAppLocation("/app/property-register/", "?id=77", "login")).toEqual({
      page: "crm-property-register",
      crmRecordId: "77",
    });
    expect(parseAppLocation("/app/requests/49/", "", "login")).toEqual({
      page: "crm-property-cases",
      crmRecordId: "49",
    });
    expect(parseAppLocation("/app/reviews/", "", "login")).toEqual({ page: "crm-reviews" });
    expect(parseAppLocation("/app/explore/", "", "login")).toEqual({ page: "property-files-explore" });
  });
});

describe("accessible nested modals and review queue UI", () => {
  it("closes only the child modal on Escape, preserves parent state, and restores trigger focus", async () => {
    function Harness() {
      const [parentOpen, setParentOpen] = useState(true);
      const [childOpen, setChildOpen] = useState(false);
      const [parentNote, setParentNote] = useState("یادداشت والد");
      return (
        <div>
          <AccessibleModal open={parentOpen} onClose={() => setParentOpen(false)} title="پنجره والد">
            <input aria-label="ورودی والد" value={parentNote} onChange={(e) => setParentNote(e.target.value)} />
            <button type="button" onClick={() => setChildOpen(true)}>
              ثبت کار
            </button>
          </AccessibleModal>
          <AccessibleModal open={childOpen} onClose={() => setChildOpen(false)} title="پنجره فرزند">
            <input aria-label="ورودی فرزند" defaultValue="" />
          </AccessibleModal>
        </div>
      );
    }

    const view = render(<Harness />);
    const parentInput = view.getByLabelText("ورودی والد") as HTMLInputElement;
    fireEvent.change(parentInput, { target: { value: "متن حفظ‌شده" } });
    const childTrigger = view.getByRole("button", { name: "ثبت کار" });
    childTrigger.focus();
    fireEvent.click(childTrigger);

    expect(view.getByRole("heading", { name: "پنجره فرزند" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(view.queryByRole("heading", { name: "پنجره فرزند" })).toBeNull();
    expect(view.getByRole("heading", { name: "پنجره والد" })).toBeTruthy();
    expect((view.getByLabelText("ورودی والد") as HTMLInputElement).value).toBe("متن حفظ‌شده");
    expect(document.activeElement).toBe(childTrigger);
  });

  it("blocks non-managers from review queue and updates counters live on approval", async () => {
    const forbiddenView = render(
      <ReviewsQueuePage csrfToken="tok" page="crm-reviews" role="consultant" navigate={vi.fn()} />,
    );
    expect(forbiddenView.getByText("عدم دسترسی به صف تأیید ملک")).toBeTruthy();
    forbiddenView.unmount();

    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ id: 101, stage: "listing" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (String(url).includes("/crm/api/reviews/")) {
        return new Response(
          JSON.stringify({
            count: 1,
            results: [
              {
                id: 501,
                property: 88,
                property_code: "P-88",
                property_title: "",
                property_area: 145,
                property_district: "جردن",
                property_address: "ناهید شرقی",
                property_type_display: "آپارتمان",
                registration_request: 101,
                case_version: 3,
                case_code: "PC-101",
                scope_name: "رنج شمال",
                assignee_name: "مشاور اول",
                appraisal_summary: {
                  report_text: "سازه بسیار مستحکم و سند تک‌برگ",
                  visit_notes: "",
                  findings: {},
                  is_complete: true,
                },
                version: 1,
                current_review_version: 2,
                version_drift: true,
                submitted_by: 9,
                submitted_by_name: "مشاور اول",
                submitted_at: "2026-10-23T10:00:00Z",
                decision: "PENDING",
                decision_display: "در انتظار بررسی",
                reason: "",
                snapshot: {
                  title: "آپارتمان نسخهٔ اول",
                  property_title: "عنوان snapshot",
                  address: "نشانی snapshot",
                  area: 145,
                  province_name: "تهران",
                  city_name: "تهران",
                  location_path: "تهران / جردن",
                  latitude: "35.721900",
                  longitude: "51.334700",
                  property_type_display: "آپارتمان مسکونی",
                  property_usage_name: "مسکونی",
                  attributes: [{ id: 1, name: "parking", display_name: "پارکینگ", value: true, display_value: "بله" }],
                  images: [{ id: 701, sort_order: 0, url: "/media/snapshot.png" }],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    let refreshEvents = 0;
    const unsub = subscribeSupplyCountersRefresh(() => {
      refreshEvents += 1;
    });

    const mgrView = render(<ReviewsQueuePage csrfToken="tok" page="crm-reviews" role="range_manager" navigate={vi.fn()} />);
    expect(await mgrView.findByText(/هشدار تغییر نسخه پس از ارسال/)).toBeTruthy();
    expect(mgrView.getByText("عنوان snapshot")).toBeTruthy();
    expect(mgrView.getByText("نشانی snapshot")).toBeTruthy();
    expect(mgrView.getByText("تهران / جردن")).toBeTruthy();
    expect(mgrView.getByText("بله")).toBeTruthy();
    expect(mgrView.getByAltText("تصویر ملک 701")).toBeTruthy();

    fireEvent.click(mgrView.getByRole("button", { name: "تأیید نهایی ملک" }));
    expect(mgrView.getByText(/تعیین عنوان مدیریتی ملک الزامی است/)).toBeTruthy();

    fireEvent.change(mgrView.getByPlaceholderText(/آپارتمان ۱۴۵ متری/), {
      target: { value: "آپارتمان ۱۴۵ متری ناهید" },
    });
    fireEvent.click(mgrView.getByRole("button", { name: "تأیید نهایی ملک" }));

    await waitFor(() => {
      expect(refreshEvents).toBeGreaterThanOrEqual(1);
    });
    unsub();
  });
});
