// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Reports } from "./pages/ReportsPage";
import { PermissionProvider } from "../../shared/lib/permissions";
import { formatJalali, tehranCalendarDate } from "../../shared/lib/jdate";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SUMMARY = {
  role: "admin",
  range: { from: "2026-09-26", to: "2026-10-26" },
  metrics: [{ key: "active_listings", label: "فایل فعال", value: 12, hint: "", severity: "normal", page: null }],
  team: [
    {
      user_id: 1,
      name: "مشاور نمونه",
      active_listings: 3,
      new_leads: 1,
      overdue_followups: 0,
      calls: 4,
      viewings: 2,
      open_deals: 1,
      won_deals: 0,
    },
  ],
  finance: { claimed: "1000", received: "500", shares_paid: "0", outstanding: "500" },
  role_flags: { manager: true, consultant: false, finance: true, general_manager: false },
};

const REPORT = {
  funnel: { cases: 1, inquiries: 2, introductions: 3, viewings: 4, deals: 5, contracts: 6, finalized: 7 },
  advisors: [
    {
      user_id: 1,
      name: "مشاور نمونه",
      active_listings: 3,
      new_leads: 1,
      overdue_followups: 0,
      calls: 4,
      viewings: 2,
      open_deals: 1,
      won_deals: 0,
    },
  ],
  stalled_listings: [],
  deals: {
    count: 2,
    finalized: 1,
    lost: 0,
    value_mixed: false,
    by_deal_type: [
      { deal_type: "فروش", deals: 1, contracts: 1, sale_value: "100", deposit_value: null, monthly_rent_value: null },
    ],
  },
  finance: { claimed: "1000", received: "500", shares_paid: "0", outstanding: "500" },
};

describe("reports page filters", () => {
  const originalFetch = globalThis.fetch;
  let requested: string[];

  beforeEach(() => {
    requested = [];
    window.history.replaceState({}, "", "/app/crm/reports/");
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("/crm/api/dashboard/summary/")) return jsonResponse(SUMMARY);
      if (url.includes("/crm/api/reports/")) return jsonResponse(REPORT);
      return jsonResponse({ results: [] });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function renderReports() {
    return render(
      <PermissionProvider permissions={null}>
        <Reports csrfToken="token" navigate={() => {}} />
      </PermissionProvider>,
    );
  }

  it("lays the whole date filter out as a single row of aligned controls", async () => {
    renderReports();
    const heading = await screen.findByText("بازه گزارش");
    expect(heading.closest("div")?.querySelector("svg")).not.toBeNull();

    const fromRoot = screen.getByText("از تاریخ").parentElement as HTMLElement;
    const toRoot = screen.getByText("تا تاریخ").parentElement as HTMLElement;
    for (const root of [fromRoot, toRoot]) {
      // The field is never pinned to a wrapper narrower than its own min width, which is what
      // pushed the box over its neighbours.
      expect(root.parentElement?.className).toContain("min-w-[13rem]");
      expect(root.parentElement?.className).toContain("flex-1");
      expect(root.parentElement?.className).not.toContain("w-44");
    }

    const applyButton = screen.getByRole("button", { name: "اعمال بازه" });
    const row = applyButton.parentElement as HTMLElement;
    expect(row.className).toContain("flex");
    expect(row.className).toContain("items-end");
    expect(fromRoot.parentElement?.parentElement).toBe(row);
    expect(toRoot.parentElement?.parentElement).toBe(row);
    expect(screen.getByRole("group", { name: "بازه‌های آماده" }).parentElement).toBe(row);
    expect(document.querySelector('[class*="w-44"]')).toBeNull();
  });

  it("shows the real Jalali dates and sends them to the API as Gregorian ISO", async () => {
    renderReports();
    await screen.findByText("بازه گزارش");
    const today = tehranCalendarDate(new Date().toISOString());
    const thirtyDaysAgo = tehranCalendarDate(new Date(Date.now() - 30 * 86400000).toISOString());

    // The calendar renders Gregorian ISO, so the field must hold Gregorian: it shows today.
    expect(screen.getByText(formatJalali(today))).toBeTruthy();
    expect(requested.some((url) => url.includes(`from=${thirtyDaysAgo}&to=${today}`))).toBe(true);
    expect(requested.some((url) => url.includes("/crm/api/reports/") && url.includes(`to=${today}`))).toBe(true);
  });

  it("keeps the default-range icon and its title on one line", async () => {
    renderReports();
    const button = await screen.findByRole("button", { name: "بازه پیش‌فرض" });
    const box = button.firstElementChild as HTMLElement;
    expect(box.tagName).toBe("SPAN");
    expect(box.className).toContain("inline-flex");
    expect(box.className).toContain("items-center");
    expect(box.className).toContain("gap-1.5");
    expect(box.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(box.textContent).toBe("بازه پیش‌فرض");
    // No stray text node next to the icon: the label lives inside the same box.
    const strayText = Array.from(button.childNodes).filter(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    );
    expect(strayText).toHaveLength(0);
  });

  it("scrolls in the shell only, with no second scroll region of its own", async () => {
    renderReports();
    await screen.findByText("بازه گزارش");
    // The page used to be pinned to the viewport height with an inner `overflow-y-auto` body,
    // which produced a nested scrollbar and an extra scroll at the bottom of the page. The report
    // now flows inside the shell's single scroll container.
    const page = document.querySelector('[dir="rtl"]') as HTMLElement;
    expect(page.className).not.toContain("h-full");
    expect(page.className).not.toContain("overflow-hidden");
    expect(page.querySelectorAll(".overflow-y-auto, .overflow-auto, .overflow-y-scroll")).toHaveLength(0);

    // The filter row is part of the document flow, right above the report body.
    const filterRow = screen.getByRole("group", { name: "بازه‌های آماده" });
    const body = screen.getByText("بازه گزارش").closest("div.rounded-2xl") as HTMLElement;
    expect(body.contains(filterRow)).toBe(true);
    expect(document.body.textContent).toContain("فایل فعال");
  });

  it("keeps every report table inside its own horizontal scroll area", async () => {
    renderReports();
    await screen.findByRole("tab", { name: "عملکرد مشاور" });
    // The team table sits in a card that scrolls on its own.
    const teamTable = screen.getByRole("table", { name: "وضعیت عملکرد اعضای تیم" });
    expect(teamTable.parentElement?.className).toContain("overflow-x-auto");

    fireEvent.click(screen.getByRole("tab", { name: "عملکرد مشاور" }));
    const advisorsTable = screen.getByRole("table", { name: "عملکرد مشاوران در بازه" });
    expect(advisorsTable.parentElement?.className).toContain("overflow-x-auto");

    fireEvent.click(screen.getByRole("tab", { name: "مذاکرات و قرارداد" }));
    const dealsTable = screen.getByRole("table", { name: "ارزش معامله به تفکیک نوع" });
    expect(dealsTable.parentElement?.className).toContain("overflow-x-auto");

    fireEvent.click(screen.getByRole("tab", { name: "فایل‌های متوقف" }));
    expect(screen.getByText("فایل متوقفی نیست")).toBeTruthy();
  });

  it("makes every scroll panel the containing block of its screen-reader caption", async () => {
    // A `.sr-only` caption is absolutely positioned. Inside a scroll panel that is not a
    // containing block it escapes to the document, which grows the page and adds a second
    // scrollbar under the shell; scrolling that bar slides the whole app out of view.
    const withStalled = {
      ...REPORT,
      stalled_listings: [{ id: 7, title: "فایل نمونه", deal_type: "فروش", days_in_stage: 12 }],
    };
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/crm/api/dashboard/summary/")) return jsonResponse(SUMMARY);
      if (url.includes("/crm/api/reports/")) return jsonResponse(withStalled);
      return jsonResponse({ results: [] });
    }) as unknown as typeof fetch;

    renderReports();
    await screen.findByRole("tab", { name: "عملکرد مشاور" });

    let inspected = 0;
    for (const tab of ["تبدیل", "عملکرد مشاور", "فایل‌های متوقف", "مذاکرات و قرارداد", "مالی"]) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      const panels = scrollPanelsHostingHiddenText();
      expect(panels.length).toBeGreaterThan(0);
      for (const panel of panels) {
        inspected += 1;
        expect(panel.className.split(/\s+/)).toContain("relative");
      }
    }
    // Every tab really renders a captioned panel, so the loop above is not a no-op.
    expect(inspected).toBeGreaterThanOrEqual(5);
  });
});

/** The nearest scrolling panel below the shell that holds an absolutely positioned `.sr-only`. */
function scrollPanelsHostingHiddenText(): HTMLElement[] {
  const panelTokens = new Set([
    "overflow-x-auto",
    "overflow-y-auto",
    "overflow-auto",
    "overflow-x-scroll",
    "overflow-y-scroll",
  ]);
  const found = new Set<HTMLElement>();
  document.querySelectorAll(".sr-only").forEach((node) => {
    let el = node.parentElement;
    while (el && el.tagName !== "MAIN" && el !== document.body) {
      if (Array.from(el.classList).some((token) => panelTokens.has(token))) {
        found.add(el);
        break;
      }
      el = el.parentElement;
    }
  });
  return Array.from(found);
}
